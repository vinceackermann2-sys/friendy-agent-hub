const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch();
 try{for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:1000}});
  // Desktop Settings has "Back to chat"; on phones a section goes back to the list, which closes.
  const leaveSettings=async()=>{if(await page.getByRole('button',{name:'Back to chat',exact:true}).isVisible())return page.getByRole('button',{name:'Back to chat',exact:true}).click();await page.getByRole('button',{name:'Back to Settings',exact:true}).click();await page.getByRole('button',{name:'Close settings',exact:true}).click();};
  await context.addInitScript(()=>{
   window.walletElementCalls=[];
   window.WhopElements=()=>({verifications:{create:options=>{window.walletElementCalls.push({kind:'verification',verificationKind:options.kind,accountId:options.accountId});return {create:kind=>({mount:selector=>{document.querySelector(selector).innerHTML='<p>Whop personal identity verification</p>';},destroy:()=>{}}),destroy:()=>{}};}},wallet:{create:()=>({create:kind=>kind==='cards'?{create:()=>({mount:selector=>{document.querySelector(selector).innerHTML='<p>Whop card details</p>';},destroy:()=>{}}),destroy:()=>{}}:{mount:selector=>{document.querySelector(selector).innerHTML='<p>Secure bank connection · review fees and confirm</p>';},destroy:()=>{}},destroy:()=>{}})}});

   localStorage.setItem('lingon.session',JSON.stringify({access_token:'ui-audit',user:{id:'ui-audit',email:'audit@example.invalid'}}));
   if(!localStorage.getItem('lingon.v1'))localStorage.setItem('lingon.v1',JSON.stringify({ownerId:'ui-audit',onboarded:true,agent:{name:'Audit',color:'lingon',pers:'Precise'},view:'chat',activeChat:'wallet-chat',chats:[{id:'wallet-chat',title:'Wallet setup',messages:[],at:Date.now()}],canvasTab:'payments',vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
  });
  await context.route('https://whop.com/deposit/**',route=>route.fulfill({contentType:'text/html',body:'<p>Secure connected wallet deposit</p>'}));
  const requests=[],wallet={configured:true,status:'not_created',cardProgramAvailable:true,card:null,balance:null};let addresses=[],prefs={activeMethod:null,merchantEnabled:false,methods:{payment_apps:false,shop_pay:false,saved_card:false,belna_wallet:false}},identityApproved=false,cardApplicationState=null;
  await context.route('**/api/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname,body=(()=>{try{return req.postData()?JSON.parse(req.postData()):{};}catch{return {};}})();let result={};
   if(req.method()==='POST')requests.push({path,body});
   if(path==='/api/wallet-preferences'){if(req.method()==='POST'){const {methods,...rest}=body;prefs={...prefs,...rest,methods:{...prefs.methods,...(methods||{})}};prefs.methods.belna_wallet=prefs.activeMethod==='belna_wallet';prefs.merchantEnabled=prefs.methods.saved_card;}result=prefs;}
   else if(path==='/api/wallet-history')result={history:[{title:'Amazon',amount:29,currency:'USD',status:'awaiting_confirmation'}]};
   else if(path==='/api/belna-wallet'){if(identityApproved&&!wallet.cardReady)Object.assign(wallet,{status:cardApplicationState==='unavailable'?'card_unavailable':['needs_verification','needs_information'].includes(cardApplicationState)?'card_action_required':['pending','manual_review','approved'].includes(cardApplicationState)?'review':['denied','locked','canceled'].includes(cardApplicationState)?'denied':'card_required',cardApplicationStatus:cardApplicationState,identityVerified:true,verificationStatus:'approved'});result={wallet,activity:[{title:'Deposit',amount:12.5,status:'recorded'}]};}
   else if(path==='/api/shop-pay')result={shopPay:{configured:true,connected:false},orders:[]};
   else if(path==='/api/belna-wallet/setup'){Object.assign(wallet,{status:'verification_required',identityVerified:false,verificationStatus:'pending',cardReady:false,balance:{available:12.5,pending:3},agentCardPayments:false,dailyCardLimitUsd:50,paused:false});result={wallet,activity:[]};}
   else if(path==='/api/belna-wallet/card-connect'){Object.assign(wallet,{status:'ready',cardReady:true});result={wallet,activity:[]};}
   else if(path==='/api/belna-wallet/deposit')result={url:'https://whop.com/deposit/biz_owner'};
   else if(path==='/api/belna-wallet/deposit-session')result={accountId:'biz_test',expiresAt:new Date(Date.now()+15*60000).toISOString(),cardFundingAvailable:true};
   else if(path==='/api/belna-wallet/card-session')result={...(wallet.cardReady?{cardId:'icrd_test'}:{}),accountId:'biz_test',verificationKind:'individual',accessToken:'owner-card-verification-token',expiresAt:new Date(Date.now()+15*60000).toISOString()};
   else if(path==='/api/belna-wallet/controls'){if(body.dailyLimitUsd!=null)wallet.dailyCardLimitUsd=body.dailyLimitUsd;if(typeof body.frozen==='boolean')wallet.paused=body.frozen;result={wallet,activity:[]};}
   else if(path==='/api/belna-wallet/quote')result={quoteId:'test-transfer',recipient:body.recipient,amount:body.amount,fees:'Partner fees may apply.'};
   else if(path==='/api/belna-wallet/send')result={status:'succeeded'};
   else if(path==='/api/belna-wallet/withdraw-session')result={accountId:'biz_test',accessToken:'owner-only-ui-token'.repeat(3),availableBalance:12.5,pendingBalance:3,payoutCountry:'SE',expiresAt:new Date(Date.now()+15*60000).toISOString()};
   else if(path.startsWith('/api/shipping-addresses')){
    if(path.endsWith('/save')){const a={...body,id:body.id||crypto.randomUUID(),isDefault:body.isDefault||!addresses.length};a.formatted=[a.recipient,a.line1,a.line2,[a.postalCode,a.city].join(' '),a.region,a.country].filter(Boolean).join(', ');if(a.isDefault)addresses=addresses.map(x=>({...x,isDefault:false}));addresses=[...addresses.filter(x=>x.id!==a.id),a];}
    if(path.endsWith('/delete')){addresses=addresses.filter(x=>x.id!==body.id);if(addresses.length&&!addresses.some(x=>x.isDefault))addresses[0].isDefault=true;}
    result={addresses};
   }
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.UI_BASE||'http://127.0.0.1:8000/app');
  // Your own payment methods and delivery are in Settings › Wallet; each method is off until turned on.
  await page.locator('[data-act="togglecanvas"]').first().click();await page.locator('[data-act="ctab"][data-t="wallet"]').click();
  assert.equal(await page.locator('[data-act="ctab"][data-t="payments"]').count(),0,'no separate Payments tab');
  await page.getByRole('button',{name:'Wallet settings',exact:true}).click();await page.locator('#payment-connections').waitFor();
  for(const name of ['Payment apps and pay later','Cards saved in stores'])assert.equal(await page.locator('#payment-connections').getByRole('switch',{name,exact:true}).getAttribute('aria-checked'),'false',name+' starts off');
  await page.getByRole('button',{name:'Connect Shop Pay',exact:true}).waitFor();
  await page.getByRole('switch',{name:'Cards saved in stores',exact:true}).click();await page.locator('#payment-connections').locator('[role="switch"][aria-label="Cards saved in stores"][aria-checked="true"]').waitFor();await leaveSettings();
  await page.locator('.wallet-panel').getByRole('button',{name:/^Payment methods/}).filter({hasText:'Cards saved in stores on'}).waitFor();
  assert.match(await page.locator('.wallet-panel').getByRole('region',{name:'Wallet activity'}).innerText(),/Amazon[\s\S]*Submitted/,'own-method purchases show in Activity even before a Belna Wallet exists');
  await page.locator('.wallet-panel [data-act="payments-manage"]').click();await page.locator('#wallet-settings-content').waitFor();
  assert.equal(await page.locator('#wallet-settings-content').getByText('Amazon',{exact:true}).count(),0,'purchases are not listed in Settings');
  assert.ok(await page.locator('#wallet-settings-content').isVisible(),'wallet settings open from the delivery action');
  await page.getByRole('button',{name:'Add address',exact:true}).click();
  for(const [name,value] of Object.entries({label:'Home',recipient:'Ada Lovelace',line1:'Main Street 1',city:'Stockholm',postalCode:'11122'}))await page.locator('#wallet-address-'+name).fill(value);
  await page.locator('#wallet-address-country').selectOption('SE');await page.getByRole('button',{name:'Save address',exact:true}).click();
  await page.locator('.wallet-address').waitFor();assert.match(await page.locator('.wallet-address').innerText(),/Default/);
  await page.locator('[data-act="wallet-address-edit"]').click();await page.locator('#wallet-address-line1').fill('New Street 2');await page.getByRole('button',{name:'Save address',exact:true}).click();
  await page.getByText('Ada Lovelace, New Street 2, 11122 Stockholm, SE',{exact:true}).waitFor();
  // Belna Wallet set up in Settings leaves your own methods as they are.
  await page.locator('#belna-wallet-country').selectOption('SE');
  await page.getByRole('button',{name:'Create Belna Wallet',exact:true}).click();await page.getByText('Daily card allowance',{exact:true}).waitFor();
  assert.equal(prefs.methods.saved_card,true,'creating a wallet keeps your own methods');
  await page.getByRole('button',{name:'Use wallet',exact:true}).click();await page.getByText('Selected',{exact:true}).waitFor();
  assert.deepEqual(requests.find(x=>x.path.endsWith('/setup')).body,{country:'SE'});
  assert.equal(await page.locator('[data-act="belna-wallet-verify"]').count(),1);
  identityApproved=true;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByText('Identity verified · connect card',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-act="belna-wallet-verify"]').count(),0,'returning from KYC refreshes Wallet settings and removes repeat verification');
  assert.equal(wallet.cardReady,false,'identity approval does not enable card spending');
  await leaveSettings();await page.locator('[data-act="ctab"][data-t="wallet"]').click();await page.locator('.wallet-panel [data-act="belna-wallet-card-connect"]').waitFor();
  assert.match(await page.locator('.wl-balance').innerText(),/Total balance · Belna\s+\$15\.50/);
  assert.match(await page.locator('.wl-head').innerText(),/Belna Wallet/);
  assert.deepEqual(await page.locator('.wl-act').allInnerTexts(),['Add money','Send','Withdraw']);
  assert.equal(await page.locator('.wallet-panel [role="radiogroup"]').count(),0,'Wallet keeps Belna money separate from payment preferences');
  assert.equal(await page.locator('.wallet-panel').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  assert.equal(await page.locator('.wallet-panel').locator('.wallet-virtual-card,#belna-wallet-limit,#shoppaylimit').count(),0);
  assert.match(await page.locator('.wl-setup').innerText(),/2 of 3 done/);
  await page.locator('.wl-setup').getByText('Identity verified',{exact:true}).waitFor();
  assert.equal(await page.locator('.wl-setup [data-act="belna-wallet-verify"]').count(),0);
  await page.getByRole('button',{name:'Check status',exact:true}).click();
  await page.locator('.wl-setup').getByText('Identity verified',{exact:true}).waitFor();
  for(const [issuer,copy,canContinue] of [['needs_verification','Finish the card issuer’s verification',true],['needs_information','The card issuer needs more information',true],['pending','Your card application is in review',false],['approved','Your card application is approved',true],['denied','The issuer has not approved your card application',false],['unavailable','Your card application could not be filed',true]]){
    cardApplicationState=issuer;await page.getByRole('button',{name:'Check status',exact:true}).click();
    await page.locator('.wl-setup').getByText(copy,{exact:false}).waitFor();
    assert.equal(await page.locator('.wl-setup [data-act="belna-wallet-card-connect"]').count(),canContinue?1:0);
    if(issuer==='approved')await page.locator('.wl-setup').getByRole('button',{name:'Activate virtual card',exact:true}).waitFor();
    assert.equal(await page.locator('.wl-setup').getByText('Identity verified',{exact:true}).count(),1,'issuer verification never resets wallet KYC');
    if(issuer==='needs_verification'){
      await page.getByRole('button',{name:'Continue card setup',exact:true}).click();
      await page.getByText('Whop personal identity verification',{exact:true}).waitFor();
      assert.equal(requests.filter(x=>x.path==='/api/belna-wallet/card-session').length,1,'issuer verification gets an owner-scoped Whop session');
      await page.getByRole('button',{name:'Close card setup',exact:true}).click();
    }
  }
  await page.getByRole('button',{name:'Wallet settings',exact:true}).click();await page.getByText('Card application not filed · retry setup or contact card support',{exact:true}).waitFor();
  if(await page.getByRole('button',{name:'Back to chat',exact:true}).count())await page.getByRole('button',{name:'Back to chat',exact:true}).click();
  else {await leaveSettings();}
  cardApplicationState=null;await page.getByRole('button',{name:'Check status',exact:true}).click();
  await page.getByRole('button',{name:'Connect card',exact:true}).click();await page.getByText('Card payments are on',{exact:true}).waitFor();
  await page.locator('.wallet-panel').getByRole('button',{name:'Add money',exact:true}).click();await page.getByRole('dialog',{name:'Add money to Belna Wallet'}).waitFor();await page.getByText('Secure bank connection · review fees and confirm').waitFor();assert.equal(requests.filter(x=>x.path.endsWith('/deposit-session')).length,1);await page.getByRole('button',{name:'Close wallet action'}).click();
  await page.locator('.wallet-panel').getByRole('button',{name:'Send',exact:true}).click();await page.locator('#belna-wallet-recipient').fill('friend@example.com');await page.locator('#belna-wallet-send-amount').fill('5');
  await page.getByRole('button',{name:'Review send',exact:true}).click();await page.getByRole('button',{name:'Confirm send',exact:true}).waitFor();assert.equal(requests.filter(x=>x.path.endsWith('/send')).length,0);
  await page.getByRole('dialog',{name:'Send money',exact:true}).getByRole('button',{name:'Close wallet action'}).click();
  assert.equal(await page.getByRole('button',{name:'Get paid',exact:true}).count(),0);
  await page.getByRole('button',{name:'Withdraw',exact:true}).click();await page.getByRole('dialog',{name:'Withdraw to your bank'}).waitFor();await page.getByText('Secure bank connection · review fees and confirm').waitFor();
  assert.equal(requests.filter(x=>x.path.endsWith('/withdraw-session')).length,1);assert.deepEqual(requests.find(x=>x.path.endsWith('/withdraw-session')).body,{});assert.ok(!(await page.evaluate(()=>JSON.stringify(localStorage))).includes('owner-only-ui-token'));
  await page.getByRole('button',{name:'Close wallet action'}).click();await page.getByRole('dialog',{name:'Withdraw to your bank'}).waitFor({state:'detached'});
  // Settings: daily card allowance and pausing card spending.
  await page.getByRole('button',{name:'Wallet settings',exact:true}).click();
  await page.getByRole('button',{name:'View virtual card',exact:true}).click();await page.getByRole('dialog',{name:'Your virtual card'}).waitFor();await page.getByRole('button',{name:'Close card setup'}).click();
  await page.getByRole('button',{name:'Change',exact:true}).click();await page.locator('#belna-wallet-limit').fill('75');await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.locator('.wset-row').filter({hasText:'Daily card allowance'}).getByText('$75.00',{exact:true}).waitFor();
  assert.deepEqual(requests.filter(x=>x.path.endsWith('/controls')).at(-1).body,{dailyLimitUsd:75});
  await page.getByRole('switch',{name:'Pause card spending'}).click();await page.locator('[role="switch"][aria-label="Pause card spending"][aria-checked="true"]').waitFor();
  assert.deepEqual(requests.filter(x=>x.path.endsWith('/controls')).at(-1).body,{frozen:true});
  // Choosing Belna Wallet keeps your own methods; they are switched one by one and never spend the balance.
  assert.equal(prefs.activeMethod,'belna_wallet');
  await page.locator('#payment-connections').getByRole('switch',{name:'Payment apps and pay later',exact:true}).click();await page.locator('#payment-connections').locator('[role="switch"][aria-label="Payment apps and pay later"][aria-checked="true"]').waitFor();
  await page.reload();await page.locator('#payment-connections').locator('[role="switch"][aria-label="Payment apps and pay later"][aria-checked="true"]').waitFor();
  assert.equal(prefs.methods.saved_card,true);assert.equal(prefs.activeMethod,'belna_wallet');
  await leaveSettings();if(!await page.getByText('Total balance · Belna',{exact:true}).isVisible())await page.locator('[data-act="togglecanvas"]').first().click();await page.getByText('Total balance · Belna',{exact:true}).waitFor();assert.match(await page.locator('.wallet-panel').innerText(),/\$12\.50/);
  assert.match(await page.locator('.wallet-panel').innerText(),/Card spending is paused/);
  await page.getByRole('button',{name:'Wallet settings',exact:true}).click();
  for(const name of ['Payment apps and pay later','Cards saved in stores']){await page.locator('#payment-connections').getByRole('switch',{name,exact:true}).click();await page.locator('#payment-connections').locator(`[role="switch"][aria-label="${name}"][aria-checked="false"]`).waitFor();}
  assert.equal(await page.locator('#wallet-shipping-section').count(),1,'delivery can be managed while every method is off');
  await page.locator('[data-act="wallet-address-edit"]').click();await page.locator('.wallet-address-form [data-act="wallet-address-delete"]').click();await page.locator('.wallet-address').waitFor({state:'detached'});assert.deepEqual(errors,[]);await context.close();
 }
 console.log('Wallet UI: desktop/mobile Settings, own methods off until turned on and persisted, no Payments tab, history, balance, card setup, allowance, pausing, reviewed sends, removed payment links and shipping CRUD passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
