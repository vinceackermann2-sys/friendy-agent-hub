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

  const budget=setup();const br=await budget.create();budget.rows.get(br.id).state.round=8;
  await budget.runtime.step('a',br.id);assert.equal(budget.rows.get(br.id).state.status,'partial');
  assert.equal(budget.calls.find(c=>c.model).model.tools.length,0,'budget stops further tool planning');
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
  console.log('chat tasks: concurrent replies, steering, exact approvals, recovery, owner scoping, milestones, stop: ok');
})().catch(e=>{console.error(e);process.exitCode=1;});
