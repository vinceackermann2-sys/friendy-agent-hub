const assert = require('node:assert/strict');
const store = require('../server/store');
const auth = require('../server/auth');
const mail = require('../server/mail');
const runner = require('../server/agents/runner');
const {upkeepRows} = require('../server/agents/upkeep');

const routine = upkeepRows('owner').find(row=>row.systemKind==='personal_email');
assert.equal(routine.enabled,false,'off until the owner turns it on');
routine.enabled=true;
const evidence = 'I am learning Swedish for my trip';
let result = JSON.stringify({subject:'A little Swedish for your trip', body:`You said “${evidence}”. Try a five-minute practice today.`, evidence});
let taskInput, sentBody, requests=0, final, nextRun;
const run={id:'run-1',sub_agent_id:routine.id,status:'running',started_at:new Date().toISOString()};
const tasks={
  async create(input){taskInput=input;return {id:'task-1',revision:1,state:{status:'queued'}};},
  async step(){return {id:'task-1',revision:2,state:{status:'completed',result}};},
};
const conversationPath=require.resolve('../server/agents/conversation');
require.cache[conversationPath]={id:conversationPath,filename:conversationPath,loaded:true,exports:{tasks}};
const {parsePersonalCheckIn,executeSubAgent}=require('../server/agents/automations');

(async()=>{
  assert.equal(parsePersonalCheckIn('{"skip":true}',[]),null);
  assert.throws(()=>parsePersonalCheckIn(result,[{text:'Unrelated conversation'}]),/evidence/);
  assert.throws(()=>parsePersonalCheckIn('not json',[]));
  assert.equal(parsePersonalCheckIn(result,[{text:evidence}]).subject,'A little Swedish for your trip');
  assert.match(mail.brandEmailHtml({agentColor:'rose'}),/email-rose\.png/);
  assert.match(mail.brandEmailHtml({agentColor:'../bad'}),/email-lingon\.png/);
  assert.match(mail.brandEmailHtml({personalCheckIn:true}),/Pause personal check-ins/);

  runner.ensureCredit=async()=>{};
  store.getAgentContext=async()=>({agent:{name:'Alva',color:'rose'}});
  store.getSubAgent=async()=>routine;
  store.getAutomationRunByDedupeKey=async(_owner,key)=>key==='slot-1'?run:null;
  store.listUpkeepSignals=async()=>[{role:'user',text:evidence,created_at:new Date().toISOString()}];
  store.listMailMessages=async()=>[];
  store.beginAutomationRun=async()=>run;
  store.attachAutomationTask=async()=>{};
  store.finishAutomationRun=async(_owner,_id,status,_result,error)=>{final={status,error};return true;};
  store.markSubAgentRun=async(_owner,_id,_status,_error,next)=>{nextRun=next;};
  store.logToolRun=async()=>{};
  store.getMailboxByUser=async()=>({address:'alva@mail.belna.se',displayName:'Alva'});
  store.countOutboundMailToday=async()=>0;
  store.insertMailMessage=async(_owner,row)=>({id:'message-1',...row});
  auth.adminClient=()=>({auth:{admin:{getUserById:async()=>({data:{user:{email:'owner@example.com',email_confirmed_at:'2026-09-20'}}})}}});
  process.env.RESEND_API_KEY='fake-resend-key';
  global.fetch=async(_url,init)=>{
    requests++; sentBody=JSON.parse(init.body);
    assert.equal(init.headers['Idempotency-Key'],'personal-check-in/run-1');
    return Response.json({id:'provider-1'});
  };
  const sent=await executeSubAgent({userId:'owner',subAgent:routine,event:{type:'manual',dedupeKey:'slot-1'}});
  assert.equal(sent.status,'done');
  assert.match(sent.output,/Emailed you/);
  assert.deepEqual(sentBody.to,['owner@example.com']);
  assert.match(sentBody.from,/Alva/);
  assert.match(sentBody.html,/email-rose\.png/);
  assert.deepEqual(taskInput.context.allowedTools,[],'the check-in cannot act on apps or send to contacts');
  assert(taskInput.instructions.includes(evidence),'manual runs also receive the conversation evidence');
  assert(Date.parse(nextRun)>Date.now()+47*60*60_000);

  routine.enabled=false;
  assert.equal((await mail.sendPersonalCheckIn('owner',{subAgentId:routine.id,runId:'slot-1'})).skipped,true);
  assert.equal(requests,1);
  routine.enabled=true;
  auth.adminClient=()=>({auth:{admin:{getUserById:async()=>({data:{user:{email:'unverified@example.com'}}})}}});
  await assert.rejects(mail.sendPersonalCheckIn('owner',{subAgentId:routine.id,runId:'slot-1'}),/verified account/);
  assert.equal(requests,1);
  run.started_at='2020-01-01';
  await assert.rejects(mail.sendPersonalCheckIn('owner',{subAgentId:routine.id,runId:'slot-1'}),/expired/);
  run.started_at=new Date().toISOString();

  result='{"skip":true}';
  await executeSubAgent({userId:'owner',subAgent:routine,event:{type:'manual',dedupeKey:'slot-1'}});
  assert.equal(final.status,'idle');
  assert.equal(requests,1);
  result='{"subject":"Made up","body":"You won!","evidence":"Something never said"}';
  await executeSubAgent({userId:'owner',subAgent:routine,event:{type:'manual',dedupeKey:'slot-1'}});
  assert.equal(final.status,'error');
  assert.equal(requests,1);
  console.log('personal check-in: schedule, grounded note, owner-only delivery, pause, verification, expiry and skips: ok');
})().catch(error=>{console.error(error);process.exitCode=1;});
