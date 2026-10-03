const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
let resolveAction;const action=new Promise(resolve=>resolveAction=resolve);
let advances=0, owner='a', billingRefreshes=0;const requests=[];
let task={id:'task',chatId:'chat',title:'Task',version:1,revision:1,status:'running',sequence:0,events:[]};
const window={Engine:{},LingonAuth:{get:()=>({user:{id:owner}}),
  api:async(path,options)=>{
    const body=options?.body?JSON.parse(options.body):null;requests.push({path,body});
    if(path.startsWith('/api/agent/tasks?'))return {tasks:[task]};
    if(path.endsWith('/advance')){advances++;return action;}
    if(path.endsWith('/control')) {
      if(body.action==='steer_team')return {tasks:[{...task,revision:11,version:3,status:'completed'},{...task,id:'peer',revision:11,version:3,status:'completed'}]};
      task={...task,revision:10,version:2,status:'stopped'};return {task};
    }
    return {};
  },
  apiStream:async(path,options)=>{
    requests.push({path,body:JSON.parse(options.body)});
    return new Response('data: '+JSON.stringify({type:'message',id:'quick',phase:'final_answer',text:'Quick answer'})+'\n\ndata: {"type":"done","status":"completed"}\n\n');
  }}};
const timers=new Set();
const later=(fn,ms)=>{const t=setTimeout(()=>{timers.delete(t);fn();},ms);t.unref();timers.add(t);return t;};
const context=vm.createContext({window,WeakMap,Promise,AbortController,TextDecoder,Uint8Array,crypto:webcrypto,setTimeout:later,clearTimeout,
  state:{agent:{name:'Agent'},vault:{},memory:[]},uid:()=>webcrypto.randomUUID(),isActive:()=>false,$:()=>null,msgNode:()=>null,replaceNode:()=>{},repaintCanvasSoon:()=>{},save:()=>{},
  refreshBillingUsage:()=>billingRefreshes++});
const src=fs.readFileSync(require.resolve('../app/app.js'),'utf8');
vm.runInContext(src.slice(src.indexOf('const managedRunTokens'),src.indexOf('\nfunction replaceNode(c, m){',src.indexOf('const managedRunTokens'))),context);
vm.runInContext(fs.readFileSync(require.resolve('../app/engine.managed.js'),'utf8'),context);
const chat={id:'chat',messages:[{role:'user',kind:'text',text:'Question'}]};const rt=context.makeRT(chat);
(async()=>{
  await window.Engine.recoverTasks(rt);await Promise.resolve();assert.equal(advances,1);
  await window.Engine.run(rt,'Question while working');
  assert.equal(chat.messages.find(m=>m.managedId==='quick').text,'Quick answer');
  assert.equal(window.Engine.isRunning('chat'),false);
  assert.equal(advances,1,'foreground question does not restart worker');
  assert.equal(requests.some(r=>r.path.includes('/cancel')),false);
  await window.Engine.controlTask(rt,'task','cancel');
  resolveAction({task:{...task,revision:3,version:1,status:'running'}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(chat.managedTasks.task.status,'stopped','late worker response cannot undo stop');
  assert.equal(requests.find(r=>r.path.endsWith('/control')).body.version,1);
  await window.Engine.controlTask(rt,'task','steer_team',{instruction:'Use Swedish'});
  assert.equal(chat.managedTasks.task.version,3);assert.equal(chat.managedTasks.peer.version,3,'shared steering reconciles every returned worker');
  assert.ok(billingRefreshes>0,'background task changes refresh account usage while another view is open');
  owner='b';
  for(const t of timers)clearTimeout(t);
  console.log('managed task transport: foreground reply during held worker, scoped stop, stale response handling: ok');
})().catch(e=>{for(const t of timers)clearTimeout(t);console.error(e);process.exitCode=1;});
