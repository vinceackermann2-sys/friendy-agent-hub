const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app/app.js'),'utf8');
const start=source.indexOf('const managedRunTokens = new WeakMap();');
const end=source.indexOf('\nfunction replaceNode(c, m){',start);
let nextId=0;
const narrated=[];
const context=vm.createContext({WeakMap,Promise,state:{agent:{name:'Agent'},vault:{},memory:[]},uid:()=>`id-${++nextId}`,isActive:()=>false,
  noteActivity:(c,t)=>narrated.push(t),findReaction:emoji=>['up','down','heart','poop'].includes(emoji)?{id:emoji}:null,
  $:()=>null,msgNode:()=>null,replaceNode:()=>{},repaintCanvasSoon:()=>{},save:()=>{},refreshBillingUsage:()=>{},setTimeout:()=>{throw Error('Cards must not use timers');}});
vm.runInContext(source.slice(start,end),context);
const chat={id:'chat',messages:[{id:'old',kind:'card',card:{type:'progress',status:'done',label:'Earlier published update'}},{id:'user-42',role:'user',kind:'text',text:'I finished my project!'}]};
const first=context.makeRT(chat);
first.managedEvent({type:'session',status:'running'});
first.managedEvent({type:'message_reaction',messageId:'user-42',emoji:'heart'});
assert.equal(chat.messages.find(m=>m.id==='user-42').agentReaction,'heart','agent reaction is attached to the user message');
first.managedEvent({type:'message_reaction',messageId:'old',emoji:'heart'});
assert.equal(chat.messages.find(m=>m.id==='old').agentReaction,undefined,'agent cannot react to non-user cards');
for(const stage of ['checking','model','tool','vm','approval'])first.managedEvent({type:'progress',stage,label:stage});
first.managedEvent({type:'heartbeat'});
assert.equal(chat.messages.length,2,'internal stages and heartbeat add no cards');
assert.deepEqual(narrated,['checking','model','tool','vm','approval'],'internal stages narrate the header status instead');
const task={id:'task',chatId:'chat',title:'Research',status:'running',version:1,revision:5,sequence:1,events:[{id:'milestone',seq:1,type:'card',card:{type:'progress',status:'done',label:'Found three suitable options'}}]};
first.managedTask(task);
first.managedTask(task);
assert.equal(chat.messages.filter(m=>m.card?.type==='progress').length,2,'milestones replay once and all prior cards stay');
const second=context.makeRT(chat);second.managedEvent({type:'session',status:'running'});
first.managedTask({...task,status:'completed',revision:8,sequence:2,events:[...task.events,{id:'task-result',seq:2,type:'message',phase:'task_answer',text:'Verified task result'}]});
assert.equal(chat.managedStatus,'running','worker final cannot close the active conversation reply');
assert.equal(chat.messages.find(m=>m.managedId==='task-result').text,'Verified task result');
first.managedTask(task);
assert.equal(chat.managedTasks.task.status,'completed','a late advance cannot undo completion');
assert.equal(chat.managedTasks.task.sequence,2);
second.managedEvent({type:'message',id:'answer',phase:'final_answer',text:'Quick answer'});
const third=context.makeRT(chat);third.managedEvent({type:'session',status:'running'});
second.managedEvent({type:'done',status:'completed'});
assert.equal(chat.managedStatus,'running','old main cannot close new main');
second.managedEvent({type:'card',id:'memory',card:{type:'memory',text:'Preference',status:'done'}});
assert.equal(chat.managedStatus,'running');assert.equal(chat.messages.filter(m=>m.card?.type==='progress').length,2);
first.managedTask({...task,status:'completed',revision:9,sequence:4,events:[
  {id:'browser-call',seq:3,type:'card',card:{type:'browser',status:'running',url:'https://en.wikipedia.org/'}},
  {id:'browser-call',seq:4,type:'card',card:{type:'browser',status:'done',url:'https://en.wikipedia.org/',liveId:'live-1'}},
]});
assert.equal(chat.messages.filter(m=>m.managedId==='browser-call').length,1,'browser progress updates the existing card');
assert.equal(chat.messages.find(m=>m.managedId==='browser-call').card.liveId,'live-1');
first.managedTask({...task,status:'completed',revision:10,sequence:6,events:[
  {id:'computer-call',seq:5,type:'card',card:{type:'computer',status:'running',lines:[]}},
  {id:'computer-call',seq:6,type:'card',card:{type:'computer',status:'done',lines:[{t:'ready'}]}},
]});
assert.equal(chat.messages.filter(m=>m.managedId==='computer-call').length,1,'computer progress updates the existing card');
third.managedEvent({type:'message_delta',id:'live-answer',delta:'Hel'});
third.managedEvent({type:'message_delta',id:'live-answer',delta:'lo'});
assert.equal(chat.messages.find(m=>m.managedId==='live-answer').text,'Hello');
third.managedEvent({type:'message',id:'live-answer',phase:'final_answer',text:'Hello'});
assert.equal(chat.messages.find(m=>m.managedId==='live-answer').text,'Hello');
third.managedEvent({type:'message_delta',id:'draft-answer',delta:'Nope'});
third.managedEvent({type:'message_retract',id:'draft-answer'});
assert.equal(chat.messages.some(m=>m.managedId==='draft-answer'),false,'tool-bound drafts are retracted');
// An update from a working task reads as the agent's own message and keeps the task running.
const updating={id:'task-2',chatId:'chat',title:'Flights',status:'running',version:1,revision:1,sequence:1,
  events:[{id:'task-2:update:1',seq:1,type:'message',phase:'task_update',text:'Found three flights; checking baggage rules now.'}]};
first.managedTask(updating);
const update=chat.messages.find(m=>m.managedId==='task-2:update:1');
assert.deepEqual([update.role,update.kind,update.text],['agent','text','Found three flights; checking baggage rules now.']);
assert.equal(chat.managedTasks['task-2'].status,'running');
first.managedTask({...updating,status:'completed',revision:2,sequence:2,events:[...updating.events,{id:'task-2:answer:v1',seq:2,type:'message',phase:'task_answer',text:'Two direct flights fit.'}]});
assert.equal(chat.messages.filter(m=>m.managedId==='task-2:update:1').length,1,'an update is shown once');
assert.equal(chat.messages.find(m=>m.managedId==='task-2:answer:v1').text,'Two direct flights fit.');
// The task card is made when the task starts. Paused, its Continue card sits under the task's
// answer, not above its updates (2026-09-29), and a later owner message stays below it.
const paused={id:'task-3',chatId:'chat',title:'Page messages',status:'running',version:1,revision:1,sequence:0,events:[]};
first.managedTask(paused);
first.managedTask({...paused,revision:2,events:[{id:'task-3:update:1',seq:1,type:'message',phase:'task_update',text:'Checked two Pages.'}]});
const order=()=>chat.messages.map(m=>m.managedId || m.id).filter(id=>/task-3|task_task-3|later/.test(id));
assert.deepEqual(order(),['task_task-3','task-3:update:1'],'a working task card stays where the task started');
first.managedTask({...paused,status:'partial',revision:3,events:[{id:'task-3:update:1',seq:1,type:'message',phase:'task_update',text:'Checked two Pages.'},{id:'task-3:answer:v1',seq:2,type:'message',phase:'task_answer',text:'One conversation found.'}]});
assert.deepEqual(order(),['task-3:update:1','task-3:answer:v1','task_task-3'],'a paused card moves under the answer');
chat.messages.push({id:'later',role:'user',kind:'text',text:'thanks'});
first.managedTask({...paused,status:'partial',revision:4,summary:'x',events:[]});
assert.deepEqual(order(),['task-3:update:1','task-3:answer:v1','task_task-3','later'],'a later owner message stays below');
// Chats saved before the fix are repaired when painted.
const saved={messages:[{id:'c',managedId:'task_t4',kind:'card',card:{type:'task',taskId:'t4',status:'partial'}},{id:'a',managedId:'t4:answer:v1',role:'agent',kind:'text'}]};
context.placeTaskCard(saved,saved.messages[0]);
assert.deepEqual(saved.messages.map(m=>m.id),['a','c']);
console.log('managed cards: milestone-only updates, persistent history, replay dedupe, independent task/main status: ok');
