const completed=require('./completion-fixture.cjs');
const assert=require('node:assert/strict');
const {approvalCard,resultCard,presentArgs,questionArgs,cardFromMarkdown}=require('../server/agents/cards');
const {createTaskRuntime}=require('../server/agents/task-runtime');
const {createCoordinator}=require('../server/agents/conversation');
const {TOOLS}=require('../server/agents/tools');
const {TOOL_SCHEMAS}=require('../server/agents/vm-harness');
const clone=x=>x==null?x:structuredClone(x);

(async()=>{
  // Approvals show the exact action: who gets the email, what it says, what the order costs.
  const mail=approvalCard('mail_send',{to:'ana@example.com, bo@example.com',subject:'Dinner',body:'See you at 7'},'{}');
  assert.equal(mail.type,'approval');
  assert.equal(mail.view.kind,'email');
  assert.deepEqual(mail.view.to,['ana@example.com','bo@example.com']);
  assert.equal(mail.view.subject,'Dinner');
  const gmail=approvalCard('composio_execute',{tool:'GMAIL_SEND_EMAIL',args:{recipient_email:'ana@example.com',subject:'Hi',body:'Hello'}},'');
  assert.equal(gmail.view.kind,'email');assert.equal(gmail.view.provider,'gmail');assert.match(gmail.title,/Gmail/);
  const calendar=approvalCard('composio_execute',{tool:'GOOGLECALENDAR_CREATE_EVENT',args:{summary:'Standup',start_datetime:'2026-09-25T09:00'}},'');
  assert.equal(calendar.view.kind,'event');assert.equal(calendar.view.title,'Standup');
  const generic=approvalCard('composio_execute',{tool:'NOTION_CREATE_PAGE',args:{title:'Plan'}},'');
  assert.equal(generic.view.kind,'app_action');assert.equal(generic.view.appName,'Notion');
  const quote=JSON.stringify({merchant:'allsports.example',checkoutId:'c1',amount:59.99,currency:'USD',items:[{title:'Girls Champ Matte Helmet',quantity:1,price:59.99}],buyerEmail:'me@example.com',delivery:[]});
  const order=approvalCard('shop_purchase',{merchant:'allsports.example',checkoutId:'c1'},quote);
  assert.equal(order.view.kind,'purchase');assert.equal(order.view.total,'$59.99');assert.equal(order.view.items[0].title,'Girls Champ Matte Helmet');
  assert.equal(order.detail,quote,'the approved quote detail is preserved for the purchase check');
  const bank=approvalCard('wallet_withdraw',{},JSON.stringify({amount:5,currency:'USD',recipient:'Bank ····1234 · EUR'}));
  assert.match(bank.title,/withdrawal.*Bank.*1234/);
  assert.match(bank.title,/5/);
  assert.equal(bank.view.action,'bank_withdraw');
  const earn=approvalCard('wallet_earn',{},JSON.stringify({kind:'earn_deposit',amount:5,currency:'USD',recipient:'Aave USDC Vault',risk:'Yield varies.'}));
  assert.equal(earn.view.to,'Earn');
  assert.doesNotMatch(JSON.stringify({title:earn.title,view:earn.view}),/USDC|Aave/);
  const secret=approvalCard('vault_request',{name:'GitHub password'},'',TOOLS.vault_request);
  assert.equal(secret.type,'secret','credential requests keep the secure vault card');

  // Questions and picks: options may carry descriptions and only https images.
  const question=approvalCard('ask_user',{question:'Which avatar?',options:[{label:'3D',image:'https://cdn.example/a.png'},{label:'Pixel',image:'javascript:alert(1)'},'Photo'],multiple:true});
  assert.equal(question.type,'question');assert.equal(question.status,'pending');assert.equal(question.multi,true);
  assert.equal(question.options[0].image,'https://cdn.example/a.png');
  assert.equal(question.options[1].image,undefined,'unsafe image URLs are dropped');
  assert.equal(question.options[2].label,'Photo');
  assert.equal(questionArgs({question:'Name?'}).allowOther,true,'a question without options accepts typed answers');

  // Lists, dashboards and tables are normalised and bounded.
  const dash=presentArgs({kind:'dashboard',title:'Sales',metrics:[{label:'Revenue',value:'$12k',delta:'+8%',trend:'up'}],chart:{type:'line',labels:['Mon','Tue'],series:[{name:'Orders',values:[3,'x']}]}});
  assert.equal(dash.metrics[0].trend,'up');assert.deepEqual(dash.chart.series[0].values,[3,0]);
  const list=presentArgs({kind:'list',title:'Picks',items:[{title:'A',url:'http://insecure.example',image:'https://img.example/a.jpg'}]});
  assert.equal(list.items[0].url,undefined,'links must be https');assert.equal(list.items[0].image,'https://img.example/a.jpg');
  assert.equal(presentArgs({kind:'weird',title:'x'}).kind,'list');

  // Tool results become visual cards instead of raw JSON.
  const products=resultCard('shop_search',{products:[{title:'JR Softball Helmet',price:{amount:59.99,currency:'USD'},image:'https://cdn.example/h.png',url:'https://shop.example/h',seller:{name:'Softball Store'}}]},{query:'softball helmet'});
  assert.equal(products.type,'present');assert.equal(products.kind,'products');
  assert.deepEqual(products.items[0],{title:'JR Softball Helmet',subtitle:'Softball Store',price:'$59.99',image:'https://cdn.example/h.png',url:'https://shop.example/h'});
  const sent=resultCard('mail_send',{id:'m1',to:['ana@example.com'],subject:'Dinner',from:'agent@mail.belna.se'},{body:'See you at 7'});
  assert.equal(sent.type,'email');assert.equal(sent.state,'sent');assert.equal(sent.body,'See you at 7');
  assert.equal(resultCard('connect_app',{toolkit:'gmail',connected:false}),null,'an unconnected app adds no second card');
  assert.equal(resultCard('connect_app',{toolkit:'gmail',connected:true}),null,'a connected app is used without a card');
  for(const name of ['ask_user','present','connect_app']) assert.ok(TOOL_SCHEMAS.some(s=>s.name===name),`${name} has a model schema`);

  // Markdown tables and task lists written instead of present become cards; plain lists stay text.
  const table=cardFromMarkdown('Intro.\n\n| Phone | Price |\n|---|---|\n| Pixel 9 | $799 |\n| iPhone 16 | $799 |\n\nOutro.');
  assert.equal(table.card.kind,'table');assert.deepEqual(table.card.rows,[['Pixel 9','$799'],['iPhone 16','$799']]);assert.equal(table.rest,'Intro.\n\nOutro.');
  const steps=cardFromMarkdown('## Move\n- [ ] Book movers\n- [x] Pack\n- [ ] Change address: online');
  assert.equal(steps.card.kind,'steps');assert.equal(steps.card.title,'Move');assert.equal(steps.card.items[1].done,true);assert.equal(steps.card.items[2].subtitle,'online');
  assert.equal(cardFromMarkdown('- one\n- two\n- three'),null);
  assert.equal(cardFromMarkdown('**Before**\n- [ ] Book movers\n**Moving day**\n- [ ] Load truck\n- [ ] Keys').rest,'','section labels are not left behind');

  // Chat turn: ask_user shows a question card and ends the turn without a second model call.
  const coordinator=(replies,extra={})=>{
    const models=[];const saved=[];
    const c=createCoordinator({tasks:{summaries:async()=>[]},model:async opts=>{models.push(opts);return replies.shift() || {text:'ok'};},
      schemas:TOOL_SCHEMAS,tools:{...TOOLS,...extra},azure:{getSandbox:async()=>({mode:'local'})},
      store:{listMemories:async()=>[],saveTurn:async(u,chat,role,text)=>saved.push({role,text})},buildSystem:async()=>'',ensureCredit:async()=>{},logUsage:async()=>{},
      checkPrompt:()=>{},protect:(_,s)=>s,rank:x=>x,finishMemory:async()=>{throw new Error('memory extraction should not run for a question');}});
    return {c,models,saved};
  };
  const asked=coordinator([{functionCalls:[{name:'ask_user',args:{question:'Which color?',options:['Blue','Pink']}}]}]);
  const askEvents=[];
  await asked.c.run({userId:'a',chatId:'chat',requestId:'r1',prompt:'Buy me a helmet',onEvent:e=>askEvents.push(e)});
  assert.equal(asked.models.length,1);
  assert.ok(asked.models[0].tools.some(t=>t.name==='ask_user') && asked.models[0].tools.some(t=>t.name==='present'),'chat can ask and present');
  const askCard=askEvents.find(e=>e.type==='card').card;
  assert.equal(askCard.type,'question');assert.equal(askCard.ask,true);assert.deepEqual(askCard.options.map(o=>o.label),['Blue','Pink']);
  assert.ok(!askEvents.some(e=>e.type==='message'),'the card is the whole reply');
  assert.deepEqual(asked.saved.at(-1),{role:'agent',text:'Which color?'},'history keeps the question');

  const presentModels=[],presentEvents=[];
  await createCoordinator({tasks:{summaries:async()=>[]},model:async opts=>{presentModels.push(opts);return presentModels.length===1?{functionCalls:[{name:'present',args:{kind:'list',title:'Helmets',items:[{title:'Pro'}]}}]}:{text:'Here are three picks.'};},
    schemas:TOOL_SCHEMAS,tools:TOOLS,azure:{getSandbox:async()=>({mode:'local'})},store:{listMemories:async()=>[],saveTurn:async()=>{}},buildSystem:async()=>'',ensureCredit:async()=>{},logUsage:async()=>{},
    checkPrompt:()=>{},protect:(_,s)=>s,rank:x=>x,finishMemory:async()=>[]}).run({userId:'a',chatId:'chat',requestId:'r2',prompt:'Show helmets',onEvent:e=>presentEvents.push(e)});
  assert.equal(presentModels.length,2,'present shows the card, then the model adds a short answer');
  assert.equal(presentEvents.find(e=>e.type==='card').card.type,'present');
  assert.equal(presentEvents.find(e=>e.type==='message').text,'Here are three picks.');

  const mdEvents=[];
  await coordinator([{text:'Sure.\n\n- [ ] Book movers\n- [ ] Pack\n- [ ] Change address'}]).c.run({userId:'a',chatId:'chat',requestId:'r-md',prompt:'Moving checklist',onEvent:e=>mdEvents.push(e)}).catch(()=>{});
  assert.equal(mdEvents.find(e=>e.type==='card')?.card.kind,'steps','a markdown checklist reply arrives as a card');
  assert.equal(mdEvents.find(e=>e.type==='message').text,'Sure.');

  // One request never starts the same background job twice; clearly separate jobs may run side by side.
  const delegations=async calls=>{
    const created=[];
    await createCoordinator({tasks:{summaries:async()=>[],create:async x=>{created.push(x.title);return {id:'t'+created.length,state:{title:x.title}};},view:r=>({id:r.id,title:r.state.title,status:'queued'})},
      model:async()=>({functionCalls:calls}),schemas:TOOL_SCHEMAS,tools:TOOLS,azure:{getSandbox:async()=>({mode:'local'})},store:{listMemories:async()=>[],saveTurn:async()=>{}},
      buildSystem:async()=>'',ensureCredit:async()=>{},logUsage:async()=>{},checkPrompt:()=>{},protect:(_,s)=>s,rank:x=>x,finishMemory:async()=>[]})
      .run({userId:'a',chatId:'chat',requestId:'dup'+Math.random(),prompt:'Book dinner',onEvent:()=>{}});
    return created;
  };
  assert.deepEqual(await delegations([
    {name:'delegate_task',args:{title:'Book dinner on Friday',instructions:'Find and book a dinner table for Friday evening for the owner.'}},
    {name:'delegate_task',args:{title:'Dinner reservation',instructions:'Book a dinner table for Friday evening for the owner.'}}]),['Book dinner on Friday'],'a repeated delegation is skipped');
  assert.equal((await delegations([
    {name:'delegate_task',args:{title:'Book flights to Rome',instructions:'Compare and book return flights Stockholm to Rome in May.'}},
    {name:'delegate_task',args:{title:'Find a hotel in Rome',instructions:'Shortlist central hotels under 150 EUR per night near Trastevere.'}}])).length,2,'independent jobs still run in parallel');

  const connect=coordinator([{functionCalls:[{name:'connect_app',args:{toolkit:'gmail',reason:'To read your inbox'}}]}],{connect_app:{run:async()=>({toolkit:'gmail',connected:false})}});
  const connectEvents=[];
  await connect.c.run({userId:'a',chatId:'chat',requestId:'r3',prompt:'Check my Gmail',onEvent:e=>connectEvents.push(e)});
  const connectCard=connectEvents.find(e=>e.type==='card').card;
  assert.equal(connectCard.type,'connect');assert.equal(connectCard.toolkit,'gmail');assert.equal(connectCard.chat,true);assert.equal(connectCard.status,'pending');
  assert.equal(connect.models.length,1,'a connect request waits for the owner');

  // Task: ask_user pauses the worker with a question card; the chosen option reaches the tool.
  const rows=new Map();
  const records={
    get:async(u,id)=>{const r=rows.get(id);return r?.user_id===u?clone(r):null;},
    list:async(u,c)=>[...rows.values()].filter(r=>r.user_id===u && r.chat_id===c).map(clone),
    team:async(u,id)=>{const a=rows.get(id);return a?[clone(a)]:[];},
    create:async row=>{row.revision=1;rows.set(row.id,clone(row));return clone(row);},
    claim:async(u,id,token)=>{const r=rows.get(id);if(!r || r.lease || !['queued','running','stopping'].includes(r.state.status))return null;r.lease=token;r.revision++;return clone(r);},
    write:async(row,state,token)=>{const r=rows.get(row.id);if(r.revision!==row.revision || (token && token!==r.lease))return null;r.state=clone(state);r.revision++;return clone(r);},
    release:async(u,id,token)=>{const r=rows.get(id);if(r.lease===token)r.lease=null;},
  };
  const edgeRuntime=(await import('../src/lingon-server/agents/task-runtime.js')).createTaskRuntime;
  for(const factory of [createTaskRuntime,edgeRuntime]) {
  const answers=[{functionCalls:[{name:'ask_user',args:{question:'Which helmet?',context:'Under 80 EUR.',options:[{label:'Blue',description:'Road helmet.'},{label:'Pink',description:'City helmet.'}]}}]},{text:'Ordering the Pink helmet.'}];
  let seen;const workerModels=[];
  const runtime=factory({records,schemas:TOOL_SCHEMAS,tools:{ask_user:{...TOOLS.ask_user,run:async(args,ctx)=>{seen=ctx.answer;return TOOLS.ask_user.run(args,{...ctx,trace:()=>{}});}}},
    azure:{getSandbox:async()=>({mode:'local'})},memory:{list:async()=>[],rank:x=>x,finish:async()=>[]},buildSystem:async()=>'',checkPrompt:()=>{},ensureCredit:async()=>{},
    protect:(_,s)=>s,logUsage:async()=>{},emitResultCard:()=>{},model:async opts=>{workerModels.push(opts);return completed(answers.shift() || {text:'done'});}});
  const task=await runtime.create({userId:'a',chatId:'chat',requestKey:'k',instructions:'Pick a helmet',history:[]});
  for(let i=0;i<4 && rows.get(task.id).state.status!=='waiting_approval';i++) await runtime.step('a',task.id);
  const waiting=rows.get(task.id).state;
  assert.equal(waiting.status,'waiting_approval');
  const cardEvent=waiting.events.find(e=>e.type==='card' && e.card.type==='question');
  assert.ok(cardEvent && cardEvent.callId,'the question card carries the call to answer');
  await assert.rejects(runtime.control('a',task.id,{action:'decide',callId:cardEvent.callId,allow:true,answer:' ',version:waiting.version,requestId:'empty'},'chat'),/answer the question or skip/);
  await runtime.control('a',task.id,{action:'decide',callId:cardEvent.callId,allow:true,answer:'Pink',version:waiting.version,requestId:'answer'},'chat');
  await runtime.control('a',task.id,{action:'decide',callId:cardEvent.callId,allow:true,answer:'Pink',version:waiting.version,requestId:'answer'},'chat');
  assert.equal(rows.get(task.id).state.ownerAnswers.length,1,'replayed decisions do not duplicate owner answers');
  assert.equal((await runtime.summaries('a','chat')).find(t=>t.id===task.id).answers.at(-1).answer,'Pink','main chat can recall task answers');
  assert.equal((await runtime.details('a',task.id,'chat')).ownerAnswers[0].options[1].description,'City helmet.','full question meanings remain readable by the coordinator');
  for(let i=0;i<4 && !['completed','failed'].includes(rows.get(task.id).state.status);i++) await runtime.step('a',task.id);
  const done=rows.get(task.id).state;
  assert.equal(seen,'Pink');
  assert.equal(done.status,'completed');
  assert.ok(done.events.some(e=>e.type==='decision' && e.answer==='Pink'),'the decision event reports the answer');
  assert.match(done.observations.find(o=>o.name==='ask_user').text,/Pink/);
  assert.match(workerModels.at(-1).prompt,/Owner answers to task questions[\s\S]*Which helmet[\s\S]*Pink/,'owner input is preserved separately from untrusted tool observations');
  // Older tool observations leave the active window during a long task. The
  // owner's answers must still be supplied, including after a task revision.
  const long=rows.get(task.id).state;
  long.status='queued';long.version++;long.round=1;long.result=null;
  long.observations.push(...Array.from({length:24},(_,i)=>({id:'later'+i,name:'web_search',ok:true,text:'Long later research. '.repeat(400),version:long.version,key:'web_search:{}'})));
  await runtime.step('a',task.id);
  assert.match(workerModels.at(-1).prompt,/Owner answers to task questions[\s\S]*Which helmet[\s\S]*Pink/,'answers survive long task context trimming and revisions');
  assert.match(workerModels.at(-1).prompt,/Under 80 EUR[\s\S]*City helmet/,'the meaning of the chosen option survives too');
  answers.push({functionCalls:[{name:'ask_user',args:{question:'Which date?',options:['June','July']}}]},{text:'Continuing with defaults.'});
  const skipped=await runtime.create({userId:'a',chatId:'chat',requestKey:'skip',instructions:'Plan a trip',history:[]});
  for(let i=0;i<4 && rows.get(skipped.id).state.status!=='waiting_approval';i++) await runtime.step('a',skipped.id);
  const skipApproval=rows.get(skipped.id).state.approval;
  await runtime.control('a',skipped.id,{action:'decide',callId:skipApproval.id,allow:false,version:1,requestId:'skip'},'chat');
  await runtime.step('a',skipped.id);
  assert.match(workerModels.at(-1).prompt,/Owner answers to task questions[\s\S]*Which date[\s\S]*"skipped":true/,'skipping is recorded without approving an action');
  }
  // A worker that repeats the same lookup does not stack identical cards.
  const {emitResultCard}=require('../server/agents/vm-harness');
  const repeatRows=new Map();
  const repeatRecords={...records,get:async(u,id)=>clone(repeatRows.get(id)),team:async(u,id)=>[clone(repeatRows.get(id))],
    create:async row=>{row.revision=1;repeatRows.set(row.id,clone(row));return clone(row);},
    claim:async(u,id,token)=>{const r=repeatRows.get(id);if(!r || r.lease || !['queued','running'].includes(r.state.status))return null;r.lease=token;r.revision++;return clone(r);},
    write:async(row,state,token)=>{const r=repeatRows.get(row.id);if(r.revision!==row.revision || (token && token!==r.lease))return null;r.state=clone(state);r.revision++;return clone(r);},
    release:async(u,id,token)=>{const r=repeatRows.get(id);if(r.lease===token)r.lease=null;}};
  const lookup={kind:'list',title:'Helmets',items:[{title:'Pro'}]};
  const repeatAnswers=[{functionCalls:[{name:'present',args:lookup}]},{functionCalls:[{name:'present',args:lookup}]},{text:'Done.'}];
  const repeat=createTaskRuntime({records:repeatRecords,schemas:TOOL_SCHEMAS,tools:TOOLS,azure:{getSandbox:async()=>({mode:'local'})},memory:{list:async()=>[],rank:x=>x,finish:async()=>[]},
    buildSystem:async()=>'',checkPrompt:()=>{},ensureCredit:async()=>{},protect:(_,s)=>s,logUsage:async()=>{},emitResultCard,model:async()=>repeatAnswers.shift() || {text:'Done.'}});
  const repeatTask=await repeat.create({userId:'a',chatId:'chat',requestKey:'repeat',instructions:'List helmets',history:[]});
  for(let i=0;i<8 && rows.get && repeatRows.get(repeatTask.id).state.status!=='completed';i++) await repeat.step('a',repeatTask.id);
  assert.equal(repeatRows.get(repeatTask.id).state.events.filter(e=>e.type==='card' && e.card.type==='present').length,1,'identical cards are shown once');
  // "No automations yet" is an answer, not a failure; otherwise the worker retries and duplicates work.
  repeatAnswers.push({functionCalls:[{name:'trigger_list',args:{}}]},{text:'None yet.'});
  const empty=createTaskRuntime({records:repeatRecords,schemas:TOOL_SCHEMAS,tools:{trigger_list:{run:async()=>[]}},azure:{getSandbox:async()=>({mode:'local'})},memory:{list:async()=>[],rank:x=>x,finish:async()=>[]},
    buildSystem:async()=>'',checkPrompt:()=>{},ensureCredit:async()=>{},protect:(_,s)=>s,logUsage:async()=>{},emitResultCard,model:async()=>repeatAnswers.shift() || {text:'Done.'}});
  const emptyTask=await empty.create({userId:'a',chatId:'chat',requestKey:'empty',instructions:'List automations',history:[]});
  for(let i=0;i<6 && repeatRows.get(emptyTask.id).state.status!=='completed';i++) await empty.step('a',emptyTask.id);
  assert.equal(repeatRows.get(emptyTask.id).state.observations.find(o=>o.name==='trigger_list').ok,true,'an empty list is a successful result');
  console.log('visual cards: approvals, questions, lists, dashboards, connect and task answers: ok');
})().catch(e=>{console.error(e);process.exit(1);});
