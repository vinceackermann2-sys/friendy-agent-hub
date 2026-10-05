const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const base=process.env.UI_BASE || 'http://127.0.0.1:8000';
// The optional source runs the same fixture through the actual Whop SDK. The
// default keeps regression checks offline. Neither variant calls a money API.
const sdk=process.env.WHOP_ELEMENTS_SDK_SOURCE?fs.readFileSync(process.env.WHOP_ELEMENTS_SDK_SOURCE,'utf8'):`
window.WhopElements=()=>({wallet:{create:group=>({create:(kind,options)=>{
 let frame,listener;return {mount:target=>{
  frame=document.createElement('iframe');frame.src='https://cdn.whop.com/elements/wallet/'+kind+'/';frame.style.cssText='width:100%;height:0;opacity:0;border:0';
  listener=e=>{if(e.origin!=='https://cdn.whop.com' || e.source!==frame.contentWindow)return;
   if(e.data.whop==='boot')frame.contentWindow.postMessage({whop:'init',controllerProps:group},e.origin);
   if(e.data.whop==='loading')frame.style.opacity='1';
   if(e.data.whop==='resize')frame.style.height=e.data.height+'px';
   if(e.data.whop==='ready')options.onReady?.();
   if(e.data.whop==='error')options.onError?.();
   if(e.data.whop==='event')options['on'+e.data.name[0].toUpperCase()+e.data.name.slice(1)]?.(e.data.payload);
  };window.addEventListener('message',listener);document.querySelector(target).append(frame);
 },destroy:()=>{frame?.remove();window.removeEventListener('message',listener);}};
},destroy:()=>{}})}});`;
const fixture=`<!doctype html><html><body style="margin:0;padding:16px;font:16px system-ui"><h2>Secure wallet form</h2><label>Amount <input aria-label="Amount" type="number"></label><button type="button">Continue</button><button type="button" id="add-card">Add card</button><p role="status">Waiting for your details</p><script>
const host=new URLSearchParams(location.hash.slice(1)).get('host') || '${base}';
window.addEventListener('message',e=>{if(e.origin!==host || e.source!==parent || e.data.whop!=='init')return;
 window.walletInit=e.data;parent.postMessage({whop:'loading'},host);parent.postMessage({whop:'resize',height:420},host);
 document.querySelector('button').onclick=()=>document.querySelector('[role=status]').textContent='Ready for review';
 document.querySelector('#add-card').onclick=()=>parent.postMessage({whop:'event',name:'addCardRequested',payload:{}},host);
 window.finishLoading=()=>parent.postMessage({whop:'ready'},host);
 window.failLoading=()=>parent.postMessage({whop:'error',message:'Fixture load failure'},host);
});parent.postMessage({whop:'boot'},host);
</script></body></html>`;
(async()=>{
 const browser=await chromium.launch();try{for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900}});await context.addInitScript(()=>{
   localStorage.setItem('lingon.session',JSON.stringify({access_token:'fixture',user:{id:'embed-owner',email:'owner@example.invalid'}}));
   localStorage.setItem('lingon.v1',JSON.stringify({ownerId:'embed-owner',onboarded:true,agent:{name:'Audit',color:'lingon',pers:'Precise'},view:'chat',activeChat:'wallet',chats:[{id:'wallet',title:'Wallet',messages:[],at:Date.now()}],canvasOpen:true,canvasTab:'wallet',vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
  });
  let scriptAttempts=0;const moneyCalls=[];
  await context.route('https://cdn.whop.com/elements/amber/elements.js',route=>++scriptAttempts===1?route.abort('failed'):route.fulfill({contentType:'application/javascript',body:sdk}));
  await context.route('https://cdn.whop.com/elements/**',route=>new URL(route.request().url()).pathname.includes('/wallet/')?route.fulfill({contentType:'text/html',body:fixture}):route.fallback());
  await context.route('https://whop.com/deposit/**',route=>route.fulfill({contentType:'text/html',body:'<h2>Secure card funding</h2><label>Amount<input type="number" aria-label="Amount"></label><button onclick="document.querySelector(\'p\').textContent=\'Card amount ready for review\'">Continue</button><p>Enter amount</p>'}));
  await context.route('**/api/**',route=>{
   const name=new URL(route.request().url()).pathname;let result={};
   if(name==='/api/belna-wallet')result={wallet:{kind:'connected',configured:true,status:'ready',cardProgramAvailable:false,withdrawalsAvailable:true,balance:{available:125,pending:25}},activity:[],balanceHistory:[]};
   else if(name==='/api/wallet-preferences')result={activeMethod:'belna_wallet',selectionSaved:true,merchantEnabled:false};
   else if(name==='/api/shipping-addresses')result={addresses:[]};
   else if(name==='/api/shop-pay')result={shopPay:{configured:true,connected:false}};
   else if(name.endsWith('/deposit-session'))result={accountId:'biz_embed',expiresAt:new Date(Date.now()+15*60000).toISOString(),cardFundingAvailable:true};
   else if(name.endsWith('/withdraw-session'))result={accountId:'biz_embed',expiresAt:new Date(Date.now()+15*60000).toISOString(),accessToken:'private-embed-token'.repeat(3),availableBalance:125,pendingBalance:25,payoutCountry:'SE'};
   else if(/\/(send|deposit|receive)$/.test(name)){moneyCalls.push(name);if(name.endsWith('/deposit'))result={url:'https://whop.com/deposit/biz_embed/'};}
   return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/app');
  const panel=page.locator('.wallet-panel');if(!await panel.isVisible())await page.locator('[data-act="togglecanvas"]:visible').first().click();await page.locator('[data-act="ctab"][data-t="wallet"]:visible').click();
  await panel.getByRole('button',{name:'Add money',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Add money to Belna Wallet',exact:true});
  await dialog.getByText('The secure bank connection could not load. Please try again.',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Try again',exact:true}).click();
  for(const action of ['deposit','withdraw']){
   if(action==='withdraw'){await dialog.getByRole('button',{name:'Close wallet action'}).click();await panel.getByRole('button',{name:'Withdraw',exact:true}).click();dialog=page.getByRole('dialog',{name:'Withdraw to your bank',exact:true});}
   const frameLocator=dialog.frameLocator('iframe');await frameLocator.getByRole('heading',{name:'Secure wallet form'}).waitFor();
   const frame=page.frames().find(f=>f.url().includes('/wallet/'+action+'/'));await frame.waitForFunction(()=>typeof window.finishLoading==='function');
   assert.match(await dialog.locator('.wallet-withdraw-status').innerText(),/Opening/,'mounting an iframe does not claim it is ready');
   const box=await dialog.locator('iframe').boundingBox();assert.ok(box && box.width>250 && box.height>=320 && box.x>=0 && box.x+box.width<=width,'iframe has usable dimensions on desktop and phone');
   await frame.evaluate(()=>window.finishLoading());await dialog.getByText('Review and confirm in the secure form. Your agent cannot access your bank details.',{exact:true}).waitFor();
   await frameLocator.getByRole('spinbutton',{name:'Amount',exact:true}).fill('5');await frameLocator.getByRole('button',{name:'Continue',exact:true}).click();await frameLocator.getByText('Ready for review',{exact:true}).waitFor();
   fs.mkdirSync(path.resolve('artifacts/wallet-choice'),{recursive:true});await page.screenshot({path:path.resolve('artifacts/wallet-choice/embed-'+action+'-'+width+'.png')});
   if(action==='deposit'){
    await page.clock.install();await frame.evaluate(()=>window.failLoading());await dialog.getByRole('button',{name:'Try again',exact:true}).click();
    await dialog.frameLocator('iframe').getByRole('heading',{name:'Secure wallet form'}).waitFor();await page.clock.fastForward(20001);
    await dialog.getByText('Your secure form is taking too long to load. Check your connection and try again.',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Try again',exact:true}).click();
    await dialog.frameLocator('iframe').getByRole('heading',{name:'Secure wallet form'}).waitFor();assert.equal(await dialog.locator('iframe').count(),1,'retry destroys the previous frame');
    await dialog.frameLocator('iframe').getByRole('button',{name:'Add card',exact:true}).click();
    const funding=dialog.frameLocator('iframe[title="Secure card funding"]');await funding.getByRole('heading',{name:'Secure card funding',exact:true}).waitFor();
    await funding.getByRole('spinbutton',{name:'Amount'}).fill('5');await funding.getByRole('button',{name:'Continue',exact:true}).click();await funding.getByText('Card amount ready for review',{exact:true}).waitFor();
    assert.equal(page.url(),base+'/app','SDK card event opens funding in the existing dialog');
    assert.equal(await dialog.locator('iframe').getAttribute('src'),'https://whop.com/deposit/biz_embed/');
    const cardBox=await dialog.locator('iframe').boundingBox();assert.ok(cardBox && cardBox.width>250 && cardBox.height>=320 && cardBox.x>=0 && cardBox.x+cardBox.width<=width,'hosted card frame fits phone and desktop');
    await page.screenshot({path:path.resolve('artifacts/wallet-choice/embed-card-'+width+'.png')});
    await dialog.getByRole('button',{name:'Back to funding methods',exact:true}).click();await dialog.frameLocator('iframe').getByRole('heading',{name:'Secure wallet form'}).waitFor();
   }
  }
  await dialog.getByRole('button',{name:'Close wallet action'}).focus();await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await panel.isVisible(),true,'Escape closes the popup and preserves the wallet panel');
  assert.equal(scriptAttempts,2,'script download can retry');assert.deepEqual(moneyCalls,['/api/belna-wallet/deposit'],'funding opens once; fixtures never send money');assert.deepEqual(errors,[]);assert.ok(!/private-embed-token/.test(await page.evaluate(()=>JSON.stringify([localStorage,sessionStorage]))));await context.close();
 }
 console.log('Wallet iframes: desktop/mobile SDK loading and retry, visible interactive frames, readiness, stalled-frame recovery, cleanup and private tokens passed'+(process.env.WHOP_ELEMENTS_SDK_SOURCE?' (actual Whop SDK)':''));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
