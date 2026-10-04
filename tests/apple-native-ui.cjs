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
    const file=path.join(appDir,name);
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
      localStorage.setItem('lingon.v1',JSON.stringify({ownerId:userId,onboarded:true,agent:{name:'Belna',color:'lingon',pers:'Calm'},view:'apps',chats:[],vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
    },{userId});
    let delivered=false,completionAttempt=0;
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
      await route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
    });
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/app');
    await page.locator('[data-act="apple-apps"]').waitFor({timeout:15000});
    await page.locator('[data-act="apple-apps"]').click();
    await page.waitForFunction(()=>window.__nativeCalls.some(x=>x.method==='settings'));
    await page.waitForFunction(()=>window.__nativeCalls.some(x=>x.method==='execute'));
    for(let i=0;i<40 && completionAttempt<2;i++)await page.waitForTimeout(100);
    assert.equal(completionAttempt,2,'failed result delivery retries');
    assert.equal((await page.evaluate(()=>window.__nativeCalls.filter(x=>x.method==='execute'))).length,1,'delivery retry never repeats a native action');
    assert.equal(registrations.length,1);assert.equal(registrations[0].capabilities.calendar,true);
    assert.equal(calls.filter(x=>x.path.startsWith('/api/apple')).every(x=>x.authorization==='Bearer native-fixture'),true);
    assert.equal(JSON.stringify(registrations).includes('Actual device fixture'),false,'connecting sends capability metadata only');
    assert.deepEqual(errors,[]);
    await page.evaluate(()=>window.LingonAuth.set(null));
    await page.waitForFunction(()=>window.__nativeCalls.some(x=>x.method==='lock'));
    const count=calls.filter(x=>x.path.startsWith('/api/apple')).length;
    await page.waitForTimeout(1700);
    assert.equal(calls.filter(x=>x.path.startsWith('/api/apple')).length,count,'sign out stops device polling');
    console.log('Native web UI: phone connectors, bridge metadata, authenticated polling, cached completion retry, no duplicate native action and logout lock passed');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
