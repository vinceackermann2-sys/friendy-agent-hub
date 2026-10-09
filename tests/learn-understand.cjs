// Cards for understanding as well as practising: a step-by-step explainer, a diagram of how
// the parts connect, matching and ordering exercises, and a calculator graph that shows how a
// result changes as one input does. Built on the server, worked through in the app.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {learnArgs,learnSummary,presentArgs,resolveCardImages,resultCard}=require('../server/agents/cards');
const {CARD_TOOL_SCHEMAS,TOOL_SCHEMAS}=require('../server/agents/vm-harness');

(async()=>{
  /* ---------- server ---------- */
  const explain=learnArgs({kind:'explain',title:'How a bill becomes law',steps:[{title:'Introduced',text:'A member introduces it.',point:'Anyone in Congress can.',image_query:'United States Capitol'},{title:'Committee',text:'A committee studies it.'},{title:'',text:''}]});
  assert.equal(explain.steps.length,2,'a step needs its text');assert.equal(explain.steps[0].imageQuery,'United States Capitol');
  assert.deepEqual(learnSummary(explain),{shown:true,kind:'explain',title:'How a bill becomes law',count:2});
  await resolveCardImages(explain,{lookup:async q=>({image:`https://upload.wikimedia.org/${q.length}.jpg`,link:'https://en.wikipedia.org/wiki/X'})});
  assert.equal(explain.steps[0].image,'https://upload.wikimedia.org/21.jpg');assert.equal(explain.steps[0].imageQuery,undefined);
  const cycle=learnArgs({kind:'diagram',layout:'cycle',title:'Water cycle',nodes:[{label:'Evaporation',detail:'The sun heats water.'},{label:'Condensation'},'Precipitation',{label:''}]});
  assert.deepEqual(cycle.nodes,[{label:'Evaporation',detail:'The sun heats water.'},{label:'Condensation'},{label:'Precipitation'}]);
  assert.equal(learnArgs({kind:'diagram',layout:'spiral',title:'x',nodes:['a','b']}).layout,'flow','unknown layouts are a flow');
  assert.equal(learnArgs({kind:'diagram',layout:'hub',title:'Cell',nodes:['a','b']}).center,'Cell','a hub without a centre uses the title');
  assert.equal(learnSummary(learnArgs({kind:'diagram',title:'x',nodes:['only one']})).shown,false);
  const match=learnArgs({kind:'match',title:'Capitals',pairs:[{term:'France',match:'Paris'},{term:'Spain',match:'Madrid'},{term:'Italy',match:'Rome'},{term:'Rome again',match:'rome'}]});
  assert.equal(match.pairs.length,3,'a match used twice is dropped');
  assert.deepEqual([...match.order].sort(),[0,1,2]);assert.notDeepEqual(match.order,[0,1,2],'the matches are never in answer order');
  assert.deepEqual(learnArgs({kind:'match',title:'Capitals',pairs:match.pairs}).order,match.order,'the same pairs shuffle the same way');
  const order=learnArgs({kind:'order',title:'Planets',sequence:['Mercury','Venus','Earth','Mars','Mars'],explanation:'Closest first.'});
  assert.deepEqual(order.sequence,['Mercury','Venus','Earth','Mars']);assert.notDeepEqual(order.shuffled,[0,1,2,3]);
  assert.equal(learnSummary(learnArgs({kind:'order',title:'x',sequence:['a','b']})).shown,false,'ordering two things is no exercise');
  // A worker's explainer brings its photos to the card the same way a present card does.
  const out={shown:true};Object.defineProperty(out,'images',{value:{'united states capitol':{image:'https://upload.wikimedia.org/c.jpg'}},enumerable:false});
  assert.equal(resultCard('learn',out,{kind:'explain',title:'x',steps:[{text:'a',image_query:'United States Capitol'},{text:'b'}]}).steps[0].image,'https://upload.wikimedia.org/c.jpg');
  // The calculator graph: one output over one input's range.
  const savings=presentArgs({kind:'calculator',title:'Savings',inputs:[{name:'monthly',label:'Monthly',value:2000},{name:'years',label:'Years',value:30,min:1,max:40}],outputs:[{label:'Saved',formula:'monthly*12*years'}],graph:{x:'years',from:0,to:30,output:'Saved'}});
  assert.deepEqual(savings.graph,{x:'years',from:0,to:30,output:0});
  assert.equal(presentArgs({kind:'calculator',title:'x',inputs:[{name:'a',value:1}],outputs:[{label:'b',formula:'a*2'}],graph:{x:'nope',output:'b'}}).graph,undefined,'a graph needs a real input');
  // Every tool description fits the 1000 characters foundry.js sends (longer ones were cut off).
  for(const tool of [...TOOL_SCHEMAS,...CARD_TOOL_SCHEMAS]) assert.ok(tool.description.length<=1000,`${tool.name}: ${tool.description.length}`);

  /* ---------- app ---------- */
  const source=fs.readFileSync(path.join(__dirname,'..','app','app.js'),'utf8').replace(/\r\n/g,'\n');
  const block=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0 && b>a,from);return source.slice(a,b);};
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safe=u=>/^https:\/\//.test(String(u||''))?String(u):'';
  const painted=[];
  const context=vm.createContext({esc,icon:n=>`[${n}]`,cvHead:(t,title,sub)=>`<h>${title}|${sub}</h>`,cvTile:n=>n,safeImg:safe,safeLink:safe,
    replaceNode:(c,m)=>painted.push(m.id),save:()=>{},document:{querySelector:()=>null},setTimeout,clearTimeout,Math,Number,String,Intl,
    cvChartSVG:chart=>`<chart ${chart.labels.length}:${chart.series[0].values.at(-1)}>`});
  vm.runInContext(`${block('/* ---------- learning cards',"if (typeof window !== 'undefined') window.learnSummaryText")}\n${block('/* ---------- calculator cards',"if (typeof window !== 'undefined') window.calcSummaryText")}\nthis.api={learnCardHTML,learnAct,learnSummaryText,learnProgress,calcOutputsHTML,calcValues};`,context);
  const app=context.api,c={id:'c1'};
  const card=cd=>({id:'m',card:JSON.parse(JSON.stringify(cd))});
  const act=(m,a,o)=>app.learnAct(c,m,a,{dataset:{o:String(o)}});
  // Explainer: one step at a time, with its photo linking to its article, and dots to jump.
  const e=card({...explain});
  assert.match(app.learnCardHTML(c,e),/Step 1 of 2[\s\S]*href="https:\/\/en\.wikipedia\.org\/wiki\/X"[\s\S]*A member introduces it\.[\s\S]*Anyone in Congress can\.[\s\S]*Next step/);
  act(e,'learn-next');assert.match(app.learnCardHTML(c,e),/Step 2 of 2[\s\S]*From the start/);
  act(e,'learn-go',0);assert.equal(app.learnProgress(e.card).i,0);
  // Diagram: a cycle of parts; tapping one shows its detail, tapping again closes it.
  const d=card({...cycle,title:'Water cycle'});
  assert.match(app.learnCardHTML(c,d),/class="lc-ring is-cycle"[\s\S]*lc-arrow[\s\S]*Tap a part/);
  act(d,'learn-node',0);assert.match(app.learnCardHTML(c,d),/lc-node-detail[\s\S]*Evaporation<\/b> The sun heats water\./);
  act(d,'learn-node',0);assert.doesNotMatch(app.learnCardHTML(c,d),/lc-node-detail/);
  assert.match(app.learnCardHTML(c,card(learnArgs({kind:'diagram',layout:'flow',title:'x',nodes:['a','b','c']}))),/class="lc-flow"/);
  // Match: a wrong pair counts a miss; the right one locks in; all matched ends it.
  const mt=card(match);
  act(mt,'learn-pair',0);assert.equal(app.learnProgress(mt.card).misses,0,'a match before a term does nothing');
  act(mt,'learn-term',0);act(mt,'learn-pair',1);
  assert.equal(app.learnProgress(mt.card).misses,1);assert.match(app.learnCardHTML(c,mt),/lc-tile is-match wrong/);
  act(mt,'learn-pair',0);act(mt,'learn-term',1);act(mt,'learn-pair',1);act(mt,'learn-term',2);act(mt,'learn-pair',2);
  assert.match(app.learnCardHTML(c,mt),/All matched · 1 miss[\s\S]*Try again/);
  assert.equal(app.learnSummaryText(mt.card),'3/3 matched, 1 misses');
  // Order: only the next item in the sequence is placed; a wrong one is a miss.
  const or=card(order);
  act(or,'learn-put',2);assert.equal(app.learnProgress(or.card).misses,1);
  for(const k of [0,1,2,3]) act(or,'learn-put',k);
  assert.match(app.learnCardHTML(c,or),/Done · 1 miss[\s\S]*Mercury[\s\S]*Mars[\s\S]*Closest first\./);
  // Calculator graph: drawn from the current values and redrawn as they change.
  assert.match(app.calcOutputsHTML(savings,app.calcValues(savings)),/Saved by years, 0–30<\/small><chart 31:720000>/);
  assert.match(app.calcOutputsHTML(savings,{monthly:1000,years:30}),/<chart 31:360000>/);
  console.log('learning and understanding cards: explainer, diagrams, match, order, calculator graph: ok');
})().catch(e=>{console.error(e);process.exit(1);});
