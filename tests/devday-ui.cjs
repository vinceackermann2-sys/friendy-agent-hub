const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {createServer}=require('node:http');const {chromium}=require('playwright');
(async()=>{
  const root=path.resolve(__dirname,'../app'),server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+(url.pathname==='/app'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
    try{const data=await fs.readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp'})[path.extname(file)] || 'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();
  try{for(const width of [1440,390])for(const view of ['goals','library','settings']){
    const ctx=await browser.newContext({viewport:{width,height:900}}),requests=[],errors=[];
    let goal={id:'goal_test',title:'Compare five options',category:'other',status:'active',steps:[],work:{},activity:[],createdAt:Date.now()};
    let item={id:'lib_test',title:'Plan.md',kind:'document',mime:'text/markdown',size:8,content:'Original',preview:'Original',revision:1,source:'agent',createdAt:Date.now()};
    let grants=[{id:'grant1',tool:'composio_execute',effect:'allow',label:'Read work inbox',match:{tool:'GMAIL_FETCH_EMAILS',connectedAccountId:'ca_work',args:{label:'INBOX'}},expiresAt:new Date(Date.now()+86400000).toISOString()}];
    await ctx.addInitScript(view=>{
      localStorage.setItem('lingon.session',JSON.stringify({access_token:'test',user:{id:'ui-audit',email:'test@example.invalid'}}));
      localStorage.setItem('lingon.v1',JSON.stringify({ownerId:'ui-audit',onboarded:true,agent:{name:'Audit',color:'lingon',pers:'Precise'},view,settingsTab:'browser',chats:[],goals:[],vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
    },view);
    await ctx.route('**/api/**',async route=>{
      const r=route.request(),u=new URL(r.url()),method=r.method(),data=r.postData()?JSON.parse(r.postData()):{};requests.push({path:u.pathname,method,data});let out={};
      if(u.pathname==='/api/goals')out={goals:[goal]};
      if(u.pathname==='/api/goals/goal_test/work'){goal={...goal,work:{...goal.work,...data,nextWakeAt:new Date(Date.now()+86400000).toISOString()}};out={goal};}
      if(u.pathname==='/api/library'){const {content,...metadata}=item;out={items:[metadata]};}
      if(u.pathname==='/api/library/lib_test'){
        if(method==='PATCH'){item={...item,...data,revision:item.revision+1};const {content,...metadata}=item;out={item:metadata};}
        else{await new Promise(r=>setTimeout(r,width===1440?200:500));out={item};}
      }
      if(u.pathname==='/api/library/lib_test/versions'){await new Promise(r=>setTimeout(r,width===1440?500:100));out={versions:[{revision:1,title:'Plan.md',updatedAt:Date.now()}]};}
      if(u.pathname==='/api/agent-permissions')out={permissions:{web:'ask_some',connectors:'ask_some'}};
      if(u.pathname==='/api/permission-grants')out={grants};
      if(u.pathname==='/api/permission-grants/grant1' && method==='DELETE'){grants=[];out={ok:true};}
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(out)});
    });
    const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/app');
    if(view==='goals'){
      await page.locator('.goal-work summary').click();await page.locator('[data-goal-field=success]').fill('Five primary-source options');await page.locator('[data-goal-field=next]').fill('Compare monthly prices');
      await page.locator('[data-act=goal-work-save]').click();await page.locator('[data-act=goal-work-pause]').waitFor({state:'attached'});
      assert.equal(requests.find(r=>r.path.endsWith('/work')).data.maxRounds,4);assert.equal(goal.work.nextAction,'Compare monthly prices');
      // Repaint closes details; reopen before pausing.
      if(!await page.locator('[data-act=goal-work-pause]').isVisible())await page.locator('.goal-work summary').click();
      await page.locator('[data-act=goal-work-pause]').click();await page.waitForFunction(()=>!document.querySelector('[data-act=goal-work-pause]'));
      assert.equal(goal.work.enabled,false);
    }else if(view==='library'){
      await page.locator('[data-act=library-item-open]').first().click();await page.locator('.lib-viewer details summary').filter({hasText:'File versions'}).click();await page.locator('[data-act=lib-versions]').click();await page.locator('[data-act=lib-version-open]').waitFor({state:'attached'});
      await page.locator('.lib-viewer summary').filter({hasText:'Edit this file'}).click();assert.equal(await page.locator('[data-act=lib-version-open]').count(),1,'history survives either file-load ordering');await page.locator('[data-library-edit]').fill('Revised plan');await page.locator('[data-act=lib-version-save]').click();
      await page.waitForFunction(()=>document.querySelector('.lib-viewer-body')?.textContent.includes('Revised plan'));
      assert.equal(item.revision,2);assert.equal(item.content,'Revised plan');
    }else{
      await page.locator('[data-act=permission-grants-load]').click();await page.locator('[data-act=permission-grant-revoke]').click();await page.waitForFunction(()=>!document.querySelector('[data-act=permission-grant-revoke]'));assert.equal(grants.length,0);
    }
    assert.deepEqual(errors,[],`${view} ${width} browser errors`);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${view} overflows ${width}px`);
    await fs.mkdir('artifacts/devday-2026',{recursive:true});await page.screenshot({path:`artifacts/devday-2026/${view}-${width}.png`,fullPage:true});await ctx.close();
  }console.log('DevDay UI: goal enable/pause, file history/edit and grant revoke passed on desktop and mobile.');}
  finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
