const assert=require('node:assert/strict');
const {checkpoint,completion}=require('../server/agents/task-checkpoint');
const {createTaskRuntime}=require('../server/agents/task-runtime');
const {extractDocument}=require('../server/agents/documents');
const {createPersonalStore}=require('../server/personal-store');
const {normalizeGrant,grantDecision,createScopedPermissionStore}=require('../server/scoped-permissions');
const {configureGoalWork}=require('../server/agents/goal-work');
const store=require('../server/store');
store.getAgentPermissions=async()=>({web:'ask_some',connectors:'ask_some'});
store.listPermissionGrants=async()=>[];store.rememberBrowserHost=async()=>{};
const copy=v=>structuredClone(v);
function runtimeFixture(model,tools={},extra={}){
  const rows=new Map();const records={
    get:async(u,id)=>rows.get(id)?.user_id===u?copy(rows.get(id)):null,
    team:async(u,id)=>rows.get(id)?.user_id===u?[copy(rows.get(id))]:[],
    create:async r=>{r.revision=1;rows.set(r.id,copy(r));return copy(r);},
    claim:async(u,id)=>copy(rows.get(id)),
    write:async(r,state)=>{const next={...r,state:copy(state),revision:r.revision+1};rows.set(r.id,next);return copy(next);},release:async()=>{},
  };
  const runtime=createTaskRuntime({records,model,schemas:[{name:'web_search',parameters:{type:'object',properties:{query:{type:'string'}}}}],tools,
    emitResultCard:()=>{},azure:{getSandbox:async()=>({})},memory:{list:async()=>[],rank:x=>x,finish:async()=>[]},ensureCredit:async()=>{},checkPrompt:()=>{},protect:(_,x)=>x,logUsage:async()=>{},buildSystem:async()=>'',...extra});
  return {runtime,rows};
}
async function main(){
  const {validatePage}=require('../server/agents/page-validation');
  assert.throws(()=>validatePage('<script>const broken = true ? 1, 2 : 3;</script>'),/syntax error.*Repair/);
  assert.throws(()=>validatePage('x'.repeat(60001)),/truncated code/);
  assert.equal(validatePage('<script type="application/ld+json">{"name":"Example"}</script><script type="module">export const x = 1;</script>'),'<script type="application/ld+json">{"name":"Example"}</script><script type="module">export const x = 1;</script>');
  assert.equal(validatePage('<script>throw new Error("must never execute during validation");</script>'),'<script>throw new Error("must never execute during validation");</script>');
  await assert.rejects(require('../server/agents/tools').TOOLS.build_page.run({html:'<script>const x = ;</script>'},{trace:()=>{}}),/syntax error/,'production tool rejects invalid code before saving it');
  const edgeValidation=await import('../src/lingon-server/agents/page-validation.js');assert.throws(()=>edgeValidation.validatePage('<script>const x = ;</script>'),/syntax error/);
  let pagePlans=0,published=0,pageFixture;
  pageFixture=runtimeFixture(async()=>{
    pagePlans++;
    if(pagePlans<=2)return {functionCalls:[{name:'build_page',args:{html:pagePlans===1?'<script>const x = ;</script>':'<button>Ready</button><script>const x = 1;</script>'}}]};
    const observation=[...pageFixture.rows.values()][0].state.observations.find(o=>o.name==='build_page' && o.ok);
    return {text:'Your page is ready.<task_coverage>'+JSON.stringify({requirements:[{id:'page',text:'Create a working page',status:'done',evidenceIds:[observation.id]}]})+'</task_coverage>'};
  },{build_page:{run:async args=>{const html=validatePage(args.html);published++;return {html,ok:true};}}},{schemas:[{name:'build_page',parameters:{type:'object',properties:{html:{type:'string'}}}}]});
  let pageTask=await pageFixture.runtime.create({userId:'u',chatId:'c',instructions:'Create a working page'});
  for(let i=0;i<8 && ['queued','running'].includes(pageTask.state.status);i++)pageTask=await pageFixture.runtime.step('u',pageTask.id);
  assert.equal(pageTask.state.status,'completed');assert.equal(published,1,'invalid page is repaired without publishing the broken attempt');
  assert.equal(pageTask.state.observations.filter(o=>o.name==='build_page' && !o.ok).length,1);
  const state={version:1,observations:[{id:'good',ok:true},{id:'bad',ok:false}]};
  state.checkpoint=checkpoint(state,{requirements:[{id:'a',text:'Give 8 verified entries',status:'done',evidenceIds:['bad','invented']},{id:'b',text:'No emails',status:'pending'}]});
  assert.equal(state.checkpoint.requirements[0].status,'pending');
  state.checkpoint=checkpoint(state,{requirements:[{id:'a',text:'Give 8 verified entries',status:'done',evidenceIds:['good']}]});
  assert.equal(state.checkpoint.requirements.length,2,'summaries cannot silently drop a constraint');
  assert.equal(completion(state).verified,false);
  state.version++;assert.equal(completion(state).verified,false,'owner changes invalidate old completion');
  assert.equal(checkpoint(state,{requirements:[{id:'x',text:'Find facts',status:'done',deliverable:'invented'}]}).requirements[0].status,'pending');

  let plans=0,searches=0,h;
  h=runtimeFixture(async opts=>{
    assert.match(opts.prompt,/Exactly fifteen facts, no bookings, use primary sources/);
    if(plans++<15){assert.ok(opts.tools.some(t=>t.name==='web_search'),'research tools remain after fourteen reads');return {functionCalls:[{name:'web_search',args:{query:'source '+plans}}]};}
    const s=[...h.rows.values()][0].state;
    return {text:'Fifteen verified facts.\n<task_coverage>'+JSON.stringify({requirements:[{id:'facts',text:'Exactly fifteen facts, primary sources',status:'done',evidenceIds:s.observations.map(o=>o.id)},{id:'constraint',text:'No bookings',status:'done',deliverable:'Fifteen verified facts.'}]})+'</task_coverage>'};
  },{web_search:{run:async()=>{searches++;return {content:'Full primary source: '+'detail '.repeat(1200)};}}});
  let row=await h.runtime.create({userId:'u',chatId:'c',instructions:'Collect all facts',context:{originalPrompt:'Exactly fifteen facts, no bookings, use primary sources'}});
  for(let i=0;i<40 && ['queued','running'].includes(row.state.status);i++)row=await h.runtime.step('u',row.id);
  assert.equal(searches,15);assert.equal(row.state.status,'completed');assert.doesNotMatch(row.state.result,/task_coverage/);
  assert.match(row.state.observations[0].text,/detail detail/,'read content must not be replaced by a generated-artifact placeholder');
  assert.ok(row.state.observations[0].text.length>4000);
  const broken=runtimeFixture(async()=>({text:'Everything is done.'}));
  let incomplete=await broken.runtime.create({userId:'u',chatId:'c',instructions:'Complete all requested work'});
  broken.rows.get(incomplete.id).state.observations.push({id:'failed',name:'search',version:1,ok:false,text:'unavailable'});
  incomplete=await broken.runtime.step('u',incomplete.id);assert.equal(incomplete.state.status,'running','one chance to repair missing coverage');
  incomplete=await broken.runtime.step('u',incomplete.id);assert.equal(incomplete.state.status,'partial','unsupported success never becomes completed');
  let coveragePlans=0,repairFixture;
  repairFixture=runtimeFixture(async()=>{
    if(++coveragePlans===1)return {functionCalls:[{name:'web_search',args:{query:'primary source'}}]};
    const observation=[...repairFixture.rows.values()][0].state.observations.find(o=>o.name==='web_search');
    return {text:'Verified answer.<!-- <task_coverage>'+JSON.stringify({requirements:[{id:'fact',text:'Verify the requested fact',status:'done',evidenceIds:[coveragePlans===2?'mistyped-evidence':observation.id]}]})+'</task_coverage> -->'};
  },{web_search:{run:async()=>({text:'Primary evidence.'})}});
  let coverageTask=await repairFixture.runtime.create({userId:'u',chatId:'c',instructions:'Verify the requested fact'});
  for(let i=0;i<8 && ['queued','running'].includes(coverageTask.state.status);i++)coverageTask=await repairFixture.runtime.step('u',coverageTask.id);
  assert.equal(coverageTask.state.status,'completed','pending coverage gets one chance to repair evidence references');assert.equal(coveragePlans,3);assert.equal(coverageTask.state.result,'Verified answer.','hidden coverage comment never leaks into the visible answer');

  let peak=0,active=0;
  const parallel=runtimeFixture(async()=>({functionCalls:[{name:'composio_execute',args:{tool:'GMAIL_FETCH_MESSAGE_BY_ID',args:{message_id:'one'}}},{name:'composio_execute',args:{tool:'GMAIL_FETCH_MESSAGE_BY_ID',args:{message_id:'two'}}}]}),{composio_execute:{approval:true,run:async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,10));active--;return {ok:true};}}});
  const parallelTask=await parallel.runtime.create({userId:'u',chatId:'c',instructions:'Read two messages'});await parallel.runtime.step('u',parallelTask.id);await parallel.runtime.step('u',parallelTask.id);assert.equal(peak,2,'independent connector reads execute concurrently');
  let permitted=true,phase=0,actions=0;
  store.getAgentPermissions=async()=>({web:'always_ask',connectors:'always_ask'});
  store.listPermissionGrants=async()=>permitted?[{id:'temporary',effect:'allow',tool:'composio_execute',scopeMode:'exact',match:{tool:'GMAIL_FETCH_EMAILS',connectedAccountId:'ca_a'},expiresAt:new Date(Date.now()+60000).toISOString()}]:[];
  const revoked=runtimeFixture(async()=>({functionCalls:[{name:'composio_execute',args:{tool:'GMAIL_FETCH_EMAILS',connectedAccountId:'ca_a'}}]}),{composio_execute:{approval:true,run:async()=>{actions++;return {ok:true};}}},{ensureCredit:async()=>{if(phase)permitted=false;}});
  const revokedTask=await revoked.runtime.create({userId:'u',chatId:'c',instructions:'Read inbox'});await revoked.runtime.step('u',revokedTask.id);phase=1;await revoked.runtime.step('u',revokedTask.id);assert.equal(actions,0,'a revoked grant is rechecked immediately before execution');
  store.getAgentPermissions=async()=>({web:'ask_some',connectors:'ask_some'});store.listPermissionGrants=async()=>[];
  let warmResolve,warming=false;const warmPromise=new Promise(r=>{warmResolve=r;});
  const warm=runtimeFixture(async()=>({text:'Prepared.'}),{}, {schemas:[{name:'browser_open',parameters:{type:'object',properties:{}}}],azure:{getSandbox:async()=>({}),prewarm:()=>{warming=true;return warmPromise;}}});
  const warmTask=await warm.runtime.create({userId:'u',chatId:'c',instructions:'Prepare to use the browser'});
  const warmStep=warm.runtime.step('u',warmTask.id);const raced=await Promise.race([warmStep,new Promise(r=>setTimeout(()=>r(null),100))]);warmResolve();assert.ok(raced && warming,'planning does not await a cold VM');
  const paused=runtimeFixture(async()=>{throw new Error('Must not spend tokens after pausing');},{},{goalStatus:async()=>({status:'paused',work:{enabled:true}})});
  const pausedTask=await paused.runtime.create({userId:'u',chatId:'c',instructions:'Goal work',context:{goalId:'g',automation:true}});assert.equal((await paused.runtime.step('u',pausedTask.id)).state.status,'stopped');
  let failurePlans=0;
  const unavailable=runtimeFixture(async()=>++failurePlans===1?{functionCalls:[{name:'browser_open',args:{url:'https://example.com'}}]}:{text:'The headline is Example.'},{browser_open:{run:async()=>{throw new Error('Computer unavailable');}}});
  const unavailableTask=await unavailable.runtime.create({userId:'u',chatId:'c',instructions:'Open the page in the browser'});
  let unavailableRow;for(let i=0;i<5;i++){unavailableRow=await unavailable.runtime.step('u',unavailableTask.id);if(unavailableRow.state.status==='partial')break;}
  assert.equal(unavailableRow.state.status,'partial');assert.equal(failurePlans,2,'unavailable actions do not spend another model round just formatting a completion record');
  assert.match(unavailableRow.state.result,/browser action could not be completed/i,'failed requested actions are disclosed even when the model omits them');
  assert.equal(unavailableRow.state.coverage.verified,false);
  const bulk={messages:[...Array.from({length:22},(_,i)=>({messageId:'n'+i,subject:'Promotion '+i,sender:'store',messageTimestamp:'2026-09-24',labelIds:['PROMOTIONS'],messageText:'sale '.repeat(500)})),{messageId:'important',subject:'Contract due Friday',sender:'Anna',messageTimestamp:'2026-09-24'}]};
  const compact=require('../server/composio').compactResult(bulk);
  assert.match(JSON.stringify(compact),/important/,'message inventories retain the final important item');assert.equal(compact.result.messages.length,23);
  const {pricingFor,costOf}=require('../server/plans');assert.equal(pricingFor({model:'gpt-6-luna'}).model,'gpt-6-luna');
  assert.throws(()=>costOf({model:'unpriced-deployment',input_tokens:100}),{code:'MODEL_PRICE_MISSING'});
  process.env.MODEL_RATE_TABLE_JSON=JSON.stringify({'priced-alias':{input:1,cached:0.1,cacheWrite:1.25,output:2,version:'test'}});
  assert.equal(costOf({model:'priced-alias',input_tokens:100000,output_tokens:100000}),0.3);delete process.env.MODEL_RATE_TABLE_JSON;
  const originalBill=store.logUsage,billed=[];store.logUsage=async(u,payload)=>billed.push(payload);
  try{await require('../server/agents/runner').logModelUsage('u','gpt-6-luna',[{input_tokens:100,output_tokens:10,model:'gpt-6-luna',deployment:'luna-prod',provider:'azure-foundry'}]);}finally{store.logUsage=originalBill;}
  assert.equal(billed[0].usage.deployment,'luna-prod');assert.equal(billed[0].usage.pricing.model,'gpt-6-luna');assert.ok(billed[0].cost>0);
  assert.equal((await require('../server/agents/permission-policy').permissionDecision('u','composio_execute',{tool:'composio_execute'},{})).denied,true,'malformed connector actions never ask the owner to approve them');
  const expiry=new Date(Date.now()+86400000).toISOString();
  const grant={...normalizeGrant({tool:'composio_execute',effect:'allow',scopeMode:'subset',match:{tool:'GMAIL_FETCH_EMAILS',connectedAccountId:'ca_a',args:{label:'INBOX'}},expiresAt:expiry}),id:'g'};
  assert.equal(grantDecision([grant],'composio_execute',{tool:'GMAIL_FETCH_EMAILS',connectedAccountId:'ca_a',args:{label:'INBOX',limit:10}}).required,false);
  assert.equal(grantDecision([grant],'composio_execute',{tool:'GMAIL_FETCH_EMAILS',connectedAccountId:'ca_b',args:{label:'INBOX'}}),null);
  assert.equal(grantDecision([{...grant,scopeMode:'exact'}],'composio_execute',{...grant.match,args:{label:'INBOX',bcc:'other@example.com'}}),null,'exact remembered actions cannot acquire extra arguments');
  assert.equal(grantDecision([grant],'composio_execute',{tool:'GMAIL_SEND_EMAIL',connectedAccountId:'ca_a',args:{label:'INBOX'}}),null);
  assert.equal(grantDecision([{...grant,revokedAt:new Date().toISOString()}],'composio_execute',grant.match),null);
  assert.equal(grantDecision([grant],'composio_execute',grant.match,Date.now()+2*86400000),null);
  assert.equal(grantDecision([grant,{...grant,effect:'deny'}],'composio_execute',grant.match).denied,true);
  assert.throws(()=>normalizeGrant({tool:'shell',effect:'allow',match:{command:'*'},expiresAt:expiry}));
  assert.throws(()=>normalizeGrant({tool:'composio_execute',effect:'allow',match:{tool:'READ'},expiresAt:expiry}));

  let disk={},seq=0;const deps={supa:()=>null,ensureProfile:async()=>{},uid:()=>String(++seq),loadLocal:()=>copy(disk),saveLocal:d=>{disk=copy(d);}};
  const personal=createPersonalStore(deps),permissions=createScopedPermissionStore(deps);
  const file=await personal.saveLibraryItem('u',{title:'plan.md',content:'Version one'});
  const edited=await personal.saveLibraryItem('u',{id:file.id,revision:file.revision,title:file.title,content:'Version two'});
  assert.equal(edited.id,file.id);assert.equal(edited.revision,2);
  assert.equal((await personal.getLibraryItem('u',file.id,1)).content,'Version one');
  assert.equal((await personal.listLibraryVersions('u',file.id)).length,2);
  await assert.rejects(personal.saveLibraryItem('u',{id:file.id,revision:1,title:file.title,content:'stale'}),{code:'CONFLICT'});
  assert.equal(await personal.getLibraryItem('other',file.id,1),null);
  const savedGrant=await permissions.createPermissionGrant('u',grant);await permissions.revokePermissionGrant('other',savedGrant.id);assert.equal((await permissions.listPermissionGrants('u')).length,1);
  await permissions.revokePermissionGrant('u',savedGrant.id);assert.equal((await permissions.listPermissionGrants('u')).length,0);
  const key='12345678-1234-1234-1234-123456789012';
  const remembered=await permissions.createPermissionGrant('u',grant,{idempotencyKey:key});
  await permissions.revokePermissionGrant('u',remembered.id);
  assert.ok((await permissions.createPermissionGrant('u',grant,{idempotencyKey:key})).revokedAt,'retry never revives a revoked grant');
  const webGrant={...normalizeGrant({tool:'web_search',effect:'allow',match:{url:'https://example.com/'},expiresAt:expiry}),id:'web'};
  assert.equal(grantDecision([webGrant],'web_search',{urls:['https://example.com/'],activity:'Reading'}).required,false);
  assert.equal(grantDecision([webGrant],'web_search',{urls:['https://example.com/','https://elsewhere.com/']}),null);

  const {zipSync,strToU8}=await import('fflate');
  const docx=zipSync({'word/document.xml':strToU8('<w:document><w:body><w:p><w:r><w:t>Full request</w:t></w:r></w:p><w:p><w:r><w:t>second paragraph &amp; constraints</w:t></w:r></w:p></w:body></w:document>')});
  const word=await extractDocument(docx,{name:'example.docx'});assert.match(word.text,/Full request\nsecond paragraph & constraints/);
  const originalDocUrl='data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,'+Buffer.from(docx).toString('base64');
  let savedDocument;
  const prepared=await require('../server/agents/attachments').prepareDocumentAttachments([{name:'too-big',size:11*1024*1024},{name:'example.docx',dataUrl:originalDocUrl}],async item=>{savedDocument=item;return {id:'original-doc',...item};});
  assert.equal(savedDocument.content,originalDocUrl,'Office originals must remain binary-safe before cloud persistence');
  assert.match(savedDocument.extractedText,/Full request/);
  assert.equal(prepared.metadata.length,1);assert.equal(prepared.metadata[0].name,'example.docx');assert.equal(prepared.metadata[0].libraryId,'original-doc');assert.match(prepared.prompt,/Full request/);
  const xlsx=zipSync({'xl/worksheets/sheet1.xml':strToU8('<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Cost</t></is></c><c r="B1"><f>2+3</f><v>5</v></c></row></sheetData></worksheet>')});
  const sheet=await extractDocument(xlsx,{name:'example.xlsx'});assert.match(sheet.text,/A1: Cost/);assert.match(sheet.text,/B1: 5.*cached value/);
  await assert.rejects(extractDocument(zipSync({'word/document.xml':strToU8('<!DOCTYPE data><w:document/>')}),{name:'unsafe.docx'}),/entity/);
  await assert.rejects(extractDocument(zipSync({'word/document.xml':strToU8('x'.repeat(13*1024*1024))}),{name:'oversize.docx'}),/too large/);
  const body='BT /F1 12 Tf 72 720 Td (PDF evidence) Tj ET';
  const pdf=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n5 0 obj << /Length '+body.length+' >> stream\n'+body+'\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF');
  assert.match((await extractDocument(pdf,{name:'evidence.pdf'})).text,/PDF evidence/);

  const goal=await personal.createGoal('u',{title:'Research options'});let agents=new Map();
  const goalStore={...personal,createSubAgent:async(u,a)=>{const row={...a,id:'agent1',chatId:'chat1'};agents.set(row.id,row);return row;},getSubAgent:async(u,id)=>agents.get(id),updateSubAgent:async(u,id,a)=>{agents.set(id,{...a,id,chatId:'chat1'});return agents.get(id);}};
  const configured=await configureGoalWork(goalStore,'u',goal.id,{successCriteria:'Five sourced options',nextAction:'Compare costs',maxRuns:2,allowedTools:['web_search','shell']});
  assert.deepEqual(configured.work.allowedTools,['web_search']);assert.equal(configured.work.maxRuns,2);
  assert.equal(agents.get('agent1').trigger.goalId,goal.id);
  await configureGoalWork(goalStore,'u',goal.id,{enabled:false});assert.equal(agents.get('agent1').enabled,false);
  await assert.rejects(configureGoalWork(goalStore,'other',goal.id,{enabled:true}),/not found/);
  await assert.rejects(configureGoalWork(goalStore,'u',goal.id,{successCriteria:'x',nextAction:'y',maxRuns:100}),/Budget/);
  console.log('DevDay regression: long-task coverage, durable evidence, file extraction/version isolation, scoped revocation and bounded goal configuration passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
