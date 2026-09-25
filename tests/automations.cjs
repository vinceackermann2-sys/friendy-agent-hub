const assert = require('node:assert/strict');
const { eventMatches } = require('../server/agents/triggers');

assert.equal(eventMatches({type:'app',app:'github',event:'new_issue'}, {type:'app',app:'GITHUB',event:'NEW_ISSUE'}), true);
assert.equal(eventMatches({type:'app',app:'github',event:'new_issue',connectedAccountId:'ca_one'}, {type:'app',app:'github',event:'NEW_ISSUE',connectedAccountId:'ca_two'}), false);

const store = require('../server/store');
const runner = require('../server/agents/runner');
runner.ensureCredit = async () => {};
const taskRows = new Map();
let stopAfterCreate = false;
let waitingApproval = false;
const tasks = {
  async create(input) {
    const row = {id:`task-${taskRows.size+1}`,revision:1,state:{status:'queued',result:''}};
    taskRows.set(row.id,{row,input});
    return row;
  },
  async step(_userId,id) {
    const entry=taskRows.get(id);
    if (stopAfterCreate) return entry.row;
    if (waitingApproval) {
      entry.row={...entry.row,revision:entry.row.revision+1,state:{status:'waiting_approval',result:''}};
      return entry.row;
    }
    entry.row={...entry.row,revision:entry.row.revision+1,state:{status:'completed',result:'Checked the source.'}};
    return entry.row;
  },
  async owned(_userId,id) { return taskRows.get(id).row; },
};
const conversationPath=require.resolve('../server/agents/conversation');
require.cache[conversationPath]={id:conversationPath,filename:conversationPath,loaded:true,exports:{tasks}};
const automations=require('../server/agents/automations');

const owner='owner-a';
const agents=[
  {id:'app-agent',userId:owner,chatId:'chat-app',name:'Issue watcher',prompt:'Check the issue',enabled:true,trigger:{type:'app',app:'github',event:'new_issue'}},
  {id:'next-agent',userId:owner,chatId:'chat-next',name:'Follow-up',prompt:'Summarize the check',enabled:true,trigger:{type:'subagent',sourceAgentId:'app-agent',event:'completed'}},
];
const runs=new Map(), dedupe=new Set(), marks=[], turns=[];
store.listSubAgents=async()=>agents;
store.getSubAgent=async(_owner,id)=>agents.find(a=>a.id===id);
store.listChatMessages=async()=>[];
store.getAgentContext=async()=>({agent:{}});
store.saveTurn=async(...args)=>{turns.push(args);};
store.logToolRun=async()=>{};
store.beginAutomationRun=async(userId,subAgentId,chatId,key,event)=>{
  if(dedupe.has(key))return null;
  dedupe.add(key);
  const row={id:`run-${runs.size+1}`,user_id:userId,sub_agent_id:subAgentId,chat_id:chatId,dedupe_key:key,status:'running',event,started_at:new Date().toISOString()};
  runs.set(row.id,row);return row;
};
let failAttach=false;
store.attachAutomationTask=async(_owner,id,taskId)=>{if(failAttach){failAttach=false;throw new Error('Storage timeout');}runs.get(id).result={taskId};};
const records=require('../server/agents/task-store');
records.byRequestKey=async(_owner,key)=>[...taskRows.values()].find(entry=>entry.input.requestKey===key)?.row || null;
store.getAutomationRunByDedupeKey=async(_owner,key)=>[...runs.values()].find(row=>row.dedupe_key===key) || null;
store.finishAutomationRun=async(_owner,id,status,result,error)=>{
  const row=runs.get(id);
  if(!['running','waiting_approval'].includes(row.status))return false;
  Object.assign(row,{status,result,error});return true;
};
store.markSubAgentRun=async(_owner,id,status,error,next)=>{marks.push({id,status,error,next});};
store.listPendingAutomationRuns=async()=>[...runs.values()].filter(row=>['running','waiting_approval'].includes(row.status));
store.listDueSubAgents=async()=>[];
store.listAppSubAgentsForSync=async()=>[];
const appSync=[];
store.markAppTriggerSync=async(...args)=>{appSync.push(args);};

(async()=>{
  const event={type:'app',app:'GITHUB',event:'NEW_ISSUE',eventId:'evt-1',payload:{issue:42}};
  const first=await automations.dispatchAppEvent(owner,event);
  assert.equal(first.length,1);
  assert.equal(first[0].status,'done');
  assert.equal(runs.size,2,'completed app automation started its dependent');
  assert.equal(marks.filter(row=>row.status==='done').length,2);
  assert.equal((await automations.dispatchAppEvent(owner,event))[0].duplicate,true,'webhook retry is deduplicated');
  assert.equal(runs.size,2);
  assert.equal(turns.filter(row=>row[2]==='user').length,2);

  const staleKey='app-agent:schedule:old-slot';
  dedupe.add(staleKey);
  runs.set('old-run',{id:'old-run',user_id:owner,sub_agent_id:'app-agent',dedupe_key:staleKey,status:'error',error:'Earlier attempt failed.',result:null});
  const stale=await automations.executeSubAgent({userId:owner,subAgent:{...agents[0],trigger:{type:'schedule',intervalMinutes:60}},event:{type:'schedule',dedupeKey:staleKey}});
  assert.equal(stale.duplicate,true);
  assert.equal(marks.at(-1).status,'error');
  assert(Date.parse(marks.at(-1).next)>Date.now(),'a completed duplicate cannot hold the due queue open');

  stopAfterCreate=true;
  const pending=await automations.executeSubAgent({userId:owner,subAgent:agents[0],event:{...event,eventId:'evt-2',dedupeKey:'app-agent:app:evt-2'}});
  assert.equal(pending.status,'running','a task owned by another worker remains pending');
  const saved=runs.get(pending.runId);
  assert.equal(saved.result.taskId,pending.taskId);
  taskRows.get(pending.taskId).row={id:pending.taskId,revision:3,state:{status:'completed',result:'Finished later.'}};
  await automations.tick();
  assert.equal(saved.status,'done','the scheduler reconciles a task completed after the request ends');
  assert.equal(marks.filter(row=>row.id==='app-agent'&&row.status==='done').length,2);

  stopAfterCreate=false;
  waitingApproval=true;
  const scheduled={...agents[0],id:'scheduled-agent',chatId:'chat-scheduled',trigger:{type:'schedule',intervalMinutes:60}};
  agents.push(scheduled);
  const approval=await automations.executeSubAgent({userId:owner,subAgent:scheduled,event:{type:'schedule',dedupeKey:'scheduled-agent:schedule:approval'}});
  assert.equal(approval.status,'waiting_approval');
  assert.equal(marks.filter(row=>row.id==='scheduled-agent').at(-1).next,null,'pending approval pauses the schedule');
  waitingApproval=false;
  taskRows.get(approval.taskId).row={id:approval.taskId,revision:5,state:{status:'completed',result:'Approved action finished.'}};
  await automations.tick();
  assert.equal(runs.get(approval.runId).status,'done','approval completion is reconciled');
  assert(Date.parse(marks.filter(row=>row.id==='scheduled-agent').at(-1).next)>Date.now(),'schedule resumes after approval');

  failAttach=true;
  const detached=await automations.executeSubAgent({userId:owner,subAgent:scheduled,event:{type:'schedule',dedupeKey:'scheduled-agent:schedule:detached'}});
  assert.equal(detached.status,'running','uncertain task attachment is left for reconciliation');
  assert.equal(runs.get(detached.runId).status,'running');
  taskRows.get(detached.taskId).row={id:detached.taskId,revision:2,state:{status:'completed',result:'Recovered result.'}};
  await automations.tick();
  assert.equal(runs.get(detached.runId).status,'done');

  const upstream=agents[0];
  const upkeep={id:'upkeep-memory',userId:owner,chatId:'chat-upkeep',name:'Memory upkeep',prompt:'Review memory',enabled:true,systemKind:'memory',trigger:{type:'schedule',intervalMinutes:60}};
  store.listUpkeepSignals=async()=>[{role:'user',text:'Remember that I prefer short reports.',created_at:new Date(Date.now()-3600000).toISOString()}];
  stopAfterCreate=false;
  const result=await automations.executeSubAgent({userId:owner,subAgent:upkeep,event:{type:'schedule',firedAt:new Date().toISOString()}});
  assert.equal(result.status,'done');
  assert.deepEqual(taskRows.get(result.taskId).input.context.allowedTools,['memory_search','memory_get','memory_write','memory_update']);
  const composio=require('../server/composio');
  composio.ensureAppTrigger=async(...args)=>{appSync.push(args);};
  store.listAppSubAgentsForSync=async()=>[agents[0]];
  await automations.tick();
  assert.deepEqual(appSync[0],[owner,'github','new_issue',undefined],'existing app automations are registered in the background');
  assert.deepEqual(appSync[1],[owner,'app-agent',null]);
  store.listAppSubAgentsForSync=async()=>[];
  store.listUpkeepSignals=async()=>[];
  const backlog=Array.from({length:12},(_,i)=>({...upkeep,id:`idle-${i}`,nextRunAt:new Date(Date.now()-60000).toISOString()}));
  store.listDueSubAgents=async(_now,limit)=>{assert.equal(limit,20);return backlog;};
  const drained=await automations.tick();
  assert.equal(drained.processed,12,'idle upkeep backlog drains in bounded batches');
  assert.equal(marks.filter(row=>row.status==='idle').length,12);
  assert.equal(upstream.id,'app-agent');
  console.log('automation dispatch, chaining, webhook dedupe, recovery, and built-in execution: ok');
})().catch(error=>{console.error(error);process.exitCode=1;});
