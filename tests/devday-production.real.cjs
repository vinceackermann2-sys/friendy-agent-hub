// Explicit production verification: only temporary accounts and their own data.
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {createClient}=require('@supabase/supabase-js');
const {chromium}=require('playwright');
const base=process.env.VERIFY_BASE || 'https://belna.se',out=process.env.VERIFY_OUT || 'artifacts/devday-verification';
const admin=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const users=[],chatIds=[],report={checkedAt:new Date().toISOString(),base,checks:[],agentSamples:[],cleanup:false};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
fs.mkdirSync(out,{recursive:true});
const save=()=>fs.writeFileSync(out+'/production.json',JSON.stringify(report,null,2));
async function api(session,path,method='GET',body,expected=200){
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...(session?{authorization:'Bearer '+session.access_token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
  const data=await response.json();assert.ok((Array.isArray(expected)?expected:[expected]).includes(response.status),`${method} ${path}: ${response.status} ${data.error || ''}`);return data;
}
async function account(){
  const email='verify-'+crypto.randomUUID()+'@example.invalid',password=crypto.randomUUID()+'aA1!';
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw created.error;
  const row={id:created.data.user.id};users.push(row);
  row.session=await api(null,'/api/auth/signin','POST',{email,password});assert.ok(row.session.access_token);return row.session;
}
async function check(name,fn){
  if(process.env.VERIFY_FILTER && !name.includes(process.env.VERIFY_FILTER))return;
  try{await fn();report.checks.push({name,pass:true});console.log('PASS '+name);}
  catch(error){report.checks.push({name,pass:false,error:error.message});console.log('FAIL '+name+': '+error.message);}
  save();
}
async function converse(session,prompt,context={}){
  const chatId='verify_'+crypto.randomUUID(),start=Date.now();chatIds.push({session,chatId});
  const response=await fetch(base+'/api/agent/conversation',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.access_token},body:JSON.stringify({chatId,requestId:crypto.randomUUID(),prompt,context:{timeZone:'Europe/Stockholm',...context}}),signal:AbortSignal.timeout(120000)});
  assert.equal(response.status,200);const raw=await response.text();
  const events=raw.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
  const errors=events.filter(e=>e.type==='error');assert.deepEqual(errors,[],'conversation errors');
  const all=[...events],taskIds=new Set(events.filter(e=>e.type==='task').map(e=>e.task?.id || e.id).filter(Boolean));
  const traces=[],statuses=[];
  for(const taskId of taskIds){
    let task;
    for(let i=0;i<40 && Date.now()-start<180000;i++){
      const result=await api(session,'/api/agent/tasks/advance','POST',{chatId,taskId,after:task?.sequence || 0});task=result.task;all.push(...task.events || []);
      if(!['queued','running','waiting_peers','stopping'].includes(task.status))break;
      await pause(150);
    }
    statuses.push({id:taskId,status:task.status});
    const trace=(await api(session,'/api/agent/tasks/trace?chatId='+chatId+'&taskId='+taskId)).task;traces.push(trace);
  }
  const text=all.filter(e=>e.type==='message' && ['final_answer','task_answer'].includes(e.phase)).map(e=>e.text).join('\n');
  const cards=all.filter(e=>e.type==='card').map(e=>e.card);
  const result={prompt,text,cards,traces,ms:Date.now()-start};report.agentSamples.push(result);save();for(const task of statuses)assert.equal(task.status,'completed','task '+task.id+' stopped at '+task.status);return result;
}
(async()=>{
  let browser,owner,foreign,goal,file,grant;
  try{
    await check('live release frontend and Luna health',async()=>{
      const health=await api(null,'/api/health');assert.equal(health.ok,true);assert.equal(health.model,'gpt-6-luna');assert.equal(health.foundry,true);assert.equal(health.supabase,true);
      const normalize=t=>t.replace(/\r\n/g,'\n');
      for(const name of ['app.js','styles.css','auth.js','engine.managed.js']){
        const response=await fetch(base+'/lingon/'+name+'?verify='+Date.now());assert.equal(response.status,200);
        assert.equal(normalize(await response.text()),normalize(fs.readFileSync('public/lingon/'+name,'utf8')),'deployed '+name+' matches release');
      }
      for(const [method,path] of [['GET','/api/permission-grants'],['GET','/api/library/x/versions'],['PUT','/api/goals/x/work']])await api(null,path,method,method==='PUT'?{}:undefined,401);
    });
    owner=await account();foreign=await account();
    await check('production file revisions, stale edits and account isolation',async()=>{
      file=(await api(owner,'/api/library','POST',{title:'Verification.md',mime:'text/markdown',content:'Version one',source:'upload'})).item;
      const edit=(await api(owner,'/api/library/'+file.id,'PATCH',{revision:1,content:'Version two',title:file.title,mime:file.mime})).item;assert.equal(edit.revision,2);
      assert.equal((await api(owner,'/api/library/'+file.id+'?revision=1')).item.content,'Version one');
      assert.equal((await api(owner,'/api/library/'+file.id)).item.content,'Version two');
      const versions=(await api(owner,'/api/library/'+file.id+'/versions')).versions;assert.equal(versions.length,2);
      await api(owner,'/api/library/'+file.id,'PATCH',{revision:1,content:'Stale'},[400,409]);
      await api(foreign,'/api/library/'+file.id,'GET',undefined,404);await api(foreign,'/api/library/'+file.id+'/versions','GET',undefined,404);
      const row=await admin.from('library_items').select('content,storage_path').eq('id',file.id).eq('user_id',owner.user.id).single();if(row.error)throw row.error;
      assert.equal(row.data.content,'');const publicRead=await fetch(process.env.SUPABASE_URL+'/storage/v1/object/public/library-private/'+row.data.storage_path);assert.ok(!publicRead.ok);
    });
    await check('production scoped permissions, expiry and foreign revoke',async()=>{
      grant=(await api(owner,'/api/permission-grants','POST',{tool:'composio_execute',effect:'allow',match:{tool:'GMAIL_FETCH_EMAILS',connectedAccountId:'ca_verify',args:{label:'INBOX'}},expiresAt:new Date(Date.now()+3600000).toISOString()})).grant;
      assert.equal((await api(owner,'/api/permission-grants')).grants.length,1);assert.deepEqual((await api(foreign,'/api/permission-grants')).grants,[]);
      await api(foreign,'/api/permission-grants/'+grant.id,'DELETE');assert.equal((await api(owner,'/api/permission-grants')).grants.length,1);
      await api(owner,'/api/permission-grants','POST',{tool:'shell',effect:'allow',match:{command:'*'},expiresAt:new Date(Date.now()+3600000).toISOString()},400);
      await api(owner,'/api/permission-grants','POST',{tool:'composio_execute',effect:'allow',match:{tool:'GMAIL_FETCH_EMAILS',connectedAccountId:'ca_verify'},expiresAt:new Date(Date.now()-1000).toISOString()},400);
    });
    await check('production goal link, bounds and pause',async()=>{
      goal=(await api(owner,'/api/goals','POST',{title:'Verification goal',category:'other'})).goal;
      const work={successCriteria:'Read the goal state',nextAction:'List goals only',maxRuns:2,maxRounds:2,intervalMinutes:1440,startAt:new Date(Date.now()+86400000).toISOString(),allowedTools:['goal_list']};
      await api(foreign,'/api/goals/'+goal.id+'/work','PUT',work,400);
      await api(owner,'/api/goals/'+goal.id+'/work','PUT',{...work,maxRuns:100},400);
      const enabled=(await api(owner,'/api/goals/'+goal.id+'/work','PUT',work)).goal;assert.equal(enabled.work.maxRuns,2);assert.deepEqual(enabled.work.allowedTools,['goal_list']);
      const agents=(await api(owner,'/api/sub-agents')).subAgents;assert.ok(agents.some(a=>a.id===enabled.work.agentId && a.trigger.goalId===goal.id && a.enabled));
      await api(owner,'/api/goals/'+goal.id+'/work','PUT',{enabled:false});
      assert.equal((await api(owner,'/api/sub-agents')).subAgents.find(a=>a.id===enabled.work.agentId).enabled,false);
    });
    await check('live desktop/mobile UI with real APIs',async()=>{
      assert.ok(file && goal && grant,'API fixtures required');browser=await chromium.launch();
      for(const width of [1440,390])for(const view of ['goals','library','settings']){
        const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
        page.on('response',r=>{if(r.url().includes('/api/'))requests.push({path:new URL(r.url()).pathname,status:r.status(),method:r.request().method()});});
        await context.addInitScript(({session,view})=>{
          localStorage.setItem('lingon.session',JSON.stringify(session));localStorage.setItem('lingon.v1',JSON.stringify({ownerId:session.user.id,onboarded:true,agent:{name:'Verification',color:'lingon',pers:'Precise'},view,settingsTab:'browser',chats:[],goals:[],vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
        },{session:owner,view});
        await page.goto(base+'/app',{waitUntil:'load'});page.setDefaultTimeout(15000);
        try{if(view==='goals'){
          await page.locator('.goal-card').first().waitFor();assert.equal(await page.locator('.goal-work,[data-act^=goal-work]').count(),0,'ongoing work is set up from chat, not a form');
        }else if(view==='library'){
          await page.locator('[data-act=library-item-open]').first().click();await page.locator('.lib-viewer details summary').filter({hasText:'File versions'}).click();await page.locator('[data-act=lib-versions]').click();await page.locator('[data-act=lib-version-open]').first().waitFor({state:'attached'});
          await page.locator('.lib-viewer summary').filter({hasText:'Edit this file'}).click();await page.locator('[data-library-edit]').fill('UI revision '+width);await page.locator('[data-act=lib-version-save]').click();
          await page.waitForFunction(text=>document.querySelector('.lib-viewer-body')?.textContent.includes(text),'UI revision '+width);
        }else{
          if(!(await api(owner,'/api/permission-grants')).grants.length)grant=(await api(owner,'/api/permission-grants','POST',{tool:'composio_execute',effect:'allow',match:{tool:'GMAIL_FETCH_EMAILS',connectedAccountId:'ca_verify',args:{label:'INBOX'}},expiresAt:new Date(Date.now()+3600000).toISOString()})).grant;
          await page.locator('[data-act=permission-grants-load]').click();await page.locator('[data-act=permission-grant-revoke]').first().click();await page.waitForFunction(()=>!document.querySelector('[data-act=permission-grant-revoke]'));
        }
        assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow '+view+' '+width);
        await page.screenshot({path:out+'/live-'+view+'-'+width+'.png',fullPage:true});}
        catch(error){await page.screenshot({path:out+'/failed-'+view+'-'+width+'.png',fullPage:true});fs.writeFileSync(out+'/failed-'+view+'-'+width+'.json',JSON.stringify({requests,errors,text:(await page.locator('body').textContent()).slice(-6000)},null,2));throw new Error(view+' '+width+': '+error.message);}
        finally{await context.close();}
      }
      await browser.close();browser=null;
    });
    await check('real Luna draft respects no sending',async()=>{
      const result=await converse(owner,'Draft exactly two short sentences asking my landlord to fix the kitchen tap this week. Only draft it; do not send anything.');assert.match(result.text,/tap|faucet/i);assert.equal([...new Intl.Segmenter('en',{granularity:'sentence'}).segment(result.text)].length,2,'exactly two draft sentences');assert.ok(result.text.length<250,'short draft');assert.ok(!result.cards.some(c=>c?.type==='approval'));assert.ok(!result.traces.some(t=>t.steps.some(s=>/mail_send|SEND_EMAIL/.test(s.name))));
    });
    await check('real Luna reads PDF DOCX XLSX and retains all requested facts',async()=>{
      const {zipSync,strToU8}=await import('fflate');
      const docx=zipSync({'word/document.xml':strToU8('<w:document><w:body><w:p><w:r><w:t>Project Cedar. Monthly budget EUR 175. Target ship date 12 October 2026.</w:t></w:r></w:p></w:body></w:document>')});
      const xlsx=zipSync({'xl/worksheets/sheet1.xml':strToU8('<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Owner: Mira</t></is></c><c r="B1" t="inlineStr"><is><t>Vendor price: unverified; contact sales.</t></is></c></row></sheetData></worksheet>')});
      const text='BT /F1 12 Tf 72 720 Td (Contract status: DRAFT ONLY) Tj ET';const pdf=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n5 0 obj << /Length '+text.length+' >> stream\n'+text+'\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF');
      const attachments=[['Project.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',docx],['Owner.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xlsx],['Contract.pdf','application/pdf',pdf]].map(([name,type,bytes])=>({name,type,size:bytes.length,dataUrl:'data:'+type+';base64,'+Buffer.from(bytes).toString('base64')}));
      for(let attempt=0;attempt<3;attempt++){
      const result=await converse(owner,'Read all three attachments. Give exactly six numbered lines: project name, monthly budget, ship date, owner, vendor price status, and contract status. Keep the unverified vendor price explicit. Do not send, subscribe, purchase or change anything.',{attachments});
      assert.equal(result.traces.length,1,'one worker covers the complete file request');assert.equal(result.traces[0].title,result.prompt.replace(/\s+/g,' ').slice(0,84),'deployed runtime uses the original request');
      const delivered=result.text+' '+JSON.stringify(result.cards);for(const pattern of [/Cedar/i,/175/,/12.*October.*2026|October.*12.*2026|2026-10-12/i,/Mira/i,/unverified|contact sales/i,/DRAFT ONLY/i])assert.match(delivered,pattern);
      const lines=result.text.split('\n').filter(line=>/^\d+[.)]\s/.test(line));assert.equal(lines.length,6,'all six requested numbered answers');
      assert.doesNotMatch(result.text,/<task_coverage>/);assert.ok(!result.traces.some(t=>t.steps.some(s=>/mail_send|shop_purchase/.test(s.name))));
      const originals=(await api(owner,'/api/library')).items;
      for(const attachment of attachments){
        const original=originals.find(i=>i.title===attachment.name);assert.ok(original,'original '+attachment.name+' persisted');
        const stored=(await api(owner,'/api/library/'+original.id)).item;assert.equal(stored.content,attachment.dataUrl,'original bytes preserved for '+attachment.name);assert.ok(stored.extractedText?.trim(),'extracted '+attachment.name);assert.ok(!stored.extractionWarnings.some(w=>/failed/i.test(w)));
      }
      }
    });
    await check('real Luna completes a bounded goal run and preserves activity',async()=>{
      const enabled=(await api(owner,'/api/goals/'+goal.id+'/work','PUT',{successCriteria:'Checked the current goal list',nextAction:'List my goals once. If nothing needs a change, return exactly NO_CHANGE. Do not use websites or change anything.',allowedTools:['goal_list'],maxRuns:1,maxRounds:3,intervalMinutes:1440,startAt:new Date(Date.now()+86400000).toISOString()})).goal;
      await api(owner,'/api/sub-agents/'+enabled.work.agentId+'/run','POST',{});
      let runs,task;
      for(let i=0;i<24;i++){
        runs=(await api(owner,'/api/automation-runs')).runs.filter(r=>r.subAgentId===enabled.work.agentId || r.sub_agent_id===enabled.work.agentId);assert.ok(runs.length,'real automation run created');
        const taskId=runs[0].result?.taskId;
        if(taskId){task=(await api(owner,'/api/agent/tasks/advance','POST',{chatId:enabled.work.chatId,taskId})).task;if(!['queued','running','waiting_peers','stopping'].includes(task.status))break;}
        await pause(1000);
      }
      report.manualGoal={status:task?.status,trace:task?.id?(await api(owner,'/api/agent/tasks/trace?chatId='+enabled.work.chatId+'&taskId='+task.id)).task:null};save();
      assert.equal(task?.status,'completed');await pause(1500);
      await api(owner,'/api/sub-agents/'+enabled.work.agentId+'/run','POST',{},[200,409]);
      const stored=(await api(owner,'/api/goals')).goals.find(g=>g.id===goal.id);assert.ok(stored.activity.length);assert.equal(stored.work.enabled,false,'run cap stops further work');
      await api(owner,'/api/goals/'+goal.id+'/work','PUT',{enabled:false});
    });
    if(base==='https://belna.se')await check('production scheduler wakes goal work without a manual run',async()=>{
      const cases=[];
      for(let i=0;i<3;i++){
        const scheduled=(await api(owner,'/api/goals','POST',{title:'Scheduled verification '+(i+1),category:'other'})).goal;
        const configured=(await api(owner,'/api/goals/'+scheduled.id+'/work','PUT',{successCriteria:'Read the goal list',nextAction:'List goals once. Nothing needs changing; return exactly NO_CHANGE.',allowedTools:['goal_list'],maxRuns:1,maxRounds:4,intervalMinutes:1440,startAt:new Date(Date.now()+10000).toISOString()})).goal;
        cases.push({scheduled,configured});
      }
      let selected=[];
      for(let i=0;i<80;i++){
        const runs=(await api(owner,'/api/automation-runs')).runs;
        selected=cases.map(({configured})=>runs.find(r=>(r.subAgentId || r.sub_agent_id)===configured.work.agentId));
        if(selected.every(run=>run && !['running','waiting_approval'].includes(run.status)))break;
        await pause(1500);
      }
      report.schedulerSamples=[];
      for(let i=0;i<cases.length;i++){
      const {scheduled,configured}=cases[i],run=selected[i];
      report.scheduler={status:run?.status,trigger:run?.event?.type,output:run?.result?.output};save();
      if(run?.result?.taskId){report.scheduler.trace=(await api(owner,'/api/agent/tasks/trace?chatId='+configured.work.chatId+'&taskId='+run.result.taskId)).task;save();}
      report.schedulerSamples.push(report.scheduler);save();
      assert.ok(run,'scheduler created a run');assert.equal(run.event.type,'schedule');assert.equal(run.status,'idle','NO_CHANGE remains quiet');
      const activity=(await api(owner,'/api/goals')).goals.find(g=>g.id===scheduled.id).activity;assert.ok(activity.some(a=>a.status==='idle'),'unchanged check remains in goal activity');
      const messages=await admin.from('messages').select('id').eq('user_id',owner.user.id).eq('chat_id',configured.work.chatId);if(messages.error)throw messages.error;assert.equal(messages.data.length,0,'unchanged goal work creates no chat notification');
      report.scheduler.activityCount=activity.length;report.scheduler.chatMessageCount=messages.data.length;
      await api(owner,'/api/goals/'+scheduled.id+'/work','PUT',{enabled:false});
      }
    });
  }finally{
    if(browser)await browser.close();
    for(const {session,chatId} of chatIds){try{for(const task of (await api(session,'/api/agent/tasks?chatId='+chatId)).tasks)if(['queued','running','waiting_approval','waiting_peers'].includes(task.status))await api(session,'/api/agent/tasks/control','POST',{chatId,taskId:task.id,action:'stop'});}catch{}}
    for(const user of users){
      await admin.from('sub_agents').update({enabled:false}).eq('user_id',user.id);
      try{for(const item of (await api(user.session,'/api/library')).items)await api(user.session,'/api/library/'+item.id,'DELETE');}catch{}
      if(user.session?.access_token)await admin.auth.admin.signOut(user.session.access_token);
      const profile=await admin.from('profiles').delete().eq('id',user.id);if(profile.error)throw profile.error;
      const deleted=await admin.auth.admin.deleteUser(user.id);if(deleted.error)throw deleted.error;
    }
    report.cleanup=true;report.passed=report.checks.every(c=>c.pass);save();
  }
  if(!report.passed)process.exitCode=1;
})().catch(error=>{report.fatal=error.message;save();console.error(error.message);process.exitCode=1;});
