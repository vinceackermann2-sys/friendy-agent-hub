const completed=require('./completion-fixture.cjs');
const assert=require('node:assert/strict');
const {createTaskRuntime}=require('../server/agents/task-runtime');
const {createCoordinator}=require('../server/agents/conversation');
const clone=x=>x==null?x:structuredClone(x);
// These tests cover task mechanics, not web permissions (tests/agent-permissions.cjs does):
// the test sites count as already visited, so opening them does not wait for approval.
require('../server/store').getAgentPermissions=async()=>({web:'ask_some',connectors:'ask_some',knownHosts:['shop.example','github.com']});
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup() {
  const rows=new Map(),calls=[],answers=[];
  const records={
    get:async(u,id)=>{const r=rows.get(id);return r?.user_id===u?clone(r):null;},
    list:async(u,c)=>[...rows.values()].filter(r=>r.user_id===u && r.chat_id===c).map(clone),
    team:async(u,id)=>{const a=rows.get(id);return a?.user_id===u?[...rows.values()].filter(r=>r.user_id===u && r.chat_id===a.chat_id && (r.state.teamId || r.id)===(a.state.teamId || a.id)).map(clone):[];},
    due:async()=>[...rows.values()].filter(r=>['queued','running','stopping'].includes(r.state.status)),
    create:async(row)=>{const old=[...rows.values()].find(r=>r.user_id===row.user_id && r.chat_id===row.chat_id && r.request_key===row.request_key);if(old)return clone(old);row.revision=1;rows.set(row.id,clone(row));return clone(row);},
    claim:async(u,id,token)=>{const r=rows.get(id);if(!r || r.user_id!==u || r.lease || !['queued','running','stopping'].includes(r.state.status))return null;r.lease=token;r.revision++;return clone(r);},
    write:async(row,state,token)=>{const r=rows.get(row.id);if(r.revision!==row.revision || (token && token!==r.lease))return null;r.state=clone(state);r.revision++;return clone(r);},
    release:async(u,id,token)=>{const r=rows.get(id);if(r.user_id===u && r.lease===token)r.lease=null;},
  };
  const d={records,schemas:[],tools:{},azure:{getSandbox:async()=>({mode:'azure'}),acquireLease:async()=>calls.push('lease'),renewLease:async()=>{},releaseLease:async()=>calls.push('release')},
    memory:{list:async()=>[],rank:x=>x,finish:async()=>[]},buildSystem:async()=>'',checkPrompt:p=>{if(!p)throw Error('prompt required');},ensureCredit:async()=>{},
    protect:(_,s)=>s,logUsage:async()=>calls.push('usage'),emitResultCard:(emit,name,id,out)=>{if(out.html)emit({type:'artifact',artifact:{html:out.html}});},
    model:async opts=>{calls.push({model:opts});const a=answers.shift();return completed(typeof a==='function'?await a(opts):a || {text:'Verified answer'});}};
  const runtime=createTaskRuntime(d);
  const create=()=>runtime.create({userId:'a',chatId:'chat',requestKey:`req${rows.size}`,instructions:'Research the topic',history:[{role:'user',text:'Original context'}]});
  return {runtime,d,rows,calls,answers,create,records};
}
async function planned(h,name,args={}) {h.answers.push({functionCalls:[{name,args}]});const row=await h.create();await h.runtime.step('a',row.id);return row.id;}
(async()=>{
  // No router or narrator call: one main inference starts work, and another
  // question can finish while that worker is blocked in a tool.
  const h=setup(),entered=gate(),release=gate();
  h.d.tools.shell={run:async(args,ctx)=>{h.calls.push({args,ctx});entered.resolve();return release.promise;}};
  const mainReplies=[{functionCalls:[{name:'delegate_task',args:{title:'Research',instructions:'Research the topic'}}]},{text:'Paris.'}];
  let mainCalls=0;const events=[];
  const main=createCoordinator({tasks:h.runtime,model:async()=>{mainCalls++;return mainReplies.shift();},schemas:[],tools:{},azure:h.d.azure,
    store:{listMemories:async()=>[],saveTurn:async()=>{}},buildSystem:async()=>'',ensureCredit:async()=>{},logUsage:async()=>{},checkPrompt:h.d.checkPrompt,protect:(_,s)=>s,rank:x=>x,finishMemory:async()=>[]});
  await main.run({userId:'a',chatId:'chat',requestId:'request',prompt:'Explore this topic',onEvent:e=>events.push(e)});
  assert.equal(mainCalls,1);
  const id=events.find(e=>e.type==='task').task.id;
  h.answers.push({functionCalls:[{name:'shell',args:{command:'check'}}]});await h.runtime.step('a',id);
  const working=h.runtime.step('a',id);await entered.promise;
  const t=performance.now();
  await main.run({userId:'a',chatId:'chat',requestId:'question',prompt:'Capital of France?',onEvent:e=>events.push(e)});
  const replyMs=performance.now()-t;
  assert.equal(events.at(-1).text,'Paris.');assert.equal(mainCalls,2);
  assert.equal(h.rows.get(id).state.inflight.kind,'tool','question leaves worker running');
  await h.runtime.step('a',id);assert.equal(h.calls.filter(c=>c.args).length,1,'duplicate advance cannot replay a tool');
  await h.runtime.control('a',id,{action:'steer',version:1,instruction:'Focus on Sweden',requestId:'change'},'chat');
  release.resolve({stdout:'Observed result'});await working;
  const steered=h.rows.get(id).state;
  assert.equal(steered.version,2);assert.equal(steered.observations.length,1);assert.match(steered.instructions,/Sweden/);
  assert.deepEqual(steered.pending,[]);assert.ok(h.calls.some(c=>c==='release'));
  await h.runtime.control('a',id,{action:'steer',version:1,instruction:'duplicate',requestId:'change'},'chat');
  assert.equal(h.rows.get(id).state.version,2,'control retry is idempotent');
  await assert.rejects(h.runtime.details('b',id,'chat'),/not found/);
  await assert.rejects(h.runtime.details('a',id,'different'),/not found/);
  console.log(`controlled concurrency: foreground reply ${replyMs.toFixed(2)}ms with worker held; 1 main model call per message, 0 narrator calls`);

  // Clear worker jobs that need none of the owner's accounts (building, code, research)
  // start a durable task without spending a coordinator model call.
  const directRequests=[
    'Generate an image of a fox',
    'Make me a tic tac toe game',
    'Run this code in my workspace',
    'Research current flight prices',
  ];
  for(const prompt of directRequests) {
    const routed=setup(),routedEvents=[];let modelCalls=0;
    const coordinator=createCoordinator({tasks:routed.runtime,model:async()=>{modelCalls++;return {text:'Direct answer'};},schemas:[],tools:{},azure:routed.d.azure,
      store:{listMemories:async()=>[],saveTurn:async()=>{}},buildSystem:async()=>'',ensureCredit:async()=>{},logUsage:async()=>{},
      checkPrompt:routed.d.checkPrompt,protect:(_,s)=>s,rank:x=>x,finishMemory:async()=>[]});
    await coordinator.run({userId:'a',chatId:'chat',requestId:'route',prompt,onEvent:e=>routedEvents.push(e)});
    assert.equal(modelCalls,0,`${prompt} should avoid an extra planning call`);
    const task=routedEvents.find(e=>e.type==='task');
    assert.ok(task,`${prompt} should start a task`);
    assert.equal(routed.rows.get(task.task.id).state.instructions,prompt);
  }
  // Capability questions stay in chat. Anything in the owner's accounts, a purchase or a
  // website goes through the coordinator, which checks what is connected first: sent
  // straight to a worker, "check my facebook messages" started the VM to sign in.
  for(const prompt of ['What is the capital of France?','Why can’t you use my Gmail?','How do I connect Gmail?','Can you use Gmail?','What is the best way to use Shopify?','What is my Shop Pay daily limit?','Where is my Shop Pay order?',
    'can you check my facebook messages','Check my Gmail inbox','Check my Dropbox files','Check my connected Trello account','Schedule a meeting in Google Calendar','Send a message in Slack',
    'Review my GitHub pull requests','Buy headphones with Shop Pay','Browse the merchant website and fill the form','Remind me every day to take a break','What did I get in my inbox today?',
    'Build a summary of my unread emails']) {
    const routed=setup(),routedEvents=[];let modelCalls=0;
    const coordinator=createCoordinator({tasks:routed.runtime,model:async()=>{modelCalls++;return {text:'Direct answer'};},schemas:[],tools:{},azure:routed.d.azure,
      store:{listMemories:async()=>[],saveTurn:async()=>{}},buildSystem:async()=>'',ensureCredit:async()=>{},logUsage:async()=>{},
      checkPrompt:routed.d.checkPrompt,protect:(_,s)=>s,rank:x=>x,finishMemory:async()=>[]});
    await coordinator.run({userId:'a',chatId:'chat',requestId:'route',prompt,onEvent:e=>routedEvents.push(e)});
    assert.equal(modelCalls,1,`${prompt} should remain a chat question`);
    assert.equal(routedEvents.some(e=>e.type==='task'),false);
  }

  // A task-store outage must not take down ordinary conversation. The model
  // receives no delegation controls, so it cannot claim background work began.
  const degradedEvents=[],degradedReports=[],degradedModels=[];
  const degraded=createCoordinator({
    tasks:{summaries:async()=>{throw Object.assign(new Error('Task storage is unavailable.'),{status:503,code:'TASK_STORE_PGRST202'});}},
    model:async opts=>{degradedModels.push(opts);return {text:'Direct answer while tasks recover.'};},
    schemas:[{name:'history_search',description:'Search history',parameters:{type:'object',properties:{}}}],tools:{},azure:{getSandbox:async()=>({mode:'azure'})},
    store:{listMemories:async()=>[],saveTurn:async()=>{}},buildSystem:async()=>'',ensureCredit:async()=>{},logUsage:async()=>{},checkPrompt:h.d.checkPrompt,
    protect:(_,s)=>s,rank:x=>x,finishMemory:async()=>[],reportError:(event,details)=>degradedReports.push({event,details}),
  });
  await degraded.run({userId:'a',chatId:'chat',requestId:'degraded',prompt:'Hello',onEvent:e=>degradedEvents.push(e)});
  assert.equal(degradedEvents.find(e=>e.type==='message').text,'Direct answer while tasks recover.');

  const streamedEvents=[];
  const streamed=createCoordinator({
    tasks:{summaries:async()=>[]},
    model:async opts=>{
      opts.onDelta('Par');opts.onDelta('is.');
      return {text:'Paris.'};
    },
    schemas:[],tools:{},azure:{getSandbox:async()=>({mode:'azure'})},
    store:{listMemories:async()=>[],saveTurn:async()=>{}},buildSystem:async()=>'',ensureCredit:async()=>{},logUsage:async()=>{},checkPrompt:h.d.checkPrompt,
    protect:(_,s)=>s,rank:x=>x,finishMemory:async()=>[],
  });
  await streamed.run({userId:'a',chatId:'chat',requestId:'stream',prompt:'Capital?',onEvent:e=>streamedEvents.push(e)});
  assert.deepEqual(streamedEvents.filter(e=>e.type==='message_delta').map(e=>e.delta),['Par','is.']);
  assert.equal(streamedEvents.find(e=>e.type==='message').text,'Paris.');
  const retracted=[];
  const toolThen=createCoordinator({
    tasks:h.runtime,model:async opts=>{opts.onDelta('I will ');opts.onDelta('search.');return {functionCalls:[{name:'delegate_task',args:{title:'Research',instructions:'Research'}}]};},
    schemas:[],tools:{},azure:h.d.azure,store:{listMemories:async()=>[],saveTurn:async()=>{}},buildSystem:async()=>'',
    ensureCredit:async()=>{},logUsage:async()=>{},checkPrompt:h.d.checkPrompt,protect:(_,s)=>s,rank:x=>x,finishMemory:async()=>[],
  });
  await toolThen.run({userId:'a',chatId:'chat',requestId:'retract',prompt:'Explore this topic',onEvent:e=>retracted.push(e)});
  assert.ok(retracted.some(e=>e.type==='message_retract'));
  assert.ok(retracted.some(e=>e.type==='task'));
  assert.deepEqual(degradedModels[0].tools.map(t=>t.name),['react_to_message','read_doc','history_search']);
  assert.match(degradedModels[0].system,/Task storage is temporarily unavailable/);
  assert.equal(degradedReports[0].event,'task_storage_unavailable');
  assert.equal(degradedReports[0].details.status,503);
  assert.equal(degradedReports[0].details.code,'TASK_STORE_PGRST202');

  // A stale model completion must not finalize or queue actions after steering.
  const s=setup(),modelEntered=gate(),modelRelease=gate();
  s.answers.push(async()=>{modelEntered.resolve();return modelRelease.promise;});const sr=await s.create();
  const inference=s.runtime.step('a',sr.id);await modelEntered.promise;
  await s.runtime.control('a',sr.id,{action:'steer',version:1,instruction:'New goal'},'chat');
  modelRelease.resolve({text:'Stale final answer'});await inference;
  assert.equal(s.rows.get(sr.id).state.result,undefined);assert.equal(s.rows.get(sr.id).state.status,'queued');
  const stale=setup(),errorEntered=gate(),errorRelease=gate();
  stale.answers.push(async()=>{errorEntered.resolve();await errorRelease.promise;throw Error('Old inference failed');});const er=await stale.create();
  const failing=stale.runtime.step('a',er.id);await errorEntered.promise;
  await stale.runtime.control('a',er.id,{action:'steer',version:1,instruction:'Keep this version'},'chat');errorRelease.resolve();await failing;
  assert.equal(stale.rows.get(er.id).state.status,'queued','an old model error cannot fail the new task version');

  // Exact approvals survive restart and cannot authorize changed arguments.
  const a=setup(),sent=[];a.d.tools.send={approval:true,run:async args=>{sent.push(args);return {ok:true};}};
  const aid=await planned(a,'send',{to:'approved@example.com',body:'Exact body'});
  await a.runtime.step('a',aid);let ar=a.rows.get(aid);
  assert.equal(ar.state.status,'waiting_approval');const callId=ar.state.approval.id;
  await assert.rejects(a.runtime.control('a',aid,{action:'decide',version:1,callId:'wrong',allow:true},'chat'),/no longer pending/);
  await a.runtime.control('a',aid,{action:'decide',version:1,callId,allow:true,args:{to:'attacker'}},'chat');
  await createTaskRuntime(a.d).step('a',aid);
  assert.deepEqual(sent,[{to:'approved@example.com',body:'Exact body'}]);
  const deny=setup();deny.d.tools.send=a.d.tools.send;const deniedId=await planned(deny,'send');await deny.runtime.step('a',deniedId);
  const oldApproval=deny.rows.get(deniedId).state.approval;
  await deny.runtime.control('a',deniedId,{action:'steer',version:1,instruction:'Changed'},'chat');
  await assert.rejects(deny.runtime.control('a',deniedId,{action:'decide',version:1,callId:oldApproval.id,allow:true},'chat'),/changed/);

  // Only evidenced, novel milestones produce update cards.
  const m=setup();m.d.tools.lookup={run:async()=>({finding:'Evidence'})};const mid=await planned(m,'lookup');await m.runtime.step('a',mid);
  const ref=m.rows.get(mid).state.observations[0].id;
  m.answers.push({functionCalls:[{name:'report_milestone',args:{summary:'Found the answer',evidenceIds:[ref]}}]});await m.runtime.step('a',mid);
  m.answers.push({functionCalls:[{name:'report_milestone',args:{summary:'Duplicate evidence',evidenceIds:[ref]}},{name:'report_milestone',args:{summary:'Invented',evidenceIds:['fake']}}]});await m.runtime.step('a',mid);
  assert.equal(m.rows.get(mid).state.events.length,1);
  const update=m.rows.get(mid).state.events[0];
  assert.deepEqual([update.type,update.phase,update.text],['message','task_update','Found the answer'],'an update reaches the chat as the agent\'s message');
  await m.runtime.step('a',mid);assert.equal(m.rows.get(mid).state.status,'completed');
  assert.equal(m.rows.get(mid).state.events.at(-1).phase,'task_answer');
  // The chat's hand-off word is never a task's answer: a bare NO_ANSWER sends the worker back
  // to the work once, and the word is cut from an answer that carries it.
  const bare=setup();bare.answers.push({text:'NO_ANSWER'},{text:'Paris is the capital. NO_ANSWER'});
  const bareRow=await bare.create();
  await bare.runtime.step('a',bareRow.id);
  assert.notEqual(bare.rows.get(bareRow.id).state.status,'completed','a bare NO_ANSWER does not finish the task');
  await bare.runtime.step('a',bareRow.id);
  assert.equal(bare.rows.get(bareRow.id).state.status,'completed');
  assert.equal(bare.rows.get(bareRow.id).state.result,'Paris is the capital.');
  const failedEvidence=setup();failedEvidence.d.tools.lookup={run:async()=>[{ok:false,error:'Could not fetch'}]};
  const fid=await planned(failedEvidence,'lookup');await failedEvidence.runtime.step('a',fid);
  const failedRef=failedEvidence.rows.get(fid).state.observations[0].id;
  failedEvidence.answers.push({functionCalls:[{name:'report_milestone',args:{summary:'False success',evidenceIds:[failedRef]}}]});await failedEvidence.runtime.step('a',fid);
  assert.equal(failedEvidence.rows.get(fid).state.events.length,0);

  // Only explicitly budgeted runs (automations) stop at a round limit.
  const budget=setup();const br=await budget.create();budget.rows.get(br.id).state.context.maxRounds=8;budget.rows.get(br.id).state.round=8;
  budget.answers.push({text:'Incomplete research.<task_coverage>'+JSON.stringify({requirements:[{id:'research',text:'Finish the research',status:'blocked',gap:'Planning budget reached before all research was done.'}]})+'</task_coverage>'});
  await budget.runtime.step('a',br.id);assert.equal(budget.rows.get(br.id).state.status,'partial');
  // Tools stay listed so the cached prompt prefix survives, but calls are disabled.
  assert.equal(budget.calls.find(c=>c.model).model.toolChoice,'none','budget stops further tool planning');
  await budget.runtime.control('a',br.id,{action:'continue',version:1},'chat');
  assert.equal(budget.rows.get(br.id).state.round,0);assert.equal(budget.rows.get(br.id).state.status,'queued');
  const longChange='Full constraint '.repeat(390);
  await budget.runtime.control('a',br.id,{action:'steer',version:2,instruction:longChange},'chat');
  await budget.runtime.step('a',br.id);
  assert.ok(budget.calls.filter(c=>c.model).at(-1).model.prompt.includes(longChange.slice(-900)),'long steering instructions reach the model');

  const crashed=setup();crashed.d.tools.send=a.d.tools.send;const cid=await planned(crashed,'send');
  crashed.rows.get(cid).state.inflight={kind:'tool',name:'send'};
  await crashed.runtime.step('a',cid);assert.equal(crashed.rows.get(cid).state.status,'needs_review');assert.equal(sent.length,1);
  const uncertain=setup();uncertain.d.tools.send={approval:false,run:async()=>{throw Error('Network lost');}};
  uncertain.d.tools.shell=uncertain.d.tools.send;const uid=await planned(uncertain,'shell');await uncertain.runtime.step('a',uid);
  assert.equal(uncertain.rows.get(uid).state.status,'needs_review');

  const stop=setup(),toolEntered=gate(),toolRelease=gate();stop.d.tools.shell={run:async()=>{toolEntered.resolve();return toolRelease.promise;}};
  const stopId=await planned(stop,'shell');const action=stop.runtime.step('a',stopId);await toolEntered.promise;
  // A stop is immediate even while a computer action runs: the task and its card stop
  // saying working at once, and the action that was already running finishes on its own.
  await stop.runtime.control('a',stopId,{action:'cancel',version:1},'chat');assert.equal(stop.rows.get(stopId).state.status,'stopped');
  assert.equal(stop.rows.get(stopId).state.events.filter(e=>e.card?.type==='computer').at(-1).card.status,'done','a stopped step closes its card at once');
  assert.equal(await stop.runtime.step('a',stopId).then(r=>r.state.status),'stopped','a stopped task does not start new work');
  toolRelease.resolve({stdout:'Done'});await action;
  assert.equal(stop.rows.get(stopId).state.status,'stopped');assert.equal(stop.rows.get(stopId).state.observations.length,1);
  assert.equal(stop.rows.get(stopId).state.events.filter(e=>e.card?.type==='computer').at(-1).card.status,'done','its card stays closed');
  // A task stopped while its computer is starting does not run the action.
  const cold=setup(),leasing=gate(),leased=gate();let ran=false;
  cold.d.azure.acquireLease=async()=>{leasing.resolve();await leased.promise;};cold.d.tools.shell={run:async()=>{ran=true;return {stdout:'Ran'};}};
  const coldId=await planned(cold,'shell');const coldStep=cold.runtime.step('a',coldId);await leasing.promise;
  await cold.runtime.control('a',coldId,{action:'cancel',version:1},'chat');assert.equal(cold.rows.get(coldId).state.status,'stopped');
  leased.resolve();await coldStep;
  assert.equal(ran,false,'the action never runs after a stop');assert.equal(cold.rows.get(coldId).state.status,'stopped');
  // Cancelling stops the model mid-thought, and the work done so far is still billed.
  const aborting=(began,usage)=>opts=>new Promise((_,reject)=>{began.resolve();
    opts.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError',usage})));});
  const c=setup(),began=gate();c.answers.push(aborting(began,{total_tokens:40}));
  const cr=await c.create();const stepping=c.runtime.step('a',cr.id);await began.promise;
  await c.runtime.control('a',cr.id,{action:'cancel',version:1},'chat');
  await stepping;
  assert.equal(c.rows.get(cr.id).state.status,'stopped');
  assert.equal(c.rows.get(cr.id).state.inflight,null);
  assert.ok(c.calls.includes('usage'),'cancelled model work is billed');
  // A cancel handled by another server instance is noticed by polling.
  const x=setup(),remote=createTaskRuntime({...x.d,watchMs:10}),remoteBegan=gate();x.answers.push(aborting(remoteBegan));
  const xr=await x.create();const remoteStep=remote.step('a',xr.id);await remoteBegan.promise;
  await x.runtime.control('a',xr.id,{action:'cancel',version:1},'chat');
  const keepAlive=setInterval(()=>{},1000); // the runtime's poll timer is unref'd
  await remoteStep;clearInterval(keepAlive);
  assert.equal(x.rows.get(xr.id).state.status,'stopped');
  // A stop applies whatever version the owner last saw, and stops the subtasks the task started.
  const tree=setup();const parent=await tree.create();
  tree.rows.get(parent.id).state.version=3;
  const child=await tree.runtime.create({userId:'a',chatId:'chat',requestKey:'child',title:'Child',instructions:'Research one part',relatedTaskId:parent.id,parentTaskId:parent.id});
  const grandchild=await tree.runtime.create({userId:'a',chatId:'chat',requestKey:'grandchild',title:'Grandchild',instructions:'Research a smaller part',relatedTaskId:child.id,parentTaskId:child.id});
  const stranger=await tree.create();
  await tree.runtime.control('a',parent.id,{action:'cancel',version:1,requestId:'stop-all'},'chat');
  assert.equal(tree.rows.get(parent.id).state.status,'stopped','a stale version still stops the task');
  assert.equal(tree.rows.get(child.id).state.status,'stopped','its subtask stops');
  assert.equal(tree.rows.get(grandchild.id).state.status,'stopped','and the subtask’s own subtask');
  assert.equal(tree.rows.get(stranger.id).state.status,'queued','other tasks keep working');
  await tree.runtime.control('a',parent.id,{action:'cancel',version:1,requestId:'stop-again'},'chat');
  assert.equal(tree.rows.get(parent.id).state.status,'stopped','stopping a stopped task is a no-op');

  const chat=(model,extra={})=>createCoordinator({tasks:{summaries:async()=>[]},model,schemas:[],tools:{},azure:{getSandbox:async()=>({mode:'azure'})},
    store:{listMemories:async()=>[],saveTurn:async()=>{}},buildSystem:async()=>'',ensureCredit:async()=>{},logUsage:async()=>{},
    checkPrompt:c.d.checkPrompt,protect:(_,s)=>s,rank:x=>x,finishMemory:async()=>[],...extra});
  // A turn cut off after text reached the user keeps that text, and its work is billed.
  const cutEvents=[],cutBilled=[];
  await chat(async opts=>{opts.onDelta('Half an ');throw Object.assign(new Error('reset'),{partialText:'Half an answer',usage:{total_tokens:9}});},
    {logUsage:async(_,usages)=>cutBilled.push(...usages)}).run({userId:'a',chatId:'chat',requestId:'cut',prompt:'Explain',onEvent:e=>cutEvents.push(e)});
  assert.equal(cutEvents.find(e=>e.type==='message').text,'Half an answer');
  assert.equal(cutBilled[0].total_tokens,9);
  // Quick lookups are capped: the final round keeps its tools but has to answer.
  const choices=[],lookupEvents=[];
  await chat(async opts=>{choices.push(opts.toolChoice);return opts.toolChoice==='none'?{text:'Answer from lookups.'}:{functionCalls:[{name:'history_search',args:{query:'x'}}]};},
    {schemas:[{name:'history_search',description:'Search history',parameters:{type:'object',properties:{}}}],tools:{history_search:{run:async()=>({hits:[]})}}})
    .run({userId:'a',chatId:'chat',requestId:'lookup',prompt:'What did we decide?',onEvent:e=>lookupEvents.push(e)});
  assert.deepEqual(choices,['auto','auto','none']);
  assert.equal(lookupEvents.find(e=>e.type==='message').text,'Answer from lookups.');
  // The chat turn may run one quick web search itself, then answers without a task.
  const searchSchema={name:'web_search',description:'Search the web',parameters:{type:'object',properties:{}}};
  const searched=[],searchEvents=[],searchModels=[];
  await chat(async opts=>{searchModels.push(opts);return searchModels.length===1?{functionCalls:[{name:'web_search',args:{query:'Nobel prize 2026'}}]}:{text:'Answer from the search.'};},
    {schemas:[searchSchema],tools:{web_search:{run:async a=>{searched.push(a.query);return [{ok:true,text:'{"abstract":"..."}'}];}}}})
    .run({userId:'a',chatId:'chat',requestId:'search',prompt:'Who won the Nobel prize this year?',onEvent:e=>searchEvents.push(e)});
  assert.ok(searchModels[0].tools.some(t=>t.name==='web_search'),'the coordinator can search');
  assert.match(searchModels[0].system,/Speed matters most/);
  assert.deepEqual(searched,['Nobel prize 2026']);
  assert.ok(searchEvents.some(e=>e.type==='progress' && e.label==='Checking live sources'));
  assert.equal(searchEvents.find(e=>e.type==='message').text,'Answer from the search.');
  assert.ok(!searchEvents.some(e=>e.type==='task'),'a quick lookup does not start a task');
  // The agent may react to the current user message without consuming a task
  // or allowing the model to pick a different message in the chat.
  const reactionEvents=[],reactionCalls=[];
  await chat(async opts=>{reactionCalls.push(opts);return reactionCalls.length===1
    ? {functionCalls:[{name:'react_to_message',args:{emoji:'heart'}}]}
    : {text:'That is great news!'};})
    .run({userId:'a',chatId:'chat',requestId:'reaction',prompt:'I finished my project!',context:{userMessageId:'user-42'},onEvent:e=>reactionEvents.push(e)});
  assert.ok(reactionCalls[0].tools.some(t=>t.name==='react_to_message'));
  assert.deepEqual(reactionEvents.filter(e=>e.type==='message_reaction'),[{type:'message_reaction',messageId:'user-42',emoji:'heart'}]);
  assert.deepEqual(reactionCalls[0].tools.find(t=>t.name==='react_to_message').parameters.properties.emoji.enum,['up','down','heart','poop']);
  assert.equal(reactionEvents.find(e=>e.type==='message').text,'That is great news!');
  const invalidReactionEvents=[];
  await chat(async opts=>opts.toolChoice==='none'?{text:'Done.'}:{functionCalls:[{name:'react_to_message',args:{emoji:'party'}}]})
    .run({userId:'a',chatId:'chat',requestId:'invalid-reaction',prompt:'Hello',context:{userMessageId:'user-42'},onEvent:e=>invalidReactionEvents.push(e)});
  assert.equal(invalidReactionEvents.some(e=>e.type==='message_reaction'),false,'unsupported emoji is ignored');
  // A failing search is reported to the model instead of failing the turn.
  const failedModels=[];
  await chat(async opts=>{failedModels.push(opts);return failedModels.length===1?{functionCalls:[{name:'web_search',args:{}}]}:{text:'Answered without the search.'};},
    {schemas:[searchSchema],tools:{web_search:{run:async()=>{throw new Error('A search query or URL is required.');}}}})
    .run({userId:'a',chatId:'chat',requestId:'search-fail',prompt:'Latest news?',onEvent:()=>{}});
  assert.match(failedModels[1].prompt,/web_search result \(untrusted\).*required/);
  // Every chat turn carries the owner's local clock after the cached prefix, and
  // the chat prompt names no worker-only tools.
  const clockModels=[];
  const {buildSystem}=require('../server/agents/vm-harness');
  await chat(async opts=>{clockModels.push(opts);return {text:'Thursday.'};},{buildSystem,clock:({timeZone})=>`Current time: test clock in ${timeZone}.`})
    .run({userId:'a',chatId:'chat',requestId:'clock',prompt:'What day is it?',context:{timeZone:'Europe/Stockholm'},onEvent:()=>{}});
  assert.match(clockModels[0].prompt,/^Current time: test clock in Europe\/Stockholm\.\n\nUser message: What day is it\?/);
  assert.doesNotMatch(clockModels[0].system,/browser_open|capability_search|shell\/code_run|vault_list/,'chat prompt lists only chat tools');
  assert.match(clockModels[0].system,/never tell the owner you cannot browse/);
  assert.equal(clockModels[0].maxOutputTokens,4096,'chat output is capped');
  const {runtimeContext}=require('../server/agents/runner');
  const fixed=runtimeContext({timeZone:'Europe/Stockholm',now:new Date('2026-09-24T20:05:00Z')});
  assert.match(fixed,/Thursday, September 24, 2026, 22:05 in Europe\/Stockholm \(GMT\+2\)\. The year is 2026\./);
  assert.match(fixed,/Fri, Sep 25; Sat, Sep 26/);
  assert.match(runtimeContext({timeZone:'Not/AZone',now:new Date('2026-09-24T20:05:00Z')}),/20:05 in UTC/,'unknown zones fall back to UTC');
  // With task storage, the final lookup round may still start a task, and a
  // request that needs more lookups becomes a task instead of a dead end.
  const handoff=setup(),handoffEvents=[],handoffChoices=[];
  const withTasks=(model,extra={})=>createCoordinator({tasks:handoff.runtime,model,schemas:[searchSchema],tools:{web_search:{run:async()=>[{ok:true,text:'{"note":"No instant answer found for this query."}'}]}},
    azure:handoff.d.azure,store:{listMemories:async()=>[],saveTurn:async()=>{}},buildSystem:async()=>'',ensureCredit:async()=>{},logUsage:async()=>{},
    checkPrompt:handoff.d.checkPrompt,protect:(_,s)=>s,rank:x=>x,finishMemory:async()=>[],...extra});
  let searchModel=[];
  await withTasks(async opts=>{handoffChoices.push(opts.toolChoice);searchModel.push(opts);return {functionCalls:[{name:'web_search',args:{query:'latest race'}}]};})
    .run({userId:'a',chatId:'chat',requestId:'handoff',prompt:'Who won the latest race?',onEvent:e=>handoffEvents.push(e)});
  assert.deepEqual(handoffChoices,['auto','auto','auto'],'the final round can still delegate');
  assert.match(searchModel[1].prompt,/Search once more with different, broader words; if that finds nothing either, start a task to check live sources/,'an empty search points to another query, then a task');
  const handedOff=handoffEvents.find(e=>e.type==='task');
  assert.ok(handedOff,'the request became a task');
  assert.equal([...handoff.rows.values()].at(-1).state.instructions.split('\n')[0],'Who won the latest race?');
  assert.doesNotMatch(handoffEvents.find(e=>e.type==='message').text,/could not complete/);
  // A cut-off delegate_task call without a brief still starts the owner's request.
  const cut=setup(),cutTaskEvents=[];
  await createCoordinator({tasks:cut.runtime,model:async()=>({functionCalls:[{name:'delegate_task',args:{_raw:'{"title":"Rea'}}]}),schemas:[],tools:{},azure:cut.d.azure,
    store:{listMemories:async()=>[],saveTurn:async()=>{}},buildSystem:async()=>'',ensureCredit:async()=>{},logUsage:async()=>{},checkPrompt:cut.d.checkPrompt,protect:(_,s)=>s,rank:x=>x,finishMemory:async()=>[]})
    .run({userId:'a',chatId:'chat',requestId:'cut-brief',prompt:'Read timewarpdev.com',onEvent:e=>cutTaskEvents.push(e)});
  const cutRow=[...cut.rows.values()].at(-1);
  assert.equal(cutRow.state.title,'Read timewarpdev.com');
  assert.match(cutRow.state.instructions,/^Read timewarpdev\.com/);
  // Workers see the same clock, in the owner's zone from the chat context.
  const timed=setup();timed.d.clock=({timeZone})=>`Current time: worker clock in ${timeZone}.`;
  const timedRow=await timed.runtime.create({userId:'a',chatId:'chat',requestKey:'timed',instructions:'Plan next weekend',context:{timeZone:'Europe/Stockholm'},history:[]});
  await timed.runtime.step('a',timedRow.id);
  assert.match(timed.calls.find(c=>c.model).model.prompt,/Current time: worker clock in Europe\/Stockholm\.\n\nTeam snapshot/);
  // Tasks have no fixed round limit, and workers start with a small core.
  const schemaFor=name=>({name,description:name,parameters:{type:'object',properties:{}}});
  const runToEnd=async(h,id)=>{for(let i=0;i<60 && !['completed','partial','failed','needs_review','waiting_approval'].includes(h.rows.get(id).state.status);i++) await h.runtime.step('a',id);return h.rows.get(id).state;};
  const long=setup();
  long.d.schemas=['web_search','browser_open','browser_action','shell','mail_send','composio_apps','composio_tools','composio_execute','connect_app'].map(schemaFor);long.d.selectSchemas=()=>[];
  long.d.tools.web_search={run:async a=>[{ok:true,text:`result for ${a.query}`}]};
  for(let i=0;i<12;i++) long.answers.push({functionCalls:[{name:'web_search',args:{query:`q${i}`}}]});
  long.answers.push({text:'Finished after 12 searches.'});
  const longState=await runToEnd(long,(await long.create()).id);
  assert.equal(longState.status,'completed');
  assert.equal(longState.result,'Finished after 12 searches.');
  // Past the research budget the worker writes its answer: only the card tool is left, and it
  // sees every research result instead of paging back through shortened ones.
  const research=setup();
  research.d.schemas=['web_search','present','browser_open'].map(schemaFor);research.d.selectSchemas=()=>[];
  research.d.tools.web_search={run:async a=>[{ok:true,text:`result for ${a.query} `+'x'.repeat(4000)}]};
  for(let i=0;i<14;i++) research.answers.push({functionCalls:[{name:'web_search',args:{query:`q${i}`}}]});
  research.answers.push({text:'Answer from the research.'});
  const researchState=await runToEnd(research,(await research.create()).id);
  assert.equal(researchState.status,'completed');
  const finalCall=research.calls.filter(c=>c.model).at(-1).model;
  assert.ok(finalCall.tools.some(t=>t.name==='web_search'),'research tools remain until requirements are covered');
  assert.ok(finalCall.history.some(h=>/Earlier results/.test(h.text)),'older evidence remains discoverable');
  assert.doesNotMatch(finalCall.prompt,/researched enough/);
  const workerTools=long.calls.find(c=>c.model).model.tools.map(t=>t.name);
  assert.ok(workerTools.includes('web_search'),'read-only search remains available');
  assert.ok(workerTools.includes('composio_apps'),'workers can discover any connected app');
  for(const name of ['browser_open','browser_action','shell','mail_send']) assert.ok(!workerTools.includes(name),`${name} needs relevant task intent or capability_search`);
  // A worker repeating one call with identical results is stopped and returns what it has.
  const loop=setup();
  loop.d.schemas=[schemaFor('web_search')];loop.d.selectSchemas=()=>[];
  let loopRuns=0;loop.d.tools.web_search={run:async()=>{loopRuns++;return [{ok:true,text:'same page'}];}};
  for(let i=0;i<20;i++) loop.answers.push(opts=>opts.toolChoice==='none'?{text:'Best effort result.'}:{functionCalls:[{name:'web_search',args:{query:'same'}}]});
  const loopState=await runToEnd(loop,(await loop.create()).id);
  assert.equal(loopRuns,3,'identical calls stop running after three identical results');
  assert.equal(loopState.status,'partial');
  assert.equal(loopState.result,'Best effort result.');
  // After a browser step the model sees the page as an image; the base64 stays
  // out of the observation text and the task state.
  const seer=setup();seer.d.schemas=[schemaFor('browser_open'),schemaFor('web_search')];seer.d.selectSchemas=()=>[];
  seer.d.tools.browser_open={liveId:async ctx=>`rt:live-${ctx.sessionId}`,run:async a=>({url:a.url,title:'Shop',elements:['[1] button "Buy" @640,450'],screenshot:'data:image/jpeg;base64,SU1BR0U='})};
  seer.d.tools.web_search={run:async()=>[{ok:true,text:'results'}]};
  seer.answers.push({functionCalls:[{name:'browser_open',args:{url:'https://shop.example/'}}]},{functionCalls:[{name:'web_search',args:{query:'reviews'}}]},{text:'Done.'});
  const seerState=await runToEnd(seer,(await seer.create()).id);
  const seerModels=seer.calls.filter(c=>c.model).map(c=>c.model);
  assert.equal(seerModels[0].attachments,undefined,'no image before the browser was used');
  assert.deepEqual(seerModels[1].attachments,[{inlineData:{mimeType:'image/jpeg',data:'SU1BR0U='}}]);
  assert.match(seerModels[1].prompt,/current screen/);
  assert.equal(seerModels[2].attachments,undefined,'the image is only sent right after a browser step');
  assert.ok(!JSON.stringify(seerState).includes('SU1BR0U='),'screenshots are not stored in task state');
  // The browser card carries the task's live channel while the step still runs.
  const liveCard=seerState.events.find(e=>e.card?.type==='browser' && e.card.status==='running');
  assert.match(String(liveCard?.card.liveId),/^rt:live-[0-9a-f-]{36}$/,'the live view can open while a browser step works');
  // A step whose result makes no card of its own still closes the card it opened.
  const closed=seerState.events.filter(e=>e.id===liveCard.id).at(-1).card;
  assert.equal(closed.status,'done');assert.equal(closed.note,undefined,'"Working in the browser…" goes with the running step');
  assert.equal(closed.liveId,liveCard.card.liveId);
  assert.match(seerState.observations[0].text,/\[1\] button \\"Buy\\"/);
  // Only the newest screen card keeps its screenshot in the stored task history.
  const cards=setup();cards.d.schemas=[schemaFor('browser_action')];cards.d.selectSchemas=()=>[];
  cards.d.emitResultCard=(emit,name,id,out)=>emit({type:'card',id,card:{type:'browser',url:out.url,screenshot:out.screenshot,status:'done'}});
  let shotNo=0;cards.d.tools.browser_action={run:async()=>({url:'https://shop.example/',screenshot:`data:image/jpeg;base64,U0hPVC${++shotNo}`})};
  cards.answers.push({functionCalls:[{name:'browser_action',args:{type:'scroll',dy:1}}]},{functionCalls:[{name:'browser_action',args:{type:'scroll',dy:2}}]},{text:'Done.'});
  const cardState=await runToEnd(cards,(await cards.create()).id);
  const shots=cardState.events.filter(e=>e.card?.type==='browser' && e.card.status==='done').map(e=>e.card.screenshot);
  assert.deepEqual(shots,[undefined,'data:image/jpeg;base64,U0hPVC2']);
  // Approval cards can describe the action instead of showing raw arguments.
  const vault=setup();vault.d.schemas=[schemaFor('browser_fill_secret')];vault.d.selectSchemas=()=>[];
  let approvedDetail;
  vault.d.tools.browser_fill_secret={approval:true,approvalDetail:async(args,{userId})=>JSON.stringify({...args,summary:`Type your saved “GitHub password” on ${args.host} for ${userId}`}),run:async(_args,ctx)=>{approvedDetail=ctx.approvedDetail;return {url:'https://github.com/'};}};
  vault.answers.push({functionCalls:[{name:'browser_fill_secret',args:{secret:'sec_gh12',ref:2,host:'github.com'}}]});
  const vaultRow=await vault.create();
  const vaultState=await runToEnd(vault,vaultRow.id);
  assert.equal(vaultState.status,'waiting_approval');
  assert.equal(JSON.parse(vaultState.events.find(e=>e.card?.type==='approval').card.detail).summary,'Type your saved “GitHub password” on github.com for a');
  await vault.runtime.control('a',vaultRow.id,{action:'decide',version:1,callId:vaultState.approval.id,allow:true},'chat');
  await vault.runtime.step('a',vaultRow.id);
  assert.equal(JSON.parse(approvedDetail).host,'github.com');
  // Automations keep their explicit round budget.
  const capped=setup();capped.d.schemas=[schemaFor('web_search')];capped.d.selectSchemas=()=>[];
  capped.d.tools.web_search={run:async a=>[{ok:true,text:String(Math.random())}]};
  for(let i=0;i<10;i++) capped.answers.push(opts=>opts.toolChoice==='none'?{text:'Automation summary.<task_coverage>'+JSON.stringify({requirements:[{id:'news',text:'Check all requested news',status:'blocked',gap:'Further research remains after the planning budget.'}]})+'</task_coverage>'}:{functionCalls:[{name:'web_search',args:{query:`a${i}`}}]});
  const autoRow=await capped.runtime.create({userId:'a',chatId:'chat',requestKey:'auto',instructions:'Check news',context:{automation:true,maxRounds:3}});
  const cappedState=await runToEnd(capped,autoRow.id);
  assert.equal(cappedState.status,'partial');assert.equal(cappedState.result,'Automation summary.');
  assert.equal(cappedState.observations.filter(o=>o.name==='web_search' && o.ok).length,3,'planning budget still stops extra reads');

  // A long task keeps the owner posted. Once they have heard nothing for a while and there
  // are new results, an update is written from those results while the worker plans its
  // next step; the worker's own prompt stays as it was.
  const quiet=setup(),progressCalls=[];
  quiet.d.tools.lookup={run:async a=>({finding:`Three flights under 2000 kr ${a.q || ''}`})};
  quiet.d.progress=async req=>{progressCalls.push(req);return req.lastUpdate?'Two of them include a checked bag.':'Found three flights under 2000 kr so far.';};
  const advance=id=>quiet.runtime.step('a',id);
  const quietId=await planned(quiet,'lookup');await advance(quietId);
  quiet.answers.push({functionCalls:[{name:'lookup',args:{q:1}}]});await advance(quietId);
  assert.equal(progressCalls.length,0,'no update right after the start');
  const quietRow=await quiet.create();quiet.rows.get(quietRow.id).state.startedAt=Date.now()-30000;
  quiet.answers.push({functionCalls:[{name:'lookup',args:{}}]});await advance(quietRow.id);
  assert.equal(progressCalls.length,0,'no update without new results');
  await advance(quietRow.id);
  quiet.answers.push({functionCalls:[{name:'lookup',args:{q:2}}]});await advance(quietRow.id);
  assert.equal(progressCalls.length,1,'a quiet task with new results sends an update');
  assert.equal(progressCalls[0].request,'Research the topic');
  assert.match(progressCalls[0].results[0].text,/Three flights under 2000 kr/);
  assert.deepEqual(quiet.rows.get(quietRow.id).state.events.filter(e=>e.phase==='task_update').map(e=>e.text),['Found three flights under 2000 kr so far.']);
  assert.equal(quiet.rows.get(quietRow.id).state.summary,'Found three flights under 2000 kr so far.','the chat sees the latest update');
  assert.ok(!quiet.calls.filter(c=>c.model).some(c=>/heard from you|update to the owner/.test(c.model.prompt)),'the worker prompt is unchanged');
  // The next update waits for a long stretch and covers only results since the last one.
  await advance(quietRow.id);
  quiet.rows.get(quietRow.id).state.lastUpdateAt=Date.now()-60000;
  quiet.answers.push({functionCalls:[{name:'lookup',args:{q:3}}]});await advance(quietRow.id);
  assert.equal(progressCalls.length,1,'no second update within 90 seconds');
  await advance(quietRow.id);
  quiet.rows.get(quietRow.id).state.lastUpdateAt=Date.now()-100000;
  quiet.answers.push({functionCalls:[{name:'lookup',args:{q:4}}]});await advance(quietRow.id);
  assert.equal(progressCalls.length,2);
  assert.equal(progressCalls[1].lastUpdate,'Found three flights under 2000 kr so far.');
  assert.deepEqual(progressCalls[1].results.map(o=>o.text.match(/kr (\d)/)?.[1]),['2','3']);
  // An update written as the task finishes is not sent: the answer arrives instead.
  await advance(quietRow.id);
  quiet.rows.get(quietRow.id).state.lastUpdateAt=Date.now()-100000;
  await advance(quietRow.id);
  assert.equal(progressCalls.length,3);
  assert.equal(quiet.rows.get(quietRow.id).state.status,'completed');
  assert.deepEqual(quiet.rows.get(quietRow.id).state.events.filter(e=>e.phase==='task_update').map(e=>e.text),['Found three flights under 2000 kr so far.','Two of them include a checked bag.']);
  // Automations post no updates to the chat.
  const autoQuiet=await quiet.runtime.create({userId:'a',chatId:'chat',requestKey:'auto-quiet',instructions:'Check news',context:{automation:true}});
  quiet.rows.get(autoQuiet.id).state.startedAt=Date.now()-60000;
  quiet.answers.push({functionCalls:[{name:'lookup',args:{}}]});
  for(let i=0;i<3;i++) await advance(autoQuiet.id);
  assert.equal(quiet.rows.get(autoQuiet.id).state.observations.length,1);
  assert.equal(progressCalls.length,3,'automations send no updates');
  // Nothing worth telling yet: no message, and the next look waits and reads only newer results.
  const empty=setup(),emptyCalls=[];empty.d.tools.lookup=quiet.d.tools.lookup;empty.d.progress=async req=>{emptyCalls.push(req);return '';};
  const emptyRow=await empty.create();empty.rows.get(emptyRow.id).state.startedAt=Date.now()-30000;
  empty.answers.push({functionCalls:[{name:'lookup',args:{}}]},{functionCalls:[{name:'lookup',args:{q:2}}]},{functionCalls:[{name:'lookup',args:{q:3}}]});
  for(let i=0;i<6;i++) await empty.runtime.step('a',emptyRow.id);
  assert.equal(emptyCalls.length,1,'an empty look is not repeated at once');
  empty.rows.get(emptyRow.id).state.updateCheckedAt=Date.now()-20000;
  await empty.runtime.step('a',emptyRow.id);
  assert.deepEqual(emptyCalls[1].results.map(o=>o.text.match(/kr (\d)/)?.[1]),['2','3']);
  assert.equal(empty.rows.get(emptyRow.id).state.events.filter(e=>e.phase==='task_update').length,0);
  // A failed update is simply not sent; the task goes on.
  const flaky=setup();flaky.d.tools.lookup=quiet.d.tools.lookup;flaky.d.progress=async()=>{throw Error('provider down');};
  const flakyRow=await flaky.create();flaky.rows.get(flakyRow.id).state.startedAt=Date.now()-30000;
  flaky.answers.push({functionCalls:[{name:'lookup',args:{}}]},{functionCalls:[{name:'lookup',args:{q:2}}]});
  for(let i=0;i<5;i++) await flaky.runtime.step('a',flakyRow.id);
  assert.equal(flaky.rows.get(flakyRow.id).state.status,'completed');
  assert.equal(flaky.rows.get(flakyRow.id).state.events.filter(e=>e.phase==='task_update').length,0);

  // A failed main call must settle the parallel update before the edge request ends.
  const failedWithUpdate=setup(),updateStarted=gate(),releaseUpdate=gate();
  failedWithUpdate.d.tools.lookup=quiet.d.tools.lookup;
  let updateSettled=false,stepSettled=false;
  failedWithUpdate.d.progress=async()=>{updateStarted.resolve();await releaseUpdate.promise;updateSettled=true;return '';};
  const failedRow=await failedWithUpdate.create();
  failedWithUpdate.rows.get(failedRow.id).state.startedAt=Date.now()-30000;
  failedWithUpdate.answers.push({functionCalls:[{name:'lookup',args:{}}]});
  await failedWithUpdate.runtime.step('a',failedRow.id);await failedWithUpdate.runtime.step('a',failedRow.id);
  failedWithUpdate.answers.push(async()=>{await updateStarted.promise;throw Error('main provider failed');});
  const failingStep=failedWithUpdate.runtime.step('a',failedRow.id).then(()=>{stepSettled=true;});
  await updateStarted.promise;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stepSettled,false,'the request waits for the parallel progress call to finish billing');
  releaseUpdate.resolve();await failingStep;
  assert.equal(updateSettled,true);assert.equal(failedWithUpdate.rows.get(failedRow.id).state.status,'failed');

  // A started task is confirmed in words written for the request, not a fixed sentence.
  const ackBase=(h,extra)=>({tasks:h.runtime,schemas:[],tools:{},azure:h.d.azure,store:{listMemories:async()=>[],saveTurn:async()=>{}},buildSystem:async()=>'',
    ensureCredit:async()=>{},logUsage:async()=>{},checkPrompt:h.d.checkPrompt,protect:(_,s)=>s,rank:x=>x,finishMemory:async()=>[],...extra});
  const acks=[];let ackModelCalls=0;
  const writeAck=async({prompt,title})=>{acks.push({prompt,title});return 'Building your tic tac toe game now.';};
  const directAck=setup(),directEvents=[];
  await createCoordinator(ackBase(directAck,{model:async()=>{ackModelCalls++;return {text:'x'};},acknowledge:writeAck}))
    .run({userId:'a',chatId:'chat',requestId:'ack-direct',prompt:'Make me a tic tac toe game',onEvent:e=>directEvents.push(e)});
  assert.equal(ackModelCalls,0,'a direct task still needs no coordinator call');
  assert.deepEqual(acks[0],{prompt:'Make me a tic tac toe game',title:'Make me a tic tac toe game'});
  assert.equal(directEvents.find(e=>e.type==='message').text,'Building your tic tac toe game now.');
  assert.ok(directEvents.findIndex(e=>e.type==='task')<directEvents.findIndex(e=>e.type==='message'),'the task starts before its confirmation is written');
  const failedAck=setup(),failedEvents=[];
  await createCoordinator(ackBase(failedAck,{model:async()=>({text:'x'}),acknowledge:async()=>{throw Error('provider down');}}))
    .run({userId:'a',chatId:'chat',requestId:'ack-failed',prompt:'Make me a tic tac toe game',onEvent:e=>failedEvents.push(e)});
  assert.ok(failedEvents.find(e=>e.type==='message').text.length>0,'a failed confirmation still gets a short reply');
  assert.doesNotMatch(failedEvents.find(e=>e.type==='message').text,/keep asking questions/);
  // A task the chat model starts is confirmed the same way, for the task it started.
  const chatAck=setup(),chatAckEvents=[];acks.length=0;
  await createCoordinator(ackBase(chatAck,{model:async()=>({functionCalls:[{name:'delegate_task',args:{title:'Lisbon hotels',instructions:'Find hotels'}}]}),acknowledge:writeAck}))
    .run({userId:'a',chatId:'chat',requestId:'ack-chat',prompt:'Find me a hotel in Lisbon for next weekend',onEvent:e=>chatAckEvents.push(e)});
  assert.deepEqual(acks,[{prompt:'Find me a hotel in Lisbon for next weekend',title:'Lisbon hotels'}]);
  assert.equal(chatAckEvents.find(e=>e.type==='message').text,'Building your tic tac toe game now.');
  // The confirmation sees the agent's last messages in the chat, so it does not start the same way.
  let ackRequest=null;
  const recentAck=setup();
  await createCoordinator(ackBase(recentAck,{store:{listMemories:async()=>[],saveTurn:async()=>{},listChatMessages:async()=>[{role:'user',text:'Weather?'},{role:'agent',text:'Checking the weather for you.'},{role:'user',text:'Thanks'},{role:'agent',text:'Sunny all day.'}]},
    model:async()=>({functionCalls:[{name:'delegate_task',args:{title:'Lisbon hotels',instructions:'Find hotels'}}]}),acknowledge:async r=>{ackRequest=r;return 'Lisbon it is.';}}))
    .run({userId:'a',chatId:'chat',requestId:'ack-recent',prompt:'Find me a hotel in Lisbon for next weekend',onEvent:()=>{}});
  assert.deepEqual(ackRequest.recent,['Checking the weather for you.','Sunny all day.']);
  // Steering keeps its own reply and needs no confirmation call.
  acks.length=0;const steerEvents=[];
  const steerable=[...chatAck.rows.values()].at(-1);
  await createCoordinator(ackBase(chatAck,{model:async()=>({functionCalls:[{name:'steer_task',args:{taskId:steerable.id,version:1,instruction:'Only Alfama'}}]}),acknowledge:writeAck}))
    .run({userId:'a',chatId:'chat',requestId:'ack-steer',prompt:'Only Alfama please',onEvent:e=>steerEvents.push(e)});
  assert.equal(acks.length,0);
  assert.match(steerEvents.find(e=>e.type==='message').text,/added your changes/);

  // A task that will use the browser starts the VM while its first plan is written, once;
  // research that reads pages through search never starts it.
  const warm=setup(),warmed=[];
  warm.d.azure.prewarm=async userId=>{warmed.push(userId);return {started:true};};
  const browserSchema=name=>({name,description:name,parameters:{type:'object',properties:{}}});
  warm.d.schemas=['browser_open','web_search'].map(browserSchema);
  warm.d.tools.web_search={run:async()=>({text:'Opening hours 17-23'})};
  warm.answers.push({functionCalls:[{name:'web_search',args:{query:'Pizzeria Bella'}}]},{text:'Booked.'});
  const booking=await warm.runtime.create({userId:'a',chatId:'chat',requestKey:'book',instructions:'Book a table at Pizzeria Bella for 4 at 7pm',history:[]});
  for(let i=0;i<4;i++) await warm.runtime.step('a',booking.id);
  assert.equal(warm.rows.get(booking.id).state.status,'completed');
  assert.deepEqual(warmed,['a'],'the VM is started once, during the first plan');
  const reader=setup(),researched=[];
  reader.d.azure.prewarm=async userId=>{researched.push(userId);return {started:true};};
  reader.d.schemas=warm.d.schemas;
  const plain=await reader.create();await reader.runtime.step('a',plain.id);
  assert.deepEqual(researched,[],'research does not start the VM');
  // Reads planned in one round run at once, in one step: three searches take the time of one.
  const par=setup();let inFlight=0,peak=0;
  par.d.tools.web_search={run:async a=>{inFlight++;peak=Math.max(peak,inFlight);await new Promise(r=>setTimeout(r,40));inFlight--;return [{url:`search:${a.query}`,ok:true,text:`found ${a.query}`}];}};
  par.d.tools.shell={run:async()=>({stdout:'ran'})};
  par.answers.push({functionCalls:[{name:'web_search',args:{query:'a'}},{name:'web_search',args:{query:'b'}},{name:'web_search',args:{query:'c'}}]},{text:'Done.'});
  const parRow=await par.create();
  await par.runtime.step('a',parRow.id);
  assert.equal(par.rows.get(parRow.id).state.pending.length,3);
  await par.runtime.step('a',parRow.id);
  const parState=par.rows.get(parRow.id).state;
  assert.equal(peak,3,'the three searches ran at the same time');
  assert.deepEqual(parState.pending,[]);
  assert.deepEqual(parState.observations.map(o=>o.text.split('\n')[0]),['[{"url":"search:a","ok":true,"text":"found a"}]','[{"url":"search:b","ok":true,"text":"found b"}]','[{"url":"search:c","ok":true,"text":"found c"}]']);
  assert.equal(parState.inflight,null);
  // One advance request runs the silent steps back to back (plan, searches, plan) and returns
  // with the answer, instead of one request per step.
  const adv=setup();adv.d.tools.web_search=par.d.tools.web_search;
  adv.answers.push({functionCalls:[{name:'web_search',args:{query:'x'}},{name:'web_search',args:{query:'y'}}]},{text:'Here is what I found.'});
  const advRow=await adv.create();
  const advanced=await adv.runtime.advance('a',advRow.id,{after:0});
  assert.equal(advanced.state.status,'completed','plan, parallel searches and answer in one request');
  assert.equal(advanced.state.result,'Here is what I found.');
  // It returns as soon as the owner has something new to see.
  const shown=setup();shown.d.tools.shell={run:async()=>({stdout:'ok'})};
  shown.answers.push({functionCalls:[{name:'shell',args:{command:'ls'}}]},{functionCalls:[{name:'shell',args:{command:'pwd'}}]},{text:'Done.'});
  const shownRow=await shown.create();
  const firstAdvance=await shown.runtime.advance('a',shownRow.id,{after:0});
  assert.equal(firstAdvance.state.status,'running');
  assert.equal(firstAdvance.state.observations.length,1,'stops after the step that showed the computer card');
  assert.equal(shown.calls.filter(c=>c.model).length,1,'the next plan waits for the next request');
  // A plan with an action in it keeps one call per step.
  const mixed=setup();mixed.d.tools.web_search=par.d.tools.web_search;mixed.d.tools.shell=par.d.tools.shell;
  mixed.answers.push({functionCalls:[{name:'shell',args:{command:'ls'}},{name:'web_search',args:{query:'d'}}]});
  const mixedRow=await mixed.create();
  await mixed.runtime.step('a',mixedRow.id);await mixed.runtime.step('a',mixedRow.id);
  assert.deepEqual(mixed.rows.get(mixedRow.id).state.observations.map(o=>o.name),['shell']);
  // Reasoning effort follows the job: research thinks at medium, building and acting on a site
  // at high, and the round after a failed step at high.
  const {workerEffort}=require('../server/agents/task-runtime');
  const effortState={version:1,context:{},observations:[{name:'web_search',ok:true,version:1}]};
  assert.equal(workerEffort({state:effortState,tools:['web_search','present']}),'medium');
  assert.equal(workerEffort({state:effortState,tools:['web_search','build_page']}),'high');
  assert.equal(workerEffort({state:effortState,tools:['browser_open']}),'high');
  assert.equal(workerEffort({state:{...effortState,observations:[{name:'web_search',ok:false,version:1}]},tools:['web_search']}),'high');
  process.env.AZURE_FOUNDRY_WORKER_EFFORT='xhigh';
  assert.equal(workerEffort({state:effortState,tools:['web_search']}),'xhigh','one effort for every task when set');
  delete process.env.AZURE_FOUNDRY_WORKER_EFFORT;
  assert.equal(warm.calls.find(c=>c.model)?.model.reasoningEffort,'high','a booking plans at high effort');
  // The owner's words decide, not the brief the chat wrote ("do not book anything").
  const weekend=await reader.runtime.create({userId:'a',chatId:'chat',requestKey:'plan',instructions:'Plan the weekend with times and places. Do not book anything.',context:{originalPrompt:'Plan a 2 day trip to Gothenburg'},history:[]});
  await reader.runtime.step('a',weekend.id);
  assert.deepEqual(researched,[],'a brief that says not to book does not start the VM');
  console.log('chat tasks: concurrent replies, steering, exact approvals, recovery, owner scoping, milestones, updates, confirmations, VM prewarm, stop, no round cap, stall guard: ok');
})().catch(e=>{console.error(e);process.exitCode=1;});
