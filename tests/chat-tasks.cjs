const assert=require('node:assert/strict');
const {createTaskRuntime}=require('../server/agents/task-runtime');
const {createCoordinator}=require('../server/agents/conversation');
const clone=x=>x==null?x:structuredClone(x);
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
    model:async opts=>{calls.push({model:opts});const a=answers.shift();return typeof a==='function'?a(opts):a || {text:'Verified answer'};}};
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
  await main.run({userId:'a',chatId:'chat',requestId:'request',prompt:'Research',onEvent:e=>events.push(e)});
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
  await toolThen.run({userId:'a',chatId:'chat',requestId:'retract',prompt:'Research',onEvent:e=>retracted.push(e)});
  assert.ok(retracted.some(e=>e.type==='message_retract'));
  assert.ok(retracted.some(e=>e.type==='task'));
  assert.deepEqual(degradedModels[0].tools.map(t=>t.name),['history_search']);
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
  await m.runtime.step('a',mid);assert.equal(m.rows.get(mid).state.status,'completed');
  assert.equal(m.rows.get(mid).state.events.at(-1).phase,'task_answer');
  const failedEvidence=setup();failedEvidence.d.tools.lookup={run:async()=>[{ok:false,error:'Could not fetch'}]};
  const fid=await planned(failedEvidence,'lookup');await failedEvidence.runtime.step('a',fid);
  const failedRef=failedEvidence.rows.get(fid).state.observations[0].id;
  failedEvidence.answers.push({functionCalls:[{name:'report_milestone',args:{summary:'False success',evidenceIds:[failedRef]}}]});await failedEvidence.runtime.step('a',fid);
  assert.equal(failedEvidence.rows.get(fid).state.events.length,0);

  // Only explicitly budgeted runs (automations) stop at a round limit.
  const budget=setup();const br=await budget.create();budget.rows.get(br.id).state.context.maxRounds=8;budget.rows.get(br.id).state.round=8;
  await budget.runtime.step('a',br.id);assert.equal(budget.rows.get(br.id).state.status,'partial');
  // Tools stay listed so the cached prompt prefix survives, but calls are disabled.
  assert.equal(budget.calls.find(c=>c.model).model.toolChoice,'none','budget stops further tool planning');
  await budget.runtime.control('a',br.id,{action:'continue',version:1},'chat');
  assert.equal(budget.rows.get(br.id).state.round,0);assert.equal(budget.rows.get(br.id).state.status,'queued');
  const longChange='Full constraint '.repeat(390);
  await budget.runtime.control('a',br.id,{action:'steer',version:2,instruction:longChange},'chat');
  await budget.runtime.step('a',br.id);
  assert.ok(budget.calls.filter(c=>c.model).at(-1).model.history.map(h=>h.text).join('').includes(longChange.slice(-900)),'long steering instructions reach the model');

  const crashed=setup();crashed.d.tools.send=a.d.tools.send;const cid=await planned(crashed,'send');
  crashed.rows.get(cid).state.inflight={kind:'tool',name:'send'};
  await crashed.runtime.step('a',cid);assert.equal(crashed.rows.get(cid).state.status,'needs_review');assert.equal(sent.length,1);
  const uncertain=setup();uncertain.d.tools.send={approval:false,run:async()=>{throw Error('Network lost');}};
  uncertain.d.tools.shell=uncertain.d.tools.send;const uid=await planned(uncertain,'shell');await uncertain.runtime.step('a',uid);
  assert.equal(uncertain.rows.get(uid).state.status,'needs_review');

  const stop=setup(),toolEntered=gate(),toolRelease=gate();stop.d.tools.shell={run:async()=>{toolEntered.resolve();return toolRelease.promise;}};
  const stopId=await planned(stop,'shell');const action=stop.runtime.step('a',stopId);await toolEntered.promise;
  await stop.runtime.control('a',stopId,{action:'cancel',version:1},'chat');assert.equal(stop.rows.get(stopId).state.status,'stopping');
  toolRelease.resolve({stdout:'Done'});await action;
  assert.equal(stop.rows.get(stopId).state.status,'stopped');assert.equal(stop.rows.get(stopId).state.observations.length,1);
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
  // A failing search is reported to the model instead of failing the turn.
  const failedModels=[];
  await chat(async opts=>{failedModels.push(opts);return failedModels.length===1?{functionCalls:[{name:'web_search',args:{}}]}:{text:'Answered without the search.'};},
    {schemas:[searchSchema],tools:{web_search:{run:async()=>{throw new Error('A search query or URL is required.');}}}})
    .run({userId:'a',chatId:'chat',requestId:'search-fail',prompt:'Latest news?',onEvent:()=>{}});
  assert.match(failedModels[1].history.at(-1).text,/web_search result \(untrusted\).*required/);
  // Tasks have no fixed round limit, and workers always see the core tools.
  const schemaFor=name=>({name,description:name,parameters:{type:'object',properties:{}}});
  const runToEnd=async(h,id)=>{for(let i=0;i<60 && !['completed','partial','failed','needs_review','waiting_approval'].includes(h.rows.get(id).state.status);i++) await h.runtime.step('a',id);return h.rows.get(id).state;};
  const long=setup();
  long.d.schemas=['web_search','browser_open','browser_action','shell','mail_send'].map(schemaFor);long.d.selectSchemas=()=>[];
  long.d.tools.web_search={run:async a=>[{ok:true,text:`result for ${a.query}`}]};
  for(let i=0;i<12;i++) long.answers.push({functionCalls:[{name:'web_search',args:{query:`q${i}`}}]});
  long.answers.push({text:'Finished after 12 searches.'});
  const longState=await runToEnd(long,(await long.create()).id);
  assert.equal(longState.status,'completed');
  assert.equal(longState.result,'Finished after 12 searches.');
  const workerTools=long.calls.find(c=>c.model).model.tools.map(t=>t.name);
  for(const name of ['web_search','browser_open','browser_action','shell']) assert.ok(workerTools.includes(name),`core tool ${name} is always loaded`);
  assert.ok(!workerTools.includes('mail_send'),'specialised tools still need a keyword or capability_search');
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
  seer.d.tools.browser_open={run:async a=>({url:a.url,title:'Shop',elements:['[1] button "Buy" @640,450'],screenshot:'data:image/jpeg;base64,SU1BR0U='})};
  seer.d.tools.web_search={run:async()=>[{ok:true,text:'results'}]};
  seer.answers.push({functionCalls:[{name:'browser_open',args:{url:'https://shop.example/'}}]},{functionCalls:[{name:'web_search',args:{query:'reviews'}}]},{text:'Done.'});
  const seerState=await runToEnd(seer,(await seer.create()).id);
  const seerModels=seer.calls.filter(c=>c.model).map(c=>c.model);
  assert.equal(seerModels[0].attachments,undefined,'no image before the browser was used');
  assert.deepEqual(seerModels[1].attachments,[{inlineData:{mimeType:'image/jpeg',data:'SU1BR0U='}}]);
  assert.match(seerModels[1].prompt,/current screen/);
  assert.equal(seerModels[2].attachments,undefined,'the image is only sent right after a browser step');
  assert.ok(!JSON.stringify(seerState).includes('SU1BR0U='),'screenshots are not stored in task state');
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
  vault.d.tools.browser_fill_secret={approval:true,approvalDetail:async(args,{userId})=>JSON.stringify({...args,summary:`Type your saved “GitHub password” on ${args.host} for ${userId}`}),run:async()=>({url:'https://github.com/'})};
  vault.answers.push({functionCalls:[{name:'browser_fill_secret',args:{secret:'sec_gh12',ref:2,host:'github.com'}}]});
  const vaultState=await runToEnd(vault,(await vault.create()).id);
  assert.equal(vaultState.status,'waiting_approval');
  assert.equal(JSON.parse(vaultState.events.find(e=>e.card?.type==='approval').card.detail).summary,'Type your saved “GitHub password” on github.com for a');
  // Automations keep their explicit round budget.
  const capped=setup();capped.d.schemas=[schemaFor('web_search')];capped.d.selectSchemas=()=>[];
  capped.d.tools.web_search={run:async a=>[{ok:true,text:String(Math.random())}]};
  for(let i=0;i<10;i++) capped.answers.push(opts=>opts.toolChoice==='none'?{text:'Automation summary.'}:{functionCalls:[{name:'web_search',args:{query:`a${i}`}}]});
  const autoRow=await capped.runtime.create({userId:'a',chatId:'chat',requestKey:'auto',instructions:'Check news',context:{automation:true,maxRounds:3}});
  const cappedState=await runToEnd(capped,autoRow.id);
  assert.equal(cappedState.status,'partial');assert.equal(cappedState.result,'Automation summary.');
  console.log('chat tasks: concurrent replies, steering, exact approvals, recovery, owner scoping, milestones, stop, no round cap, stall guard: ok');
})().catch(e=>{console.error(e);process.exitCode=1;});
