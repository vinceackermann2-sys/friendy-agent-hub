const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch();try{
  for(const scenario of ['callback','changed-owner','payment-request']){
   const context=await browser.newContext({viewport:{width:1280,height:1000}}),calls=[];
   await context.addInitScript(({scenario})=>{
    localStorage.setItem('lingon.session',JSON.stringify({access_token:'fixture',user:{id:'alice',email:'alice@example.test'}}));
    localStorage.setItem('lingon.v1',JSON.stringify({ownerId:'alice',onboarded:true,agent:{name:'Audit',color:'lingon',pers:'Precise'},view:'chat',activeChat:'wallet-chat',chats:[{id:'wallet-chat',title:'Wallet',messages:[],at:Date.now()}],canvasOpen:true,canvasTab:'payments',vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
    if(scenario!=='payment-request')sessionStorage.setItem('belna.whopConnect',JSON.stringify({owner:scenario==='changed-owner'?'bob':'alice',state:'a'.repeat(64)}));
   },{scenario});
   const snapshot={wallet:{kind:'personal',configured:true,status:'card_required',identityVerified:true,verificationStatus:'approved',cardReady:false,cardProgramAvailable:true,balance:{available:60,pending:0},dailyCardLimitUsd:50},activity:[]};
   await context.route('**/api/**',async route=>{
    const r=route.request(),path=new URL(r.url()).pathname,body=r.postData()?JSON.parse(r.postData()):null;calls.push({path,body,method:r.method()});let result={};
    if(path==='/api/belna-wallet' || path.endsWith('/oauth-finish'))result=snapshot;
    else if(path==='/api/wallet-preferences')result={selectionSaved:true,activeMethod:scenario==='payment-request'?'belna_wallet':null,merchantEnabled:false};
    else if(path.endsWith('/payment-request'))result={requestId:'personal-payment-request-001',title:'Design',amount:5,recipient:'bob@example.test'};
    else if(path.endsWith('/quote'))result={quoteId:'reviewed',amount:5,recipient:'bob@example.test',currency:'USD',fees:'Partner fees may apply.'};
    else if(path==='/api/shop-pay')result={shopPay:{configured:true,connected:false}};
    else if(path==='/api/shipping-addresses')result={addresses:[]};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
   });
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto((process.env.UI_BASE||'http://127.0.0.1:8000')+'/app'+(scenario==='payment-request'?'?wallet_request=personal-payment-request-001':'?state='+'a'.repeat(64)+'&code=fixture-oauth-code'));
   if(scenario==='callback'){
    await page.getByText('Your personal Whop wallet is connected. Set up your virtual card next.',{exact:true}).waitFor();
    assert.equal(calls.filter(c=>c.path.endsWith('/oauth-finish')).length,1);
    assert.ok(!new URL(page.url()).searchParams.has('code'));
    assert.equal(calls.filter(c=>c.path==='/api/wallet-preferences' && c.method==='POST').length,0,'saved Off choice survives connecting');
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('belna.whopCallback')),null);
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    assert.equal(calls.filter(c=>c.path.endsWith('/oauth-finish')).length,1,'callback completed once');
   }else if(scenario==='changed-owner'){
    await page.getByText('Personal wallet connection was canceled or the Belna account changed. Connect again.',{exact:true}).waitFor();
    assert.equal(calls.filter(c=>c.path.endsWith('/oauth-finish')).length,0,'callback cannot bind after switching Belna accounts');
   }else{
    await page.getByRole('button',{name:'Review payment',exact:true}).waitFor();
    assert.equal(calls.filter(c=>c.path.endsWith('/quote') || c.path.endsWith('/send')).length,0,'opening a payment request sends nothing');
    await page.getByRole('button',{name:'Review payment',exact:true}).click();await page.getByRole('button',{name:'Confirm send',exact:true}).waitFor();
    assert.deepEqual(calls.find(c=>c.path.endsWith('/quote')).body,{paymentRequestId:'personal-payment-request-001',amount:5});
    assert.equal(calls.filter(c=>c.path.endsWith('/send')).length,0,'payment still requires confirmation');
   }
   assert.equal(calls.filter(c=>c.path.endsWith('/card-connect')).length,0,'connecting wallet never silently issues a card');
   assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Personal wallet UI: OAuth callback, changed-owner rejection, preserved Off choice and explicit payment review passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
