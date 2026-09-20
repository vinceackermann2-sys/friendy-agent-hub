const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {createTaskRuntime}=require('../server/agents/task-runtime');
const {createCoordinator}=require('../server/agents/conversation');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
(async()=>{
  const db=new PGlite();
  await db.exec("create role anon;create role authenticated;create role service_role;create table profiles(id text primary key);insert into profiles values('owner'),('other');");
  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20260919160000_chat_tasks.sql'),'utf8').split('-- Hosted recovery pump.')[0]);
  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20260919180000_chat_task_teams.sql'),'utf8'));
  const q=async(sql,params=[]) => (await db.query(sql,params)).rows;
  const first=async(sql,params)=>(await q(sql,params))[0] || null;
  const records={
    get:(u,id)=>first('select * from agent_chat_tasks where user_id=$1 and id=$2',[u,id]),
    list:(u,c)=>q('select * from agent_chat_tasks where user_id=$1 and chat_id=$2 order by created_at',[u,c]),
    team:(u,id)=>q('select * from chat_task_team($1,$2)',[u,id]),
    create:r=>first('select * from create_chat_task($1,$2,$3,$4,$5)',[r.id,r.user_id,r.chat_id,r.request_key,r.state]),
    claim:(u,id,t)=>first('select * from claim_chat_task($1,$2,$3)',[id,u,t]),
    write:(r,s,t)=>first('select * from write_chat_task($1,$2,$3,$4,$5)',[r.id,r.user_id,r.revision,t,s]),
    release:(u,id,t)=>q('select release_chat_task($1,$2,$3)',[id,u,t]),
    messagePeer:(u,a,b,c,v,m)=>first('select message_chat_task_peer($1,$2,$3,$4,$5,$6) as result',[u,a,b,c,v,m]).then(r=>r.result),
    steerTeam:(u,id,v,s,key)=>q('select * from steer_chat_task_team($1,$2,$3,$4,$5)',[u,id,v,s,key]),
  };
  const replies=[],prompts=[],executed=[];
  const d={records,schemas:[],tools:{lookup:{run:async()=>({finding:'Verified price is 50',url:'https://example.com'})},write:{approval:true,run:async a=>{executed.push(a);return {ok:true};}}},
    ensureCredit:async()=>{},checkPrompt:p=>{if(!p)throw Error('Prompt required');},protect:(_,s)=>s,logUsage:async()=>{},
    memory:{list:async()=>[],rank:x=>x,finish:async()=>[]},azure:{getSandbox:async()=>({mode:'azure'})},buildSystem:async()=>'',emitResultCard:()=>{},
    model:async opts=>{prompts.push(opts);const r=replies.shift();return typeof r==='function'?r(opts):r || {text:'Component result'};}};
  const rt=createTaskRuntime(d);let n=0;
  const create=(instructions,teamId='objective',userId='owner',chatId='chat')=>rt.create({userId,chatId,requestKey:`request-${++n}`,instructions,context:{teamId,originalPrompt:'Find a solution below 100. Deliver in English.'}});
  const a=await create('Compare prices');const b=await create('Check quality');
  const outsider=await create('Unrelated task','different');
  const foreign=await create('Other account','objective','other');
  await assert.rejects(create('Duplicate third worker'),/two active workers/);
  assert.equal((await rt.teamSnapshot('owner',a.id)).peers.length,1);
  await assert.rejects(rt.peerDetails('owner',a.id,outsider.id),/not in this task team/);
  await assert.rejects(rt.peerDetails('owner',a.id,foreign.id),/not found/);
  replies.push({functionCalls:[{name:'lookup',args:{}}]});await rt.step('owner',a.id);await rt.step('owner',a.id);
  const evidence=(await records.get('owner',a.id)).state.observations[0].id;
  replies.push({functionCalls:[{name:'write',args:{amount:50}}]});await rt.step('owner',b.id);await rt.step('owner',b.id);
  const approval=(await records.get('owner',b.id)).state.approval;
  assert.ok(approval);
  replies.push({functionCalls:[{name:'message_peer',args:{taskId:b.id,kind:'finding',text:'Price is 50; check whether quality is sufficient.',evidenceIds:[evidence]}}]});
  await rt.step('owner',a.id);
  const messageCall=(await records.get('owner',a.id)).state.pending[0];
  await rt.step('owner',a.id);
  let recipient=(await records.get('owner',b.id)).state;
  assert.equal(recipient.inbox.length,1);assert.equal(recipient.approval,null);assert.deepEqual(recipient.pending,[]);
  assert.equal(recipient.events.at(-1).status,'expired');
  await records.messagePeer('owner',a.id,b.id,messageCall.id,1,messageCall.args);
  assert.equal((await records.get('owner',b.id)).state.inbox.length,1,'delivery retries are idempotent');
  await assert.rejects(rt.control('owner',b.id,{action:'decide',version:1,callId:approval.id,allow:true},'chat'),/no longer pending/);
  await rt.step('owner',b.id);
  assert.match(JSON.stringify(prompts.at(-1)),/Price is 50/,'recipient receives the message in its next model context');
  assert.equal(executed.length,0,'peer messages never authorize a tool');
  assert.match((await rt.peerDetails('owner',b.id,a.id,evidence)).text,/Verified price is 50/);

  // Team-wide user changes revise completed components as well as active work.
  const changed=await rt.steerTeam('owner',a.id,{version:1,instruction:'Use Swedish and a maximum of 75.',requestId:'owner-change'},'chat');
  assert.equal(changed.length,2);
  for(const row of changed){assert.equal(row.state.version,2);assert.equal(row.state.status,'queued');assert.match(row.state.sharedInstructions,/Swedish/);assert.equal(row.state.result,null);}
  assert.equal((await records.get('owner',outsider.id)).state.version,1);
  assert.equal((await records.get('other',foreign.id)).state.version,1);
  await rt.steerTeam('owner',a.id,{version:1,instruction:'retry',requestId:'owner-change'},'chat');
  assert.equal((await records.get('owner',a.id)).state.version,2);

  // A peer discovery during inference invalidates the old final answer.
  const entered=deferred(),release=deferred();
  replies.push(async()=>{entered.resolve();return release.promise;});
  const inference=rt.step('owner',a.id);await entered.promise;
  await q("update agent_chat_tasks set state=jsonb_set(state,'{milestones}',$1),revision=revision+1 where id=$2",[[{text:'Quality conflict found',refs:[],version:2}],b.id]);
  release.resolve({text:'Everything agrees — stale answer'});await inference;
  assert.notEqual((await records.get('owner',a.id)).state.result,'Everything agrees — stale answer');

  // A planned approval/action is invalidated by a new peer finding.
  replies.push({functionCalls:[{name:'write',args:{amount:75}}]});await rt.step('owner',a.id);await rt.step('owner',a.id);
  const pendingApproval=(await records.get('owner',a.id)).state.approval;
  await q("update agent_chat_tasks set state=jsonb_set(state,'{milestones}',$1),revision=revision+1 where id=$2",[[{text:'Offer no longer available',refs:[],version:2}],b.id]);
  await assert.rejects(rt.control('owner',a.id,{action:'decide',version:2,callId:pendingApproval.id,allow:true},'chat'),/no longer pending/);
  assert.equal(executed.length,0);

  // Delivery validates evidence, owner/team boundary and current sender call.
  const sender=await records.get('owner',a.id);
  await q("update agent_chat_tasks set state=state || $1,lease_token=$2,lease_until=now()+interval '1 minute' where id=$3",[{status:'running',inflight:{id:'send'},pending:[{id:'send'}]},'11111111-1111-4111-8111-111111111111',a.id]);
  await assert.rejects(records.messagePeer('owner',a.id,b.id,'send',2,{kind:'finding',text:'Unverified',evidenceIds:['fake']}),/Evidence is not/);
  await assert.rejects(records.messagePeer('owner',a.id,outsider.id,'send',2,{kind:'question',text:'Hello',evidenceIds:[]}),/not in this task team/);
  await assert.rejects(records.messagePeer('owner',a.id,foreign.id,'send',2,{kind:'question',text:'Hello',evidenceIds:[]}),/not in this task team/);
  const beforeBudget=(await records.get('owner',b.id)).state.inbox;
  await q("update agent_chat_tasks set state=jsonb_set(state,'{inbox}',$1) where id=$2",[Array.from({length:16},(_,i)=>({id:`old-${i}`})),b.id]);
  await assert.rejects(records.messagePeer('owner',a.id,b.id,'send',2,{kind:'question',text:'Another question',evidenceIds:[]}),/budget reached/);
  await q("update agent_chat_tasks set state=jsonb_set(state,'{inbox}',$1) where id=$2",[beforeBudget,b.id]);
  await q('update agent_chat_tasks set state=$1,lease_token=null,lease_until=null where id=$2',[sender.state,a.id]);

  await q("update agent_chat_tasks set state=jsonb_set(state,'{status}','\"completed\"') where id=$1",[b.id]);
  const joined=await rt.create({userId:'owner',chatId:'chat',requestKey:'later-review',instructions:'Reconcile the findings',relatedTaskId:a.id,context:{originalPrompt:'Combine the results'}});
  assert.match(joined.state.sharedInstructions,/Swedish/,'later workers inherit shared changes');
  assert.equal(joined.state.sharedGoal,a.state.sharedGoal);
  const compact=await q('select * from list_chat_tasks($1,$2,$3,$4)',['owner','chat',{},false]);
  assert.equal(compact.find(r=>r.id===joined.id).state.teamId,a.state.teamId);

  // The main agent reads team evidence, then returns the combined answer.
  const mainReplies=[{functionCalls:[{name:'team_details',args:{taskId:a.id}}]},{text:'The price fits, but quality still needs verification.'}];
  const mainInputs=[],events=[];
  const main=createCoordinator({tasks:rt,model:async o=>{mainInputs.push(o);return mainReplies.shift();},schemas:[],tools:{},azure:d.azure,
    store:{listMemories:async()=>[],saveTurn:async()=>{}},buildSystem:async()=>'',ensureCredit:async()=>{},logUsage:async()=>{},checkPrompt:d.checkPrompt,protect:(_,s)=>s,rank:x=>x,finishMemory:async()=>[]});
  await main.run({userId:'owner',chatId:'chat',requestId:'review',prompt:'What is the combined result?',onEvent:e=>events.push(e)});
  assert.equal(mainInputs.length,2);assert.match(JSON.stringify(mainInputs[1].history),/Swedish/);assert.match(events.at(-1).text,/verification/);
  await db.exec('set role authenticated');
  await assert.rejects(q('select * from chat_task_team($1,$2)',['owner',a.id]),/permission denied/);
  await db.close();
  console.log('chat task teams: real SQL + runtime messaging, shared constraints, evidence checks, stale results/approvals, scope isolation, main synthesis: ok');
})().catch(e=>{console.error(e);process.exitCode=1;});
