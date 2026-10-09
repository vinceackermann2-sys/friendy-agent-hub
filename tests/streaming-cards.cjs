// Cards drawn while the model writes them, the reply written into the card call (one model
// call instead of two), lookups that run at once, and the timeline, compare and calculator cards.
const assert=require('node:assert/strict');
const {partialJson,presentArgs,presentSummary,calcCompile,calcResults}=require('../server/agents/cards');
const {createCoordinator,shownStart}=require('../server/agents/conversation');

const schemaFor=name=>({name,description:name,parameters:{type:'object',properties:{}}});
function chat(model,extra={}) {
  const d={tasks:{summaries:async()=>[]},model,schemas:['present','learn','web_search','wallet_status','shop_status'].map(schemaFor),tools:{},
    azure:{getSandbox:async()=>({mode:'azure'})},store:{listMemories:async()=>[],saveTurn:async()=>{}},
    buildSystem:async()=>'SYSTEM',ensureCredit:async()=>{},logUsage:async()=>{},checkPrompt:()=>{},
    protect:(_,s)=>s,rank:x=>x,finishMemory:async()=>[],...extra};
  return createCoordinator(d);
}
// The model writes a function call's arguments a few characters at a time, as the provider streams them.
function writes(name,args,index=0,size=7) {
  const raw=JSON.stringify(args);
  return opts=>{for(let i=size;i<raw.length+size;i+=size) opts.onCallDelta?.({index,name,arguments:raw.slice(0,i)});return {text:'',functionCalls:[{name,args}]};};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  // partialJson reads what has been written so far.
  assert.deepEqual(partialJson('{"kind":"list","title":"Lis'),{kind:'list',title:'Lis'});
  assert.deepEqual(partialJson('{"kind":"list","ti'),{kind:'list'},'a key still being written is left out');
  assert.deepEqual(partialJson('{"items":[{"title":"A"},{"title":"B'),{items:[{title:'A'},{title:'B'}]});
  assert.deepEqual(partialJson('{"a":1,"b":'),{a:1},'a key waiting for its value is left out');
  assert.deepEqual(partialJson('{"a":12'),{},'a number at the very end may be unfinished');
  assert.deepEqual(partialJson('{"a":"x\\u00e'),{a:'x'},'a half-written escape is dropped');
  assert.deepEqual(partialJson('{"a":"say \\"hi'),{a:'say "hi'});
  assert.equal(partialJson(''),null);
  assert.deepEqual(partialJson('{"a":[1,2,true],"b":null}'),{a:[1,2,true],b:null});

  // Calculator: formulas of the inputs, worked out without eval; bad ones are dropped.
  assert.equal(calcCompile('bill * (1 + tip / 100) / people',['bill','tip','people'])({bill:1200,tip:10,people:4}),330);
  assert.equal(calcCompile('max(a, b) + min(a, b, 1)',['a','b'])({a:3,b:5}),6);
  assert.equal(calcCompile('2^3^2',[])({}),512);
  assert.equal(calcCompile('process.exit()',['process']),null,'no property access');
  assert.equal(calcCompile('constructor',[]),null,'unknown names are refused');
  assert.equal(calcCompile('a +',['a']),null);
  const calc=presentArgs({kind:'calculator',title:'Split the bill',inputs:[{name:'bill',label:'Bill',value:1200,unit:'kr'},{name:'Tip',label:'Tip',value:10,min:0,max:30,unit:'%'},{name:'people',label:'People',value:4,min:1,max:20,step:1},{name:'bill',label:'Duplicate',value:1}],
    outputs:[{label:'Total',name:'total',formula:'bill * (1 + tip / 100)',unit:'kr',decimals:0},{label:'Each',formula:'total / people',unit:'kr'},{label:'Broken',formula:'bill +* 2'},{label:'Unknown',formula:'salary * 2'}]});
  assert.deepEqual(calc.inputs.map(i=>i.name),['bill','tip','people'],'names are normalised and duplicates dropped');
  assert.deepEqual(calc.outputs.map(o=>o.label),['Total','Each'],'outputs that do not read as formulas are dropped');
  assert.deepEqual(calcResults(calc).map(o=>o.value),[1320,330]);
  assert.deepEqual(calcResults(calc,{people:3}).map(o=>o.value),[1320,440]);
  assert.equal(presentSummary(calc).shown,true);
  const empty=presentSummary(presentArgs({kind:'calculator',title:'x',inputs:[{name:'a',value:1}],outputs:[{label:'y',formula:'b*2'}]}));
  assert.equal(empty.shown,false);assert.match(empty.note,/formula/);
  assert.equal(presentSummary(presentArgs({kind:'list',title:'Nothing'})).shown,false,'an empty card is not shown');
  // Timeline and compare keep their own fields.
  const timeline=presentArgs({kind:'timeline',title:'Saturday in Lisbon',items:[{title:'Coffee',when:'09:00',group:'Saturday'},{title:'Tram 28',when:'10:30',group:'Saturday'}]});
  assert.deepEqual(timeline.items.map(i=>[i.when,i.group]),[['09:00','Saturday'],['10:30','Saturday']]);
  const compare=presentArgs({kind:'compare',title:'E-readers',pick:'Kobo Clara BW',items:[{title:'Kindle Paperwhite',price:'1 690 kr',pros:['Bigger screen'],cons:['No physical buttons']},{title:'Kobo Clara BW',pros:['Library loans'],cons:[]}],rows:[['Screen','7"','6"']]});
  assert.equal(compare.pick,'Kobo Clara BW');assert.deepEqual(compare.items[0].pros,['Bigger screen']);assert.equal(compare.items[1].cons,undefined);

  // A present card streams in while it is written, its reply streams under it, and the reply
  // finishes the turn: one model call.
  {
    const args={kind:'list',title:'Top things to do in Lisbon',items:[{title:'Alfama'},{title:'Belém Tower'},{title:'LX Factory'}],reply:'Start in Alfama in the morning, before the crowds.'};
    let calls=0;const events=[];
    const coordinator=chat(async opts=>{calls++;if(calls>1) return {text:'A second call.'};const r=writes('present',args)(opts);await sleep(5);return r;});
    const text=await coordinator.run({userId:'u',chatId:'c',requestId:'r1',prompt:'Top 3 things to do in Lisbon?',onEvent:e=>events.push(e)});
    assert.equal(calls,1,'the card and the reply come from one model call');
    assert.equal(text,args.reply);
    const deltas=events.filter(e=>e.type==='card_delta');
    assert.ok(deltas.length>=1,'the card is drawn before the call finishes');
    assert.ok(deltas.every(e=>e.card.streaming && e.id===deltas[0].id));
    const final=events.find(e=>e.type==='card');
    assert.equal(final.id,deltas[0].id,'the finished card replaces the one being drawn');
    assert.ok(events.indexOf(deltas[0])<events.indexOf(final));
    const replyDeltas=events.filter(e=>e.type==='message_delta');
    assert.equal(replyDeltas.map(e=>e.delta).join(''),args.reply,'the reply streams in full');
    const message=events.find(e=>e.type==='message');
    assert.equal(message.id,replyDeltas[0].id,'the final message replaces the streamed reply');
    assert.equal(message.text,args.reply);
    assert.equal(events.some(e=>e.type==='message_retract'),false);
  }
  // Without a reply in the call, a second call writes it, as before.
  {
    let calls=0;const events=[];
    const coordinator=chat(async opts=>{calls++;return calls===1?writes('present',{kind:'table',title:'Planets',columns:['Planet','Moons'],rows:[['Earth','1'],['Mars','2']]})(opts):{text:'Saturn has the most.'};});
    const text=await coordinator.run({userId:'u',chatId:'c',requestId:'r2',prompt:'Table of planets and moons',onEvent:e=>events.push(e)});
    assert.equal(calls,2);assert.equal(text,'Saturn has the most.');
    assert.equal(events.filter(e=>e.type==='card').length,1);
  }
  // A card call that is not shown (nothing in it) is taken back, and the model hears why.
  {
    let calls=0;const events=[];let note='';
    const coordinator=chat(async opts=>{calls++;if(calls===1) return writes('present',{kind:'calculator',title:'Loan',inputs:[{name:'amount',value:1000}],outputs:[{label:'Monthly',formula:'amount / months'}],reply:'Here it is.'})(opts);note=opts.prompt;return {text:'Sorry, here is the plain answer.'};});
    await coordinator.run({userId:'u',chatId:'c',requestId:'r3',prompt:'Loan calculator',onEvent:e=>events.push(e)});
    const drawn=events.filter(e=>e.type==='card_delta').map(e=>e.id);
    assert.ok(drawn.length,'the calculator was drawn while written');
    assert.ok(events.some(e=>e.type==='message_retract' && e.id===drawn[0]),'the unusable card is taken back');
    assert.ok(events.some(e=>e.type==='message_retract' && /^reply_/.test(e.id)),'and its reply');
    assert.equal(events.some(e=>e.type==='card'),false);
    assert.match(note,/Nothing to show: a calculator/);
  }
  // Two lookups in one response run at once.
  {
    const started=[];let calls=0;
    const run=async args=>{started.push(Date.now());await sleep(150);return [{url:`search:${args.query}`,ok:true,text:`{"results":[{"title":"${args.query}","text":"Specs"}]}`}];};
    const coordinator=chat(async()=>{calls++;return calls===1?{functionCalls:[{name:'web_search',args:{query:'pixel 11 pro'}},{name:'web_search',args:{query:'iphone 17 pro'}}]}:{text:'The Pixel is cheaper.'};},{tools:{web_search:{run}}});
    const t0=Date.now();
    await coordinator.run({userId:'u',chatId:'c',requestId:'r4',prompt:'Pixel 11 Pro or iPhone 17 Pro price?',onEvent:()=>{}});
    assert.equal(started.length,2);
    assert.ok(Math.abs(started[1]-started[0])<60,'both searches start together');
    assert.ok(Date.now()-t0<280,`lookups overlap (${Date.now()-t0}ms)`);
  }
  // Answering while it looks things up: what the model wrote beside a search stays on screen and
  // the next round continues it; a preamble is taken back; a later card keeps the start too.
  {
    const say=(text,functionCalls=[])=>opts=>{for(let i=0;i<text.length;i+=9) opts.onDelta?.(text.slice(i,i+9));return {text,functionCalls};};
    const run=async()=>[{url:'https://example.com/a',ok:true,text:'{"results":[{"title":"Ferry","text":"From 59 kr"}]}'}];
    const search=[{name:'web_search',args:{query:'ferry stockholm vaxholm price'}}];
    const turn=async(rounds,requestId)=>{
      let n=0;const prompts=[],events=[];
      const coordinator=chat(async opts=>{prompts.push(opts.prompt+JSON.stringify(opts.history || []));return rounds[n++](opts);},{tools:{web_search:{run}}});
      const text=await coordinator.run({userId:'u',chatId:'c',requestId,prompt:'How do I get to Vaxholm and what does it cost?',onEvent:e=>events.push(e)});
      const screen=new Map();
      for(const e of events) {
        if(e.type==='message_delta') screen.set(e.id,(screen.get(e.id) || '')+e.delta);
        else if(e.type==='message') screen.set(e.id,e.text);
        else if(e.type==='message_retract') screen.delete(e.id);
      }
      return {text,events,prompts,screen:[...screen.values()]};
    };
    const opening='Vaxholm is an hour from Stockholm by boat, with ferries leaving from Strömkajen next to the Grand Hôtel.';
    const kept=await turn([say(opening,search),say('Right now a single ticket costs 59 kr.')],'r6');
    assert.equal(kept.events.some(e=>e.type==='message_retract'),false,'the opening is not taken back');
    assert.equal(kept.text,`${opening}\n\nRight now a single ticket costs 59 kr.`);
    assert.deepEqual(kept.screen,[kept.text],'the screen shows the same answer the history keeps');
    assert.ok(kept.events.findIndex(e=>e.type==='message_delta')<kept.events.findIndex(e=>e.type==='progress'),'words come before the lookup');
    assert.match(kept.prompts[1],/already wrote this to the owner/);
    const preamble=await turn([say('Let me check the current ferry prices for you.',search),say('Ferries leave from Strömkajen; a ticket costs 59 kr.')],'r7');
    assert.ok(preamble.events.some(e=>e.type==='message_retract' && e.id==='answer_r7'),'a preamble is taken back');
    assert.deepEqual(preamble.screen,['Ferries leave from Strömkajen; a ticket costs 59 kr.']);
    const card={kind:'list',title:'Ferries to Vaxholm',items:[{title:'Waxholmsbolaget',price:'59 kr'},{title:'Strömma',price:'95 kr'}],reply:'Waxholmsbolaget is the cheaper one.'};
    const carded=await turn([say(opening,search),opts=>{opts.onDelta?.('Here are the');return writes('present',card)(opts);}],'r8');
    assert.deepEqual(carded.screen,[opening,'Waxholmsbolaget is the cheaper one.'],'a card reply keeps the opening above it');
    // The model writes the start into the search call (answer_start): it streams while the call is
    // written, the search starts once its query is written and runs once, without the field.
    const ran=[];const order=[];
    const searchRun=async args=>{ran.push(args);order.push('search');return run();};
    const writesSearch=(args,size=11)=>opts=>{const raw=JSON.stringify(args);for(let i=size;i<raw.length+size;i+=size) opts.onCallDelta?.({index:0,name:'web_search',arguments:raw.slice(0,i)});order.push('call done');return {text:'',functionCalls:[{name:'web_search',args:JSON.parse(raw)}]};};
    let n=0;const events=[];
    const coordinator=chat(async opts=>[writesSearch({query:'vaxholm boat price',answer_start:opening}),say('Right now a single ticket costs 59 kr.')][n++](opts),{tools:{web_search:{run:searchRun}}});
    const text=await coordinator.run({userId:'u',chatId:'c',requestId:'r9',prompt:'How do I get to Vaxholm and what does it cost?',onEvent:e=>{events.push(e);if(e.type==='message_delta')order.push('words');}});
    assert.equal(text,`${opening}\n\nRight now a single ticket costs 59 kr.`);
    assert.deepEqual(ran,[{query:'vaxholm boat price'}],'one search, without the answer start');
    assert.ok(order.indexOf('search')<order.indexOf('call done') && order.indexOf('words')<order.indexOf('call done'),`search and words start while the call is written (${order.join(', ')})`);
    assert.equal(events.some(e=>e.type==='message_retract'),false);
    n=0;ran.length=0;const quiet=[];
    const filler=chat(async opts=>[writesSearch({query:'vaxholm boat price',answer_start:'Let me check the current ferry prices and timetables for you right away.'}),say('A ticket costs 59 kr.')][n++](opts),{tools:{web_search:{run:searchRun}}});
    assert.equal(await filler.run({userId:'u',chatId:'c',requestId:'r10',prompt:'Vaxholm boat price?',onEvent:e=>quiet.push(e)}),'A ticket costs 59 kr.','filler about searching never shows');
    assert.equal(quiet.some(e=>/Let me check/.test(e.delta || e.text || '')),false);
    // A sentence about the lookup ("I'm checking…") is held while written and left out; the rest
    // shows as written, and what shows only grows.
    const start='The Vasa Museum shows the warship Vasa, which sank in 1628. I’m checking whether it’s open today. It sits on Djurgården, 1.5 km from the centre.';
    let shown='';
    for(let i=1;i<=start.length;i++) {const now=shownStart(start.slice(0,i),false);assert.ok(now.startsWith(shown),`grows: ${now}`);shown=now;}
    assert.equal(shownStart(start,true),'The Vasa Museum shows the warship Vasa, which sank in 1628. It sits on Djurgården, 1.5 km from the centre.');
    assert.equal(shownStart('It is 1.75% now. I will confirm the latest decision',true),'It is 1.75% now.');
    assert.equal(shownStart('Jag kollar priset. Båten går från Strömkajen.',true),'Båten går från Strömkajen.');
    assert.equal(shownStart('I am sure you will love it.',true),'I am sure you will love it.');
    assert.equal(shownStart('Take the boat from Strömkajen to Vaxholm; I’m checking the current fare.',true),'Take the boat from Strömkajen to Vaxholm.');
    assert.equal(shownStart('Boats leave from Strömkajen; buses from KTH.',true),'Boats leave from Strömkajen; buses from KTH.');
    assert.equal(shownStart('Formula 1 Grand Prix winners change race to race, so I’ll check the latest completed round.',true),'','an aside about the lookup is no start');
    assert.equal(shownStart('Jag tar fram prognosen för Stockholm i morgon, fredag 9 oktober.',true),'','a Swedish aside about the lookup is no start either');
    assert.equal(shownStart('It is a good idea to check the timetable before you go.',true),'It is a good idea to check the timetable before you go.','advice to check is not about the lookup');
    assert.equal(shownStart('Take the boat from Strömkajen to Vaxholm; I’m ch',false),'Take the boat from Strömkajen to Vaxholm','the semicolon waits for the clause after it');
    // A continuation that repeats the start on screen streams only what it adds.
    const again=await turn([say(opening,search),say(`${opening} Right now a single ticket costs 59 kr.`)],'r11');
    const streamedText=again.events.filter(e=>e.type==='message_delta' && e.id==='answer_r11').map(e=>e.delta).join('');
    assert.equal(streamedText.split('Vaxholm is an hour').length-1,1,`the start shows once: ${streamedText}`);
    assert.equal(again.text,`${opening} Right now a single ticket costs 59 kr.`);
  }
  // Money lookups (wallet and Shop Pay) asked together also run at once, permission first.
  {
    const order=[];let calls=0;
    const tool=name=>({run:async()=>{order.push(`${name}:start`);await sleep(100);order.push(`${name}:end`);return {ok:true,name};}});
    const coordinator=chat(async()=>{calls++;return calls===1?{functionCalls:[{name:'wallet_status',args:{}},{name:'shop_status',args:{}}]}:{text:'You have $200.'};},
      {tools:{wallet_status:tool('wallet'),shop_status:tool('shop')},permission:async()=>({required:false})});
    await coordinator.run({userId:'u',chatId:'c',requestId:'r5',prompt:'What can I pay with?',onEvent:()=>{}});
    assert.deepEqual(order.slice(0,2),['wallet:start','shop:start']);
  }
  // A task's final answer streams over the task's own channel while the worker writes it; the
  // hidden coverage record never streams, a preamble before tool calls is taken back, and a
  // task without a channel streams nothing.
  {
    const completed=require('./completion-fixture.cjs');
    const {createTaskRuntime}=require('../server/agents/task-runtime');
    const clone=x=>x==null?x:structuredClone(x);
    const rows=new Map(),answers=[],sent=[];
    const records={
      get:async(u,id)=>{const r=rows.get(id);return r?.user_id===u?clone(r):null;},
      team:async(u,id)=>{const a=rows.get(id);return a?[clone(a)]:[];},
      create:async row=>{row.revision=1;rows.set(row.id,clone(row));return clone(row);},
      claim:async(u,id,token)=>{const r=rows.get(id);if(!r || r.lease || !['queued','running','stopping'].includes(r.state.status))return null;r.lease=token;r.revision++;return clone(r);},
      write:async(row,state,token)=>{const r=rows.get(row.id);if(r.revision!==row.revision || (token && token!==r.lease))return null;r.state=clone(state);r.revision++;return clone(r);},
      release:async(u,id,token)=>{const r=rows.get(id);if(r.lease===token)r.lease=null;},
    };
    // The worker writes its text a few characters at a time, then (maybe) calls a tool.
    const writing=(text,calls=[])=>async opts=>{for(let i=8;i<text.length+8;i+=8){opts.onDelta?.(text.slice(i-8,i),text.slice(0,i));await sleep(i%64===0?30:0);}
      for(const [n,c] of calls.entries()){opts.onCallDelta?.({index:n,name:c.name,arguments:'{}'});}return completed({text:calls.length?'':text,functionCalls:calls});};
    const make=liveAnswer=>createTaskRuntime({records,schemas:[schemaFor('web_search')],tools:{web_search:{run:async()=>[{url:'search:x',ok:true,text:'Prices'}]}},
      azure:{getSandbox:async()=>({mode:'azure'}),acquireLease:async()=>{},renewLease:async()=>{},releaseLease:async()=>{}},memory:{list:async()=>[],rank:x=>x,finish:async()=>[]},
      buildSystem:async()=>'',checkPrompt:()=>{},ensureCredit:async()=>{},protect:(_,s)=>s,logUsage:async()=>{},emitResultCard:()=>{},liveAnswer,
      model:async opts=>{const a=answers.shift();return typeof a==='function'?a(opts):completed(a);}});
    const runtime=make(async m=>{sent.push(m);});
    const row=await runtime.create({userId:'a',chatId:'c',requestKey:'k1',instructions:'Compare hotel prices in Gothenburg'});
    assert.match(row.state.answerTopic,/^answer-[a-f0-9]{64}$/);
    assert.equal(runtime.view(row).answerTopic,row.state.answerTopic,'the owner learns the channel with the task');
    const answer=`Hotel Pigalle is the best pick at 1 390 kr a night, central and quiet. ${'Avalon and Upper House are both over budget this weekend, and the Clarion Post has no rooms left on Saturday. '.repeat(2)}`;
    answers.push(writing('Let me compare the prices on a few booking sites before I answer you properly here, starting with the hotels in the city centre and then the rest of Gothenburg too.',[{name:'web_search',args:{query:'hotels gothenburg'}}]));
    await runtime.step('a',row.id);
    assert.ok(sent.some(m=>m.event==='answer'),'a long preamble streamed');
    assert.equal(sent.at(-1).event,'retract','and was taken back once the worker called a tool');
    await runtime.step('a',row.id);
    sent.length=0;
    answers.push(async opts=>{const text=completed({text:answer}).text;for(let i=8;i<text.length+8;i+=8){opts.onDelta?.(text.slice(i-8,i),text.slice(0,i));if(i%96===0)await sleep(260);}return {text};});
    await runtime.step('a',row.id);
    const state=rows.get(row.id).state;
    assert.equal(state.status,'completed');
    const streamed=sent.filter(m=>m.event==='answer');
    assert.ok(streamed.length>=2,'the answer streamed in parts');
    assert.ok(streamed.every(m=>m.topic===state.answerTopic && m.taskId===row.id && m.v===state.version));
    assert.ok(streamed.every(m=>!/task_coverage|<!--/.test(m.text)),'the hidden record never streams');
    assert.ok(answer.startsWith(streamed.at(-1).text.slice(0,100)));
    assert.equal(sent.some(m=>m.event==='retract'),false,'a delivered answer is not taken back');
    assert.ok(state.events.some(e=>e.id===`${row.id}:answer:v${state.version}` && e.phase==='task_answer'),'the saved answer has the id the stream used');
    // Without a broadcaster no channel is made and nothing streams.
    const quiet=await make(undefined).create({userId:'a',chatId:'c',requestKey:'k2',instructions:'Compare hotel prices'});
    assert.equal(quiet.state.answerTopic,undefined);
  }
  /* ---------- app: markdown and calculators, drawn as the app draws them ---------- */
  {
    const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
    const source=fs.readFileSync(path.join(__dirname,'..','app','app.js'),'utf8').replace(/\r\n/g,'\n');
    const block=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0 && b>a,from);return source.slice(a,b);};
    const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const context=vm.createContext({esc,Intl,Number,Math});
    vm.runInContext(`${block('/* ---------------- markdown-lite','\n/* ')}\n${block('/* ---------- calculator cards',"if (typeof window !== 'undefined') window.calcSummaryText")}\nthis.api={md,calcCompile,calcValues,calcEvaluate,calcOutputsHTML,calcSummaryText};`,context);
    const app=context.api;
    assert.equal(app.md('Hi **there**'),'<p>Hi <strong>there</strong></p>');
    assert.equal(app.md('## Plan\n1. One\n2. Two'),'<p class="md-h">Plan</p><ol><li>One</li><li>Two</li></ol>');
    assert.equal(app.md('3. Three\n4. Four'),'<ol start="3"><li>Three</li><li>Four</li></ol>');
    assert.equal(app.md('Options:\n- a\n- b'),'<p>Options:</p><ul><li>a</li><li>b</li></ul>','an intro line before a list stays a paragraph');
    assert.match(app.md('See https://example.com/a?b=1&c=2.'),/<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">example\.com\/a\?b=1&amp;c=2<\/a>\./);
    assert.match(app.md('[the guide](https://visitlisbon.com)'),/<a href="https:\/\/visitlisbon\.com"[^>]*>the guide<\/a>/);
    assert.doesNotMatch(app.md('[x](javascript:alert(1))'),/<a /,'only http(s) links');
    assert.equal(app.md('<script>alert(1)</script>'),'<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    assert.doesNotMatch(app.md('[x](https://a.com" onmouseover="alert(1))'),/" onmouseover/,'a quote cannot leave the link');
    assert.equal(app.md('2 * 3 * 4 = 24'),'<p>2 * 3 * 4 = 24</p>','arithmetic is not italic');
    assert.match(app.md('[Mercury](https://en.wikipedia.org/wiki/Mercury_(planet))'),/<a href="https:\/\/en\.wikipedia\.org\/wiki\/Mercury_\(planet\)"[^>]*>Mercury<\/a><\/p>$/,'a link address may hold parentheses');
    assert.match(app.md('See https://example.com/a**b**c and **this**'),/<a href="https:\/\/example\.com\/a\*\*b\*\*c" target="_blank" rel="noopener noreferrer">.*<\/a> and <strong>this<\/strong>/,'bold never lands inside a link address');
    assert.equal(app.md('a *really* good'),'<p>a <em>really</em> good</p>');
    assert.equal(app.md('```\n**not bold**\n```'),'<pre><code>**not bold**</code></pre>');
    assert.match(app.md('| A | B |\n|---|---|\n| 1 | 2 |'),/<table class="cv-table"><thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table>/);
    assert.equal(app.md('> quoted'),'<blockquote>quoted</blockquote>');
    assert.equal(app.md('a\n\nb'),app.md('a')+app.md('b'),'blocks render the same apart as together (streamPaint relies on it)');
    // The app works calculators out the same way the server checked them.
    for(const [f,v] of [['bill * (1 + tip / 100) / people',{bill:1200,tip:10,people:4}],['max(a, b) - min(a, 2)',{a:5,b:9}],['p * (1 + r/12)^(12*y)',{p:1000,r:0.05,y:2}],['-x^2',{x:3}]])
      assert.equal(app.calcCompile(f,new Set(Object.keys(v)))(v),calcCompile(f,Object.keys(v))(v),f);
    assert.equal(app.calcCompile('alert(1)',new Set()),null);
    const card=presentArgs({kind:'calculator',title:'Split',inputs:[{name:'bill',label:'Bill',value:1200,unit:'kr'},{name:'people',label:'People',value:4,min:1,max:10}],outputs:[{label:'Each',formula:'bill / people',unit:'kr'}]});
    assert.match(app.calcOutputsHTML(card,app.calcValues(card)),/Each<\/small><b>300<small> kr<\/small><\/b>/);
    card.progress={values:{people:3}};
    assert.match(app.calcOutputsHTML(card,app.calcValues(card)),/<b>400<small>/,'values the owner set are kept');
    assert.match(app.calcSummaryText(card),/People 3 → Each 400 kr/);
  }
  console.log('streaming cards: partial JSON, calculator, timeline, compare, streamed cards, one-call replies, parallel lookups, streamed task answers, markdown: ok');
})().catch(e=>{console.error(e);process.exit(1);});
