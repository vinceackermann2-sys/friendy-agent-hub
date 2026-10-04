const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
(async()=>{
  const appDir=path.resolve('app'),calls=[],registrations=[],commandId=crypto.randomUUID(),userId=crypto.randomUUID();
  const server=http.createServer((req,res)=>{
    const name=['/','/app'].includes(req.url.split('?')[0])?'index.html':path.basename(req.url.split('?')[0]);
    const pathname=new URL(req.url,'http://localhost').pathname;
    const file=pathname.startsWith('/lingon/')?path.resolve('public','.'+pathname):path.join(appDir,name);
    if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
  });
  server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const browser=await chromium.launch();
  try{
    const context=await browser.newContext({viewport:{width:393,height:852}});
    await context.addInitScript(({userId})=>{
      window.__nativeCalls=[];
      window.BelnaNative={platform:'ios',request:async body=>{
        window.__nativeCalls.push(body);
        if(body.method==='status')return{name:'Test iPhone',capabilities:{calendar:true,reminders:false,contacts:false,health:false}};
        if(body.method==='execute')return{events:[{title:'Actual device fixture'}]};
        return{ok:true};
      }};
      localStorage.setItem('lingon.session',JSON.stringify({access_token:'native-fixture',user:{id:userId,email:'native@example.invalid'}}));
      localStorage.setItem('lingon.v1',JSON.stringify({ownerId:userId,onboarded:true,agent:{name:'Belna',color:'lingon',pers:'Calm'},view:'apps',activeChat:'phone-chat',chats:[{id:'phone-chat',title:'New chat',messages:[],trace:[]}],vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
    },{userId});
    let delivered=false,completionAttempt=0,inviteRequests=0;
    await context.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url()),body=req.postData()?JSON.parse(req.postData()):{};
      calls.push({path:url.pathname,method:req.method(),body,authorization:req.headers().authorization});
      let value={};
      if(url.pathname==='/api/apple/devices' && req.method()==='POST'){registrations.push(body);value={ok:true};}
      else if(/^\/api\/apple\/devices\/[^/]+\/commands$/.test(url.pathname)){value={commands:delivered?[]:[{id:commandId,leaseToken:crypto.randomUUID(),action:'calendar.list',args:{start:'2026-10-04T00:00:00Z',end:'2026-10-05T00:00:00Z'},expiresAt:new Date(Date.now()+120000).toISOString()}]};delivered=true;}
      else if(url.pathname.endsWith('/commands/'+commandId) && req.method()==='POST'){
        completionAttempt++;
        if(completionAttempt===1)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary connection loss'})});
        value={ok:true};
      }
      else if(url.pathname==='/api/composio/apps')value={apps:[]};
      else if(url.pathname==='/api/connectors')value={connectors:[],available:true};
      else if(url.pathname==='/api/client-state')value={profile:null,chats:[],durable:true};
      else if(url.pathname==='/api/auth/me')value={user:{id:userId,email:'native@example.invalid'}};
      else if(url.pathname==='/api/referrals/mine'){inviteRequests++;value={code:'BELNA-TEST12',link:'https://example.invalid/invite',invited:0,earnedTokens:0};}
      else if(url.pathname==='/api/library')value={items:[{id:'lib_phone',title:'A weekend plan with all the details.md',mime:'text/markdown',revision:1,size:90,createdAt:Date.now(),updatedAt:Date.now()}]};
      else if(url.pathname==='/api/library/lib_phone')value={item:{id:'lib_phone',title:'A weekend plan with all the details.md',mime:'text/markdown',revision:1,content:'# Weekend plan\nChoose dates and compare places to stay.'}};
      else if(url.pathname==='/api/goals')value={goals:[{id:'goal_phone',title:'Make time for a weekend away with family and friends',category:'relationships',status:'active',createdAt:Date.now(),steps:[{id:'step_phone',title:'Choose dates that work for everyone',done:false}]}]};
      await route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
    });
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const evidence=process.env.APPLE_UI_EVIDENCE_ROOT;
    const capture=async name=>{if(evidence){fs.mkdirSync(evidence,{recursive:true});await page.waitForFunction(()=>[...document.querySelectorAll('*')].every(node=>!node.getAnimations().some(animation=>animation.playState==='running' && animation.effect?.getTiming().iterations!==Infinity)));await page.screenshot({path:path.join(evidence,name+'.png')});}};
    await page.goto('http://127.0.0.1:'+server.address().port+'/app');
    await page.locator('#cprompt').waitFor({timeout:15000});
    assert.equal(await page.locator('.landing').count(),0,'native launch opens the agent instead of the marketing site or last web page');
    const navigate=async view=>{
      await page.locator('.mobile-nav-toggle').click();
      if(['settings','apps'].includes(view))await page.locator('[data-act="usermenu"]').click();
      await page.locator(['library','goals'].includes(view)?'[data-act="open-'+view+'"]':'[data-act="nav"][data-view="'+view+'"]').click();
    };
    await navigate('apps');
    await page.waitForFunction(()=>document.querySelector('[data-apple-scope="calendar"]')?.textContent.includes('Connected on Test iPhone'));
    assert.equal(await page.locator('.apple-connector').count(),4,'each Apple app has its own connector card');
    await capture('mobile-connectors');
    await page.locator('[data-act="app-filter"][data-f="connected"]').click();
    assert.deepEqual(await page.locator('.apple-connector').evaluateAll(nodes=>nodes.map(n=>n.dataset.appleScope)),['calendar']);
    await page.locator('[data-act="app-filter"][data-f="all"]').click();
    await page.locator('#appquery').fill('health');
    assert.deepEqual(await page.locator('.apple-connector').evaluateAll(nodes=>nodes.map(n=>n.dataset.appleScope)),['health']);
    await page.locator('#appquery').fill('');
    await page.locator('[data-apple-scope="calendar"] .conn-head').press('Enter');
    await page.locator('[data-act="refresh-apps"]').click();
    await page.locator('[data-apple-scope="calendar"] .conn-body [data-act="apple-apps"]').click();
    await page.waitForFunction(()=>window.__nativeCalls.some(x=>x.method==='settings'));
    assert.equal((await page.evaluate(()=>window.__nativeCalls.find(x=>x.method==='settings'))).scope,'calendar');
    assert.equal(calls.some(x=>/\/api\/composio\/.*apple-/.test(x.path)),false,'Apple cards never request a Composio toolkit');
    await page.waitForFunction(()=>window.__nativeCalls.some(x=>x.method==='execute'));
    for(let i=0;i<40 && completionAttempt<2;i++)await page.waitForTimeout(100);
    assert.equal(completionAttempt,2,'failed result delivery retries');
    assert.equal((await page.evaluate(()=>window.__nativeCalls.filter(x=>x.method==='execute'))).length,1,'delivery retry never repeats a native action');
    assert.equal(registrations.length,1);assert.equal(registrations[0].capabilities.calendar,true);
    assert.equal(calls.filter(x=>x.path.startsWith('/api/apple')).every(x=>x.authorization==='Bearer native-fixture'),true);
    assert.equal(JSON.stringify(registrations).includes('Actual device fixture'),false,'connecting sends capability metadata only');
    for(const view of ['settings','library','goals']){
      await navigate(view);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,view+' fits the phone width');
      await capture('mobile-'+view);
      if(view==='goals'){
        assert.equal(await page.locator('.goals-create').getAttribute('open'),null,'existing goals stay above a collapsed create section');
        await page.setViewportSize({width:844,height:393});
        await page.locator('section.goals-create').waitFor();
        await page.setViewportSize({width:393,height:852});
        await page.locator('details.goals-create').waitFor();
      }
    }
    await navigate('chat');
    await page.locator('.chathead [data-act="togglecanvas"]').click();
    await page.waitForFunction(()=>document.querySelector('.canvas-close').getBoundingClientRect().right<=innerWidth+1);
    const close=await page.locator('.canvas-close').boundingBox();
    assert.ok(close.width>=44 && close.height>=44 && close.x+close.width<=394 && close.y<30,'panel close is a reachable top-right touch target: '+JSON.stringify(close));
    await capture('mobile-right-panel');
    await page.locator('.canvas-close').click();
    await page.locator('[data-act="opengift"]').click();
    await page.locator('#giftcode-text').waitFor();
    assert.equal(await page.locator('.giftmodal-redeem').getAttribute('open'),null,'redeem form stays compact until requested');
    const sheet=await page.locator('.giftmodal-card').boundingBox();
    assert.ok(sheet.height<650 && sheet.y>=0 && sheet.y+sheet.height<=852,'invite sheet fits without filling the whole phone');
    await capture('mobile-invite');
    await page.locator('[data-act="closegift"]').click();
    await page.locator('[data-act="opengift"]').click();
    await page.locator('#giftcode-text').waitFor();
    assert.equal(inviteRequests,1,'reopening the invite reuses the fresh owner-scoped code');
    await page.locator('.giftmodal-redeem summary').click();
    assert.equal(await page.locator('#giftfriendcode').isVisible(),true);
    await page.locator('[data-act="closegift"]').click();
    for(const size of [{width:320,height:568},{width:375,height:667},{width:1280,height:900}]){
      await page.setViewportSize(size);
      for(const view of ['settings','library','goals','apps']){
        if(size.width<=760)await navigate(view);
        else{
          if(['settings','apps'].includes(view)){
            if(!await page.locator('[data-act="nav"][data-view="'+view+'"]').isVisible())await page.locator('[data-act="usermenu"]').click();
          }
          await page.locator(['library','goals'].includes(view)?'[data-act="open-'+view+'"]':'[data-act="nav"][data-view="'+view+'"]').click();
        }
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,view+' fits '+size.width+'px');
      }
    }
    assert.deepEqual(errors,[]);
    await page.evaluate(()=>window.LingonAuth.set(null));
    await page.waitForFunction(()=>window.__nativeCalls.some(x=>x.method==='lock'));
    const count=calls.filter(x=>x.path.startsWith('/api/apple')).length;
    await page.waitForTimeout(1700);
    assert.equal(calls.filter(x=>x.path.startsWith('/api/apple')).length,count,'sign out stops device polling');
    const signedOut=await browser.newContext({viewport:{width:393,height:852}});
    await signedOut.addInitScript(()=>{window.BelnaNative={platform:'ios',request:async body=>body.method==='signIn'?{identityToken:'isolated-apple-fixture',authorizationCode:'fixture'}:{}};});
    await signedOut.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/auth/apple'?{access_token:'apple-onboarding-fixture',user:{id:userId,email:'new@example.invalid'}}:{}}));
    const welcome=await signedOut.newPage();await welcome.goto('http://127.0.0.1:'+server.address().port+'/');
    await welcome.getByRole('heading',{name:'Welcome to Belna'}).waitFor();
    if(evidence){await welcome.waitForFunction(()=>document.querySelector('.authpage').getAnimations().every(animation=>animation.playState!=='running'));await welcome.screenshot({path:path.join(evidence,'mobile-welcome.png')});}
    assert.equal(await welcome.locator('[data-act="apple-signin"]').isVisible(),true);
    assert.equal(await welcome.locator('[data-act="back-home"]').count(),0,'native welcome does not send users to the website');
    assert.equal(await welcome.locator('#lprompt').count(),0);
    await welcome.locator('#authlegal').check();
    await welcome.locator('[data-act="apple-signin"]').click();
    await welcome.locator('[data-onboarding-name]').waitFor();
    await welcome.locator('[data-o="Rosa"]').click();
    await welcome.locator('[data-o="Orchid"]').click();
    await welcome.waitForFunction(()=>JSON.parse(localStorage.getItem('lingon.v1')).onboarded===true);
    assert.equal(await welcome.locator('[data-onboarding-name]').count(),0);
    await welcome.reload();await welcome.locator('#app').waitFor();
    assert.equal(await welcome.locator('[data-onboarding-name]').count(),0,'completed native onboarding does not restart on launch');
    console.log('Native web UI: native welcome and chat startup, individual Apple cards and filtering, mobile pages, compact cached invite, authenticated polling, result retry without duplicate actions, and logout lock passed');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
