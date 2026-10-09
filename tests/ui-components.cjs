// The chat's visual components beyond lists and tables: places with a Maps route, recipes
// that scale, weather forecasts, drafts, donut charts, facts, photos found for named items
// (Wikipedia), source links under looked-up answers, and image carousels.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {presentArgs,presentSummary,resultCard,lookupImage,resolveCardImages,applyImages}=require('../server/agents/cards');
const {createCoordinator}=require('../server/agents/conversation');
const {CARD_TOOL_SCHEMAS,CHAT_PRESENT}=require('../server/agents/vm-harness');

const schemaFor=name=>({name,description:name,parameters:{type:'object',properties:{}}});
const coordinator=(model,extra={})=>createCoordinator({tasks:{summaries:async()=>[]},model,schemas:['present','web_search'].map(schemaFor),tools:{},
  azure:{getSandbox:async()=>({mode:'azure'})},store:{listMemories:async()=>[],saveTurn:async()=>{}},buildSystem:async()=>'SYSTEM',ensureCredit:async()=>{},
  logUsage:async()=>{},checkPrompt:()=>{},protect:(_,s)=>s,rank:x=>x,finishMemory:async()=>[],...extra});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  /* ---------- server: card builders ---------- */
  const places=presentArgs({kind:'places',title:'Road trip',facts:['≈ 480 km','5–7 h',' ','x'.repeat(60),'5th'],items:[
    {title:'Brahehus',address:'Gränna',rating:4.3,image_query:'Brahehus castle ruin'},{title:'Polkapojkarna',rating:9,image:'http://insecure.example/x.jpg'},{title:'Jönköping',image:'https://example.com/j.jpg',image_query:'ignored'}]});
  assert.deepEqual(places.facts,['≈ 480 km','5–7 h','5th'],'at most four short facts; blanks and long notes left out, never cut off');
  assert.equal(places.items[0].imageQuery,'Brahehus castle ruin');assert.equal(places.items[0].rating,4.3);assert.equal(places.items[0].address,'Gränna');
  assert.equal(places.items[1].rating,undefined,'a rating outside 0-5 is dropped');assert.equal(places.items[1].image,undefined,'only https photos');
  assert.equal(places.items[2].imageQuery,undefined,'an item with a photo needs no lookup');
  const recipe=presentArgs({kind:'recipe',title:'Roast chicken',servings:4,time:'1 h 45 min',image_query:'roast chicken',ingredients:[{item:'chicken',amount:1.6,unit:'kg'},{item:'salt',note:'to taste'},{item:'',amount:2},'pepper'],steps:['Heat oven','Roast']});
  assert.deepEqual(recipe.ingredients,[{item:'chicken',amount:1.6,unit:'kg'},{item:'salt',note:'to taste'},{item:'pepper'}]);
  assert.equal(recipe.servings,4);assert.equal(recipe.imageQuery,'roast chicken');assert.equal(presentSummary(recipe).shown,true);
  const forecast=presentArgs({kind:'forecast',title:'Weather',place:'Stockholm',unit:'F',days:[{when:'Fri',sky:'rain',high:54.4,low:'45',rain:'80%'},{when:'Sat',sky:'hail'},{sky:'sun'}]});
  assert.deepEqual(forecast.days,[{when:'Fri',sky:'rain',high:54,low:45,rain:'80%'},{when:'Sat',sky:'cloud'}],'unknown skies read as cloud; a day needs its name');
  assert.equal(forecast.unit,'F');
  const draft=presentArgs({kind:'draft',title:'Email',to:'anna@example.se',subject:'Tap',body:'Hi Anna,\r\n\r\nThe tap drips.'});
  assert.equal(draft.body,'Hi Anna,\n\nThe tap drips.');
  assert.equal(presentSummary(presentArgs({kind:'forecast',title:'x',days:[{when:'Fri',sky:'rain'}]})).shown,false,'a forecast needs temperatures');
  // An email written out as text becomes a draft card; its intro and follow-up question stay the reply.
  const {cardFromMarkdown}=require('../server/agents/cards');
  const written=cardFromMarkdown('Here is a draft you can send:\n\n**Subject:** Dripping kitchen tap\n\nHi Anna,\n\nThe kitchen tap has been dripping since Monday. Could someone fix it this week?\n\nThanks,\nVincent\n\nWant me to make it more formal?');
  assert.equal(written.card.kind,'draft');assert.equal(written.card.subject,'Dripping kitchen tap');
  assert.match(written.card.body,/^Hi Anna,[\s\S]*this week\?\n\nThanks,\nVincent$/);
  assert.equal(written.rest,'Here is a draft you can send.\n\nWant me to make it more formal?');
  assert.equal(cardFromMarkdown('Subject: Biology\nTopics: cells, genetics, evolution and ecology for the exam next week.'),null,'not a letter');
  // The model's own writing-block markup becomes the same card.
  const writingBlock=cardFromMarkdown('Here you go:\n\n:::writing{variant="email" subject="Dripping kitchen tap" }\nHi Anna,\n\nThe tap drips. Could you fix it this week?\n\nThanks,\nVincent\n:::');
  assert.equal(writingBlock.card.subject,"Dripping kitchen tap");assert.match(writingBlock.card.body,/^Hi Anna,[\s\S]*Vincent$/);assert.equal(writingBlock.rest,"Here you go.");
  assert.equal(cardFromMarkdown(':::writing{variant="social_post"}\nBig news: we open on Monday!\n:::').card.title,'Draft');
  assert.equal(cardFromMarkdown('Ämne: Läckande kran\n\nHej Anna,\n\nKranen i köket droppar. Kan ni laga den den här veckan?\n\nMed vänliga hälsningar\nVincent').card.subject,'Läckande kran');
  for(const kind of ['recipe','forecast','draft']) { const s=presentSummary(presentArgs({kind,title:'x'})); assert.equal(s.shown,false,kind); assert.match(s.note,/Nothing to show/); }
  const donut=presentArgs({kind:'dashboard',title:'Budget',chart:{type:'donut',labels:['Rent','Food'],series:[{values:[8000,3000]},{values:[1,2]}]}});
  assert.equal(donut.chart.type,'donut');assert.equal(donut.chart.series.length,1,'a donut has one series');
  assert.equal(presentArgs({kind:'dashboard',title:'x',chart:{type:'donut',series:[{values:[5,-2]}]}}).chart.type,'bar','negative shares are not a donut');
  // Workers get places, photos and facts; recipes, forecasts, drafts and calculators are the chat's.
  const worker=CARD_TOOL_SCHEMAS.find(t=>t.name==='present');
  assert.ok(worker.parameters.properties.kind.enum.includes('places'));
  assert.ok(!worker.parameters.properties.kind.enum.includes('recipe'));
  assert.ok(worker.parameters.properties.items.items.properties.image_query && worker.parameters.properties.facts);
  assert.deepEqual(CHAT_PRESENT.kinds,['calculator','recipe','forecast','draft','plan']);
  assert.ok(worker.parameters.properties.kind.enum.includes('checklist') && worker.parameters.properties.note,'workers show checklists and notes too');
  assert.ok(!worker.parameters.properties.refine && !worker.parameters.properties.sections,'Help me choose and plans are the chat\'s');

  /* ---------- server: photos from Wikipedia ---------- */
  const calls=[];
  const wiki=pages=>async url=>{calls.push(url);return {ok:true,json:async()=>({query:{pages}})};};
  const found=await lookupImage('Gamla Linköping museum',{fetch:wiki([{index:1,title:'Linköping',fullurl:'https://en.wikipedia.org/wiki/Link%C3%B6ping',thumbnail:{source:'https://upload.wikimedia.org/a.jpg'}},{index:2,title:'Gamla Linköping',fullurl:'https://en.wikipedia.org/wiki/Gamla_Link%C3%B6ping',thumbnail:{source:'https://upload.wikimedia.org/b.jpg'}}])});
  assert.equal(found.image,'https://upload.wikimedia.org/b.jpg','the article sharing the most words wins');
  assert.equal(found.link,'https://en.wikipedia.org/wiki/Gamla_Link%C3%B6ping');
  assert.match(calls[0],/en\.wikipedia\.org\/w\/api\.php\?.*gsrsearch=gamla%20link%C3%B6ping%20museum/);
  assert.equal(await lookupImage('cosy corner cafe',{fetch:wiki([{index:1,title:'Södermalm',thumbnail:{source:'https://upload.wikimedia.org/s.jpg'}}])}),null,'an article that shares no word is not used');
  assert.equal(await lookupImage('broken',{fetch:async()=>{throw new Error('offline');}}),null);
  const card=presentArgs({kind:'list',title:'Lisbon',items:[{title:'Belém Tower',image_query:'Belém Tower'},{title:'Slow',image_query:'slow one'},{title:'Own',url:'https://own.example',image_query:'own'}]});
  const t0=Date.now();
  await resolveCardImages(card,{timeoutMs:150,lookup:async q=>{if(q==='slow one'){await sleep(1000);return {image:'https://x/late.jpg'};}return {image:`https://upload.wikimedia.org/${q.length}.jpg`,link:'https://en.wikipedia.org/wiki/X'};}});
  assert.ok(Date.now()-t0<500,'a slow photo is left out, not waited for');
  assert.equal(card.items[0].image,'https://upload.wikimedia.org/11.jpg');assert.equal(card.items[0].imageLink,'https://en.wikipedia.org/wiki/X');
  assert.equal(card.items[1].image,undefined);assert.equal(card.items[2].imageLink,undefined,'an item with its own link keeps it');
  assert.ok(card.items.every(it=>!('imageQuery' in it)),'lookups are not sent to the app');
  // A worker's present result carries its photos to the card, but not to the model's next prompt.
  const out={shown:true,kind:'list',title:'x'};
  Object.defineProperty(out,'images',{value:{'belém tower':{image:'https://upload.wikimedia.org/b.jpg',link:'https://en.wikipedia.org/wiki/Bel%C3%A9m_Tower'}},enumerable:false});
  const shown=resultCard('present',out,{kind:'list',title:'Lisbon',items:[{title:'Belém Tower',image_query:'Belém Tower'}]});
  assert.equal(shown.items[0].image,'https://upload.wikimedia.org/b.jpg');assert.ok(!JSON.stringify(out).includes('upload.wikimedia'));
  assert.equal(applyImages(presentArgs({kind:'list',title:'x',items:[{title:'a',image_query:'a'}]}),{a:{image:'javascript:alert(1)'}}).items[0].image,undefined,'only https photos');

  /* ---------- server: the chat fills photos in before the finished card, and names its sources ---------- */
  {
    const events=[],asked=[];
    const args={kind:'places',title:'Lisbon sights',items:[{title:'Belém Tower',image_query:'Belém Tower'},{title:'Alfama',image_query:'Alfama'}],reply:'Start in Alfama.'};
    const chat=coordinator(async opts=>{const raw=JSON.stringify(args);for(let i=10;i<raw.length+10;i+=10)opts.onCallDelta?.({index:0,name:'present',arguments:raw.slice(0,i)});return {text:'',functionCalls:[{name:'present',args}]};},
      {findImage:async q=>{asked.push(q);return {image:`https://upload.wikimedia.org/${q.replace(/\W/g,'')}.jpg`,link:'https://en.wikipedia.org/wiki/'+q.replace(/ /g,'_')};}});
    await chat.run({userId:'u',chatId:'c',requestId:'p1',prompt:'What to see in Lisbon?',onEvent:e=>events.push(e)});
    const final=events.find(e=>e.type==='card');
    assert.deepEqual(final.card.items.map(i=>i.image),['https://upload.wikimedia.org/BelmTower.jpg','https://upload.wikimedia.org/Alfama.jpg']);
    assert.ok(asked.indexOf('Belém Tower')<asked.lastIndexOf('Alfama'),'the first photo was asked for while the card streamed');
  }
  {
    const events=[];let n=0;
    const page=(url,title)=>({title,url,text:'Forecast: 14°C and rain.'});
    const chat=coordinator(async()=>(++n===1?{functionCalls:[{name:'web_search',args:{query:'weather stockholm tomorrow'}}]}:{text:'Tomorrow: 14°C with rain.'}),
      {tools:{web_search:{run:async()=>[{url:'search:weather',ok:true,text:JSON.stringify({results:[page('https://www.smhi.se/vader','SMHI'),page('https://www.smhi.se/other','SMHI 2'),{title:'Unread',url:'https://unread.example'},page('https://www.yr.no/en','Yr')]})}]}}});
    await chat.run({userId:'u',chatId:'c',requestId:'s1',prompt:'Weather tomorrow?',onEvent:e=>events.push(e)});
    const message=events.find(e=>e.type==='message');
    assert.deepEqual(message.sources.map(s=>s.host),['smhi.se','yr.no'],'pages that were read, one per site');
    assert.equal(message.sources[0].url,'https://www.smhi.se/vader');
  }
  {
    const events=[];
    const chat=coordinator(async()=>({text:'Paris.'}));
    await chat.run({userId:'u',chatId:'c',requestId:'s2',prompt:'Capital of France?',onEvent:e=>events.push(e)});
    assert.equal(events.find(e=>e.type==='message').sources,undefined,'no lookup, no sources');
  }

  /* ---------- app: drawing the components ---------- */
  const source=fs.readFileSync(path.join(__dirname,'..','app','app.js'),'utf8').replace(/\r\n/g,'\n');
  const block=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0 && b>a,from);return source.slice(a,b);};
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safe=u=>/^https:\/\//.test(String(u||''))?String(u):'';
  const painted=[];
  const context=vm.createContext({esc,icon:n=>`[${n}]`,safeImg:safe,safeLink:safe,cvHead:(t,title,sub)=>`<h>${title}|${sub}</h>`,cvTile:n=>n,cvRow:(l,v)=>v?`<row>${l}:${v}</row>`:'',
    compareHTML:()=>'<compare>',calcValues:()=>({}),calcInputHTML:()=>'',calcOutputsHTML:()=>'',replaceNode:(c,m)=>painted.push(m.id),save:()=>{},toast:()=>{},Intl,Math,Number,String,
    navigator:{userAgent:'Mozilla/5.0 (Linux; Android 14)'},encodeURIComponent});
  vm.runInContext(`${block('// Shares of one whole as a ring','\nfunction cvChartSVG')}\n${block('function presentCardHTML(c, m){','\n/* Two to four options side by side')}\nthis.api={presentCardHTML,recipeAmount,mapsRouteUrl,mapsPlaceUrl,sourcesHTML,cvDonutSVG,presentAct,recipeProgress,checklistText};`,context);
  const app=context.api, c={id:'c1'};
  const draw=card=>app.presentCardHTML(c,{id:'m1',card});
  assert.deepEqual([0.5,0.25,0.75,1.5,2/3,1.6,12.4,1234,0.98].map(app.recipeAmount),['½','¼','¾','1½','⅔','1.6','12','1235','1']);
  // Places: every stop opens in Maps, and the whole trip opens as one route with its stops between.
  const placesHTML=draw({...places,items:[{title:'Stockholm'},{title:'Brahehus',address:'Gränna',rating:4.3,image:'https://upload.wikimedia.org/b.jpg',imageLink:'https://en.wikipedia.org/wiki/Brahehus'},{title:'Gothenburg'}]});
  assert.match(placesHTML,/Open route in Maps/);
  assert.equal(app.mapsRouteUrl([{title:'Stockholm'},{title:'Brahehus',address:'Gränna'},{title:'Gothenburg'}]),'https://www.google.com/maps/dir/?api=1&origin=Stockholm&destination=Gothenburg&waypoints=Brahehus%2C%20Gr%C3%A4nna');
  assert.match(placesHTML,/href="https:\/\/en\.wikipedia\.org\/wiki\/Brahehus"/,'a stop without its own page links to its photo\'s article');
  assert.match(placesHTML,/\[star\] 4\.3/);assert.match(placesHTML,/≈ 480 km/,'facts show as chips');
  assert.equal(app.mapsPlaceUrl({title:'Brahehus',address:'Gränna'}),'https://www.google.com/maps/search/?api=1&query=Brahehus%2C%20Gr%C3%A4nna');
  // Recipes scale with the servings, and the owner ticks things off.
  const recipeCard={...recipe,image:'https://upload.wikimedia.org/c.jpg'};
  assert.match(draw(recipeCard),/<b>1\.6 kg<\/b> chicken/);assert.match(draw(recipeCard),/cv-cover/);assert.match(draw(recipeCard),/1 h 45 min/);
  const m={id:'m2',card:recipeCard};
  app.presentAct(c,m,'pc-serv',{dataset:{d:'2'}});app.presentAct(c,m,'pc-have',{dataset:{i:'0'}});
  assert.equal(m.card.progress.servings,6);assert.match(app.presentCardHTML(c,m),/<b>2\.4 kg<\/b> chicken/);assert.match(app.presentCardHTML(c,m),/<li class="done">/);
  for(let i=0;i<10;i++) app.presentAct(c,m,'pc-serv',{dataset:{d:'-1'}});
  assert.equal(m.card.progress.servings,1,'never fewer than one');
  // Forecasts, drafts, donuts and totals.
  assert.match(draw(forecast),/Fri<\/small><svg[\s\S]*54°<\/b><span class="cv-wx-low">45°/);
  const draftHTML=draw(draft);
  assert.match(draftHTML,/contenteditable="plaintext-only"/);assert.match(draftHTML,/Open in Mail/);assert.match(draftHTML,/<row>To:anna@example\.se<\/row>/);
  assert.doesNotMatch(draw({...draft,to:undefined,subject:undefined}),/Open in Mail/,'a post has Copy only');
  assert.match(draw({...draft,body:'<img src=x onerror=alert(1)>'}),/&lt;img src=x/,'draft text is escaped');
  assert.match(app.cvDonutSVG(donut.chart),/Rent<\/span><b>73%<\/b>[\s\S]*Food<\/span><b>27%<\/b>/);
  assert.match(draw(presentArgs({kind:'table',title:'Budget',columns:['Expense','Cost'],rows:[['Fuel','650 kr'],['Total','650 kr']]})),/<tr class="is-total"><td>Total/);
  // Three or more photographed items browse as image cards; fewer stay a list.
  const shoes=n=>({type:'present',kind:'products',title:'Shoes',items:Array.from({length:n},(_,i)=>({title:`Shoe ${i}`,price:'999 kr',image:`https://img.example/${i}.jpg`,url:`https://shop.example/${i}`}))});
  assert.match(draw(shoes(3)),/cv-carousel/);assert.doesNotMatch(draw(shoes(2)),/cv-carousel/);
  // Sources: a link per page, its site's icon, nothing unsafe.
  const src=app.sourcesHTML([{url:'https://www.smhi.se/vader',host:'smhi.se',title:'SMHI'},{url:'javascript:alert(1)',host:'evil.example'},{url:'https://x.example',host:'bad host"><script>'}]);
  assert.match(src,/href="https:\/\/www\.smhi\.se\/vader"[\s\S]*src="https:\/\/smhi\.se\/favicon\.ico"/);
  assert.equal((src.match(/src-chip/g) || []).length,1,'unsafe links and hosts are left out');
  // Checklists: ticked off in place, cleared, copied as text with their sections.
  const cm={id:'m3',card:{type:'present',kind:'checklist',title:'Pack',items:[{title:'Boots',group:'Wear'},{title:'Jacket',group:'Wear'},{title:'Map',group:'Gear',subtitle:'paper'}]}};
  assert.match(app.presentCardHTML(c,cm),/0 of 3 checked[\s\S]*cv-cl-group">Wear[\s\S]*cv-cl-group">Gear/);
  app.presentAct(c,cm,'pc-tick',{dataset:{i:'1'}});
  assert.deepEqual(cm.card.progress.done,[false,true,false]);assert.match(app.presentCardHTML(c,cm),/1 of 3 checked/);
  assert.equal(app.checklistText(cm.card),'Pack\n\nWear\n☐ Boots\n☑ Jacket\n\nGear\n☐ Map (paper)');
  app.presentAct(c,cm,'pc-reset',{dataset:{}});assert.match(app.presentCardHTML(c,cm),/0 of 3 checked/);
  // Help me choose: the owner's picks go out as one message, once.
  const sentPrompts=[];context.sendPrompt=(t,files,o)=>sentPrompts.push([t,o?.chat?.id]);
  const rm={id:'m4',card:{type:'present',kind:'compare',title:'AirPods or Sony',items:[{title:'AirPods'},{title:'Sony'}],refine:[{q:'What phone do you use?',options:['iPhone','Android']},{q:'What matters most?',options:['Sound','Comfort']}]}};
  assert.match(app.presentCardHTML(c,rm),/data-act="pc-choose"[^>]*disabled/,'nothing to send before a pick');
  app.presentAct(c,rm,'pc-pick',{dataset:{q:'0',o:'1'}});
  assert.doesNotMatch(app.presentCardHTML(c,rm),/data-act="pc-choose"[^>]*disabled/);
  app.presentAct(c,rm,'pc-choose',{dataset:{}});app.presentAct(c,rm,'pc-choose',{dataset:{}});
  assert.deepEqual(sentPrompts,[['AirPods or Sony: What phone do you use? Android.','c1']],'sent once, to the chat the card is in, with the question it answers');
  assert.match(app.presentCardHTML(c,rm),/cv-refine is-sent/);
  // A plan over several days shows one day at a time when the owner picks it.
  const dm={id:'m5',card:{type:'present',kind:'timeline',title:'Trip',items:[1,2,3].flatMap(d=>[{group:`Day ${d}`,when:'09:00',title:`Morning ${d}`},{group:`Day ${d}`,when:'15:00',title:`Afternoon ${d}`}])}};
  assert.match(app.presentCardHTML(c,dm),/data-act="pc-day"[\s\S]*Day 3/);
  app.presentAct(c,dm,'pc-day',{dataset:{g:'Day 2'}});
  const dayHTML=app.presentCardHTML(c,dm);assert.match(dayHTML,/Morning 2/);assert.doesNotMatch(dayHTML,/Morning 1|Morning 3/);
  // Two or more photos of places sit together on top, numbered; the stops then have no thumbnails.
  const collage=draw({...places,items:[{title:'A',image:'https://x.example/a.jpg'},{title:'B',image:'https://x.example/b.jpg'},{title:'C'}]});
  assert.match(collage,/cv-collage n2[\s\S]*cv-collage-n">1<[\s\S]*cv-collage-n">2</);assert.doesNotMatch(collage,/cv-place-img/);
  // A card's footnote, and two-column tables read as labels and values.
  assert.match(draw(presentArgs({kind:'table',title:'Estimate',rows:[['Food','900 kr'],['Total','900 kr']],note:'Approximate prices.'})),/cv-table is-kv[\s\S]*cv-note">Approximate prices\./);
  // A plan: its parts under numbered headings; ticking its shopping list keeps the tick with the plan.
  const plan=presentArgs({kind:'plan',title:'Dinner for 6',sections:[{kind:'list',title:'The menu',items:['Starter','Main','Dessert'].map((g,i)=>({group:g,title:`Dish ${i}`,image:`https://x.example/${i}.jpg`}))},{kind:'checklist',title:'Shopping list',items:[{title:'Tomatoes'},{title:'Rice'}]},{kind:'table',title:'Budget',rows:[['Food','900 kr'],['Estimated total','1 100 kr']]}]});
  const pm={id:'m6',card:plan};
  const planHTML=app.presentCardHTML(c,pm);
  assert.match(planHTML,/cv-collage n3[\s\S]*cv-sec-hd"><span>1<\/span>The menu[\s\S]*cv-over">Starter[\s\S]*<span>2<\/span>Shopping list[\s\S]*0 of 2 checked[\s\S]*<span>3<\/span>Budget[\s\S]*<tr class="is-total"><td>Estimated total/);
  assert.doesNotMatch(planHTML,/cv-carousel/,'a plan\'s menu stays rows under its labels');
  app.presentAct(c,pm,'pc-tick',{dataset:{s:'1',i:'1'}});
  assert.deepEqual(pm.card.progress.sections[1].done,[false,true]);assert.match(app.presentCardHTML(c,pm),/1 of 2 checked/);
  assert.equal(pm.card.sections[1].progress,undefined,'the section itself is not changed');
  console.log('ui components: places, recipes, forecasts, drafts, donuts, facts, photos, sources, carousels, checklists, help me choose, day filter, collage, plans: ok');
})().catch(e=>{console.error(e);process.exit(1);});
