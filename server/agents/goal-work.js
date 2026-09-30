const { nextRunAt, normalizeTrigger } = require('./triggers');
// Ongoing work is opt-in and bounded. Connected-app writes still need approval.
const GOAL_READ_TOOLS=['goal_list','library_list','library_read','web_search','composio_apps','composio_tools','composio_execute','present'];
async function configureGoalWork(store,userId,id,input={}) {
  const goal=await store.getGoal(userId,id);if(!goal)throw new Error('Goal not found.');
  if(input.enabled===false){
    if(goal.work?.agentId){const a=await store.getSubAgent(userId,goal.work.agentId);if(a)await store.updateSubAgent(userId,a.id,{...a,enabled:false},null);}
    return store.updateGoal(userId,id,{work:{...goal.work,enabled:false}});
  }
  const successCriteria=String(input.successCriteria || '').trim(),nextAction=String(input.nextAction || '').trim();
  if(!successCriteria || successCriteria.length>1000 || !nextAction || nextAction.length>1000)throw new Error('Describe success and the next action (up to 1,000 characters each).');
  const maxRuns=Number(input.maxRuns ?? 5),maxRounds=Number(input.maxRounds ?? 4);
  if(!Number.isInteger(maxRuns) || maxRuns<1 || maxRuns>30 || !Number.isInteger(maxRounds) || maxRounds<1 || maxRounds>8)throw new Error('Budget must be 1–30 runs, each 1–8 planning rounds.');
  const trigger={...normalizeTrigger({type:'schedule',intervalMinutes:input.intervalMinutes ?? 1440,startAt:input.startAt}),goalId:id};
  const allowedTools=Array.isArray(input.allowedTools)?[...new Set(input.allowedTools)].filter(t=>GOAL_READ_TOOLS.includes(t)):['goal_list','library_list','library_read','web_search','present'];
  if(!allowedTools.length)throw new Error('Choose at least one permitted capability.');
  const prompt=`Work towards this owner goal: ${goal.title}. Success means: ${successCriteria}. Next action: ${nextAction}. Make concrete progress within the permitted actions. Do not create schedules or change the goal on your own. Report evidence, remaining work and the next action. State an update only for meaningful progress, a changed finding, a blocker or a required owner decision. If nothing changed, return exactly NO_CHANGE.`;
  const old=goal.work?.agentId?await store.getSubAgent(userId,goal.work.agentId):null;
  const agent=old?await store.updateSubAgent(userId,old.id,{name:goal.title.slice(0,60),prompt,trigger,enabled:true},nextRunAt(trigger)):await store.createSubAgent(userId,{name:goal.title.slice(0,60),prompt,trigger,enabled:true},nextRunAt(trigger));
  return store.updateGoal(userId,id,{work:{configurationId:crypto.randomUUID(),enabled:true,agentId:agent.id,chatId:agent.chatId,successCriteria,nextAction,allowedTools,maxRuns,maxRounds,intervalMinutes:trigger.intervalMinutes,nextWakeAt:nextRunAt(trigger)}});
}
module.exports={configureGoalWork,GOAL_READ_TOOLS};
