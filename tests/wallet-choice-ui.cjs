const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
const base=process.env.UI_BASE || 'http://127.0.0.1:8000';

(async()=>{
  const browser=await chromium.launch();
  try{for(const width of [1280,390]){
    const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
    const wallet={kind:'connected',configured:true,status:'verification_required',cardProgramAvailable:false,withdrawalsAvailable:false,cardReady:false,identityVerified:false,verificationStatus:'pending',balance:{available:125,pending:25},country:'SE'};
    let prefs={activeMethod:'belna_wallet',selectionSaved:true,merchantEnabled:true,methods:{...{payment_apps:false,shop_pay:false,saved_card:false,belna_wallet:false},saved_card:true,belna_wallet:true}};
    let shop={configured:true,connected:false,dailyLimitUsd:200};
    let waitlist={joined:false,joinedAt:null},interestAttempts=0;
    let history=[{at:new Date(Date.now()-4*86400000).toISOString(),total:20},{at:new Date(Date.now()-2*86400000).toISOString(),total:80},{at:new Date(Date.now()-86400000).toISOString(),total:65}];
    let connectAttempts=0,releaseConnect,rejectPreference=false;
    const pendingConnect=new Promise(resolve=>{releaseConnect=resolve;});
    const calls=[],secrets=[{id:'login-user',ref:'sec_user',name:'amazon.com username'},{id:'login-password',ref:'sec_password',name:'amazon.com password'}];
    await context.addInitScript(()=>{
      localStorage.setItem('lingon.session',JSON.stringify({access_token:'wallet-choice-fixture',user:{id:'wallet-choice-owner',email:'owner@example.invalid'}}));
      if(!localStorage.getItem('lingon.v1'))localStorage.setItem('lingon.v1',JSON.stringify({ownerId:'wallet-choice-owner',onboarded:true,agent:{name:'Audit',color:'lingon',pers:'Precise'},view:'chat',activeChat:'wallet',chats:[{id:'wallet',title:'Wallet',messages:[],at:Date.now()}],canvasTab:'payments',vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
    });
    await context.route('**/api/**',async route=>{
      const req=route.request(),pathname=new URL(req.url()).pathname,body=req.postData()?JSON.parse(req.postData()):{};
      calls.push({path:pathname,method:req.method(),body});let result={};
      if(pathname==='/api/belna-wallet')result={wallet,balanceHistory:history,activity:[{title:'Deposit',amount:125,status:'completed'}]};
      else if(pathname==='/api/belna-wallet/card-waitlist'){if(req.method()==='POST'){interestAttempts++;if(interestAttempts===1)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Your interest could not be saved. Please try again.'})});waitlist={joined:true,joinedAt:new Date().toISOString()};}result={cardWaitlist:waitlist};}
      else if(pathname==='/api/wallet-preferences'){if(req.method()==='POST'){if(rejectPreference){rejectPreference=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Wallet choice could not be saved. Try again.'})});}{const {methods,...rest}=body;prefs={...prefs,...rest,methods:{...prefs.methods,...(methods||{})}};prefs.merchantEnabled=prefs.methods.saved_card;}}result=prefs;}
      else if(pathname==='/api/secrets')result={encrypted:true,secrets};
      else if(pathname==='/api/shop-pay')result={shopPay:shop,orders:[]};
      else if(pathname==='/api/shop-pay/connect'){
        connectAttempts++;
        if(connectAttempts===1){await pendingConnect;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Shop Pay is temporarily unavailable. Try again.'})});}
        result={url:'https://accounts.shop.app/oauth/authorize?state=fixture'};
      }
      else if(pathname==='/api/shop-pay/limit'){shop={...shop,dailyLimitUsd:body.dailyLimitUsd};result={shopPay:shop};}
      else if(pathname==='/api/shop-pay/disconnect'){shop={...shop,connected:false};result={shopPay:shop};}
      else if(pathname==='/api/shipping-addresses')result={addresses:[]};
      else if(pathname==='/api/belna-wallet/verify'){Object.assign(wallet,{identityVerified:true,verificationStatus:'approved'});result={wallet};}
      else if(pathname==='/api/belna-wallet/quote')result={quoteId:'review-fixture',amount:body.amount,recipient:body.recipient,fees:'Partner fees may apply.'};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
    });
    await context.route('https://accounts.shop.app/**',route=>route.fulfill({contentType:'text/html',body:'<p>Shop sign-in fixture</p>'}));
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const leaveSettings=async()=>{if(await page.getByRole('button',{name:'Back to chat',exact:true}).isVisible())return page.getByRole('button',{name:'Back to chat',exact:true}).click();await page.getByRole('button',{name:'Back to Settings',exact:true}).click();await page.getByRole('button',{name:'Close settings',exact:true}).click();};
    const panel=page.locator('.wallet-panel');
    const ensurePanel=async()=>{await page.locator('[data-act="togglecanvas"]:visible').first().waitFor();if(!await page.locator('[data-act="ctab"][data-t="wallet"]').isVisible())await page.locator('[data-act="togglecanvas"]:visible').first().click();await page.locator('[data-act="ctab"][data-t="wallet"]:visible').click();await panel.locator('.wl-head').waitFor();};
    await page.goto(base+'/app');await ensurePanel();
    await panel.locator('.wl-balance').getByText('$150.00',{exact:true}).waitFor();
    assert.equal(await panel.getByRole('radio').count(),0,'wallet balance and existing payment preferences are independent');
    assert.equal(await page.locator('[data-act="ctab"][data-t="payments"]').count(),0,'no separate Payments tab');
    assert.match(await panel.getByRole('button',{name:/^Payment methods/}).innerText(),/never uses your balance/);
    assert.equal(prefs.activeMethod,'belna_wallet','opening Wallet does not change the saved preference');
    await ensurePanel();await panel.locator('.wl-balance').waitFor();
    await panel.locator('.wl-chart.positive').waitFor();
    assert.ok(!(await panel.locator('.wl-chart-line').getAttribute('d')).includes('NaN'));
    fs.mkdirSync(path.resolve(__dirname,'../artifacts/wallet-choice'),{recursive:true});
    await page.locator('#canvas').screenshot({path:path.resolve(__dirname,`../artifacts/wallet-choice/belna-interest-${width}.png`)});
    await panel.getByRole('button',{name:'Apply interest',exact:true}).click();
    await panel.getByRole('alert').filter({hasText:'Your interest could not be saved.'}).waitFor();
    await panel.getByRole('button',{name:'Apply interest',exact:true}).click();
    await panel.getByText('Registered',{exact:true}).waitFor();
    assert.equal(interestAttempts,2,'waitlist failure can retry and success is saved');
    await page.reload();await ensurePanel();await panel.getByText('Registered',{exact:true}).waitFor();
    assert.equal(await panel.getByRole('button',{name:'Apply interest',exact:true}).count(),0,'saved interest survives reload');
    assert.equal(calls.filter(c=>c.path.endsWith('/card-connect')).length,0,'registering interest never issues a card');
    assert.equal(await panel.getByRole('button',{name:'Withdraw',exact:true}).isDisabled(),true,'Withdraw is shown but greyed out while withdrawals are off');
    await panel.getByText('Bank withdrawals are currently unavailable.',{exact:true}).waitFor();
    assert.equal(await panel.locator('[data-act="belna-wallet-card-connect"],[data-act="wallet-view-card"]').count(),0);
    await panel.getByRole('button',{name:'Send',exact:true}).click();
    await page.locator('#belna-wallet-recipient').fill('friend@example.com');await page.locator('#belna-wallet-send-amount').fill('5');
    await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/belna-wallet'),page.evaluate(()=>window.dispatchEvent(new Event('focus')))]);
    assert.equal(await page.locator('#belna-wallet-send-amount').inputValue(),'5','refresh preserves the payment draft');
    await page.getByRole('button',{name:'Review send',exact:true}).click();await page.getByRole('button',{name:'Confirm send',exact:true}).waitFor();
    assert.equal(calls.filter(c=>c.path.endsWith('/send')).length,0,'review never sends money');
    assert.equal(await page.locator('#belna-wallet-recipient').inputValue(),'friend@example.com');
    await page.getByRole('dialog',{name:'Send money',exact:true}).getByRole('button',{name:'Close wallet action'}).click();
    assert.equal(await panel.getByText('Identity verification',{exact:true}).count(),0,'wallet-only mode has no permanent identity block');
    await panel.getByRole('button',{name:'Wallet settings',exact:true}).click();
    const settings=page.locator('#wallet-settings-content');
    assert.equal(await settings.getByText('Identity verification',{exact:true}).count(),0);
    assert.equal(await settings.locator('.wpay').count(),0,'no payment preference picker: each method has its own switch');
    assert.equal(await settings.locator('#belna-wallet-limit,#shoppaylimit,[data-act="wallet-view-card"],[data-act="belna-wallet-card-connect"],[data-act="belna-wallet-freeze"]').count(),0,'without the card program, settings omit card controls');
    await settings.locator('#payment-connections').getByText('Shop Pay',{exact:true}).waitFor();
    await settings.locator('#wallet-shipping-section').waitFor();
    fs.mkdirSync(path.resolve(__dirname,'../artifacts/wallet-choice'),{recursive:true});
    await page.screenshot({path:path.resolve(__dirname,`../artifacts/wallet-choice/belna-settings-${width}.png`),fullPage:true});
    await leaveSettings();await ensurePanel();
    await panel.getByRole('button',{name:/^Payment methods/}).click();await settings.locator('#payment-connections').getByRole('button',{name:'Connect Shop Pay',exact:true}).waitFor();await settings.locator('#wallet-shipping-section').waitFor();
    // Store logins live in Settings › Secrets only, not in Wallet.
    assert.equal(await settings.getByText('amazon.com',{exact:true}).count(),0,'no store logins in Wallet');
    assert.ok(!(await settings.innerText()).includes('sec_password'),'Wallet never shows login secrets');
    assert.equal(await settings.getByText('Identity verification',{exact:true}).count(),0);
    await settings.getByRole('button',{name:'Connect Shop Pay',exact:true}).click();
    await settings.getByRole('button',{name:'Please wait…',exact:true}).waitFor();
    assert.equal(await settings.getByRole('button',{name:'Please wait…',exact:true}).isDisabled(),true);
    releaseConnect();await settings.getByRole('alert').filter({hasText:'Shop Pay is temporarily unavailable.'}).waitFor();
    assert.equal(connectAttempts,1,'connection cannot submit twice while pending');
    await settings.getByRole('button',{name:'Connect Shop Pay',exact:true}).click();
    await page.waitForURL('https://accounts.shop.app/**');
    shop={...shop,connected:true,email:'owner@example.invalid'};
    await page.goto(base+'/app?shop_pay=connected');await settings.locator('#payment-connections').waitFor();
    await settings.locator('[role="switch"][aria-label="Shop Pay"][aria-checked="true"]').waitFor();
    await settings.getByText('Connected as owner@example.invalid',{exact:true}).waitFor();
    assert.equal(prefs.methods.shop_pay,true,'connecting Shop Pay from its row turns it on');
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('belna.shopPayChoice')),null,'connection intent consumed on return');
    await settings.locator('#shoppaylimit').waitFor();
    await settings.locator('#shoppaylimit').fill('75');await settings.getByRole('button',{name:'Save limit',exact:true}).click();
    await page.getByText('Shop Pay daily limit saved.',{exact:true}).waitFor();assert.equal(shop.dailyLimitUsd,75);
    await page.locator('.page').evaluate(node=>{node.scrollTop=0;});
    await page.screenshot({path:path.resolve(__dirname,`../artifacts/wallet-choice/existing-settings-${width}.png`),fullPage:true});
    await leaveSettings();await ensurePanel();
    await panel.getByRole('button',{name:'Wallet settings',exact:true}).click();
    await settings.getByRole('switch',{name:'Cards saved in stores',exact:true}).click();
    await settings.locator('[role="switch"][aria-label="Cards saved in stores"][aria-checked="false"]').waitFor();
    await settings.getByRole('button',{name:'Disconnect',exact:true}).click();await settings.getByRole('button',{name:'Connect Shop Pay',exact:true}).waitFor();
    assert.equal(prefs.methods.shop_pay,false,'disconnecting Shop Pay turns it off');
    // A failed switch keeps the previous state; switches work from the keyboard.
    rejectPreference=true;await settings.getByRole('switch',{name:'Payment apps and pay later',exact:true}).click();
    await settings.getByRole('alert').filter({hasText:'Wallet choice could not be saved.'}).waitFor();
    assert.equal(await settings.getByRole('switch',{name:'Payment apps and pay later',exact:true}).getAttribute('aria-checked'),'false','a failed switch keeps the previous state');
    await settings.getByRole('switch',{name:'Payment apps and pay later',exact:true}).focus();await page.keyboard.press('Enter');
    await settings.locator('[role="switch"][aria-label="Payment apps and pay later"][aria-checked="true"]').waitFor();assert.equal(prefs.methods.payment_apps,true);
    await leaveSettings();await ensurePanel();await panel.locator('.wl-balance').waitFor();
    assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth),true,'panel fits on mobile and desktop');
    await page.locator('#canvas').screenshot({path:path.resolve(__dirname,`../artifacts/wallet-choice/belna-panel-${width}.png`)});
    Object.assign(wallet,{balance:{available:0,pending:0}});history=[{at:new Date().toISOString(),total:0}];
    await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/belna-wallet'),page.evaluate(()=>window.dispatchEvent(new Event('focus')))]);
    await panel.locator('.wl-balance').getByText('$0.00',{exact:true}).waitFor();
    assert.equal(await panel.locator('.wl-chart.positive').count(),0,'zero balance gets the neutral empty chart');
    await panel.getByText('Balance history starts today',{exact:true}).waitFor();
    await page.locator('#canvas').screenshot({path:path.resolve(__dirname,`../artifacts/wallet-choice/belna-empty-${width}.png`)});
    assert.deepEqual(errors,[]);await context.close();
  }
  for(const scenario of ['activate-choice','already-on','changed-owner','no-intent']){
    const context=await browser.newContext({viewport:{width:1280,height:1000}}),posts=[];
    let prefs={activeMethod:null,selectionSaved:true,merchantEnabled:false,methods:{...{payment_apps:false,shop_pay:false,saved_card:false,belna_wallet:false},shop_pay:scenario==='already-on'}};
    await context.addInitScript(scenario=>{
      localStorage.setItem('lingon.session',JSON.stringify({access_token:'fixture',user:{id:'alice',email:'alice@example.invalid'}}));
      localStorage.setItem('lingon.v1',JSON.stringify({ownerId:'alice',onboarded:true,agent:{name:'Audit',color:'lingon',pers:'Precise'},view:'settings',settingsTab:'wallet',activeChat:'wallet',chats:[{id:'wallet',title:'Wallet',messages:[],at:Date.now()}],canvasTab:'payments',vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
      if(scenario!=='no-intent')sessionStorage.setItem('belna.shopPayChoice',JSON.stringify({owner:scenario==='changed-owner'?'bob':'alice',activeMethod:null}));
    },scenario);
    await context.route('**/api/**',async route=>{
      const req=route.request(),pathname=new URL(req.url()).pathname;let result={};
      if(pathname==='/api/shop-pay')result={shopPay:{connected:true,configured:true,email:'alice@example.invalid'},orders:[]};
      else if(pathname==='/api/wallet-preferences'){if(req.method()==='POST'){const body=JSON.parse(req.postData());posts.push(body);{const {methods,...rest}=body;prefs={...prefs,...rest,methods:{...prefs.methods,...(methods||{})}};prefs.merchantEnabled=prefs.methods.saved_card;}}result=prefs;}
      else if(pathname==='/api/belna-wallet')result={wallet:{configured:true,kind:'connected',status:'ready',cardProgramAvailable:false,identityVerified:true,balance:{available:50,pending:0}}};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/app?shop_pay=connected');
    await page.getByText('Shop Pay connected. Purchases still need your approval.',{exact:true}).waitFor();
    await page.locator('#payment-connections').waitFor();
    assert.equal(prefs.methods.shop_pay,['activate-choice','already-on'].includes(scenario));
    assert.deepEqual(posts,scenario==='activate-choice'?[{methods:{shop_pay:true}}]:[],`${scenario}: callback respects ownership and the current switch`);
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Wallet choice: no Payments tab, per-method switches with retry and keyboard, clean sidebar, saved card waitlist, balance chart and empty state, desktop/mobile settings, drafts, private logins, Shop Pay retry/return/limits/disconnect, callback ownership and keyboard navigation passed');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
