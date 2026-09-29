const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch();
 try{for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:1000}});
  await context.addInitScript(()=>{
   window.WhopElements=()=>({wallet:{create:()=>({create:kind=>kind==='cards'?{create:()=>({mount:selector=>{document.querySelector(selector).innerHTML='<p>Whop card verification</p>';},destroy:()=>{}}),destroy:()=>{}}:{mount:selector=>{document.querySelector(selector).innerHTML='<p>Secure bank connection · review fees and confirm</p>';},destroy:()=>{}},destroy:()=>{}})}});
   localStorage.setItem('lingon.session',JSON.stringify({access_token:'ui-audit',user:{id:'ui-audit',email:'audit@example.invalid'}}));
   if(!localStorage.getItem('lingon.v1'))localStorage.setItem('lingon.v1',JSON.stringify({ownerId:'ui-audit',onboarded:true,agent:{name:'Audit',color:'lingon',pers:'Precise'},view:'chat',activeChat:'wallet-chat',chats:[{id:'wallet-chat',title:'Wallet setup',messages:[],at:Date.now()}],canvasTab:'payments',vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
  });
  const requests=[],wallet={configured:true,status:'not_created',cardProgramAvailable:true,card:null,balance:null};let addresses=[],prefs={activeMethod:null,merchantEnabled:false},identityApproved=false,cardApplicationState=null;
  await context.route('**/api/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname,body=req.postData()?JSON.parse(req.postData()):{};let result={};
   if(req.method()==='POST')requests.push({path,body});
   if(path==='/api/wallet-preferences'){if(req.method()==='POST')prefs={...prefs,...body};result=prefs;}
   else if(path==='/api/wallet-history')result={history:[{title:'Amazon',amount:29,currency:'USD',status:'awaiting_confirmation'}]};
   else if(path==='/api/belna-wallet'){if(identityApproved&&!wallet.cardReady)Object.assign(wallet,{status:cardApplicationState==='unavailable'?'card_unavailable':['needs_verification','needs_information'].includes(cardApplicationState)?'card_action_required':['pending','manual_review','approved'].includes(cardApplicationState)?'review':['denied','locked','canceled'].includes(cardApplicationState)?'denied':'card_required',cardApplicationStatus:cardApplicationState,identityVerified:true,verificationStatus:'approved'});result={wallet,activity:[{title:'Deposit',amount:12.5,status:'recorded'}]};}
   else if(path==='/api/shop-pay')result={shopPay:{configured:true,connected:false},orders:[]};
   else if(path==='/api/belna-wallet/setup'){Object.assign(wallet,{status:'verification_required',identityVerified:false,verificationStatus:'pending',cardReady:false,balance:{available:12.5,pending:3},agentCardPayments:false,dailyCardLimitUsd:50,paused:false});result={wallet,activity:[]};}
   else if(path==='/api/belna-wallet/card-connect'){Object.assign(wallet,{status:'ready',cardReady:true});result={wallet,activity:[]};}
   else if(path==='/api/belna-wallet/card-session')result={accountId:'biz_test',accessToken:'owner-card-verification-token',expiresAt:new Date(Date.now()+15*60000).toISOString()};
   else if(path==='/api/belna-wallet/controls'){if(body.dailyLimitUsd!=null)wallet.dailyCardLimitUsd=body.dailyLimitUsd;if(typeof body.frozen==='boolean')wallet.paused=body.frozen;result={wallet,activity:[]};}
   else if(path==='/api/belna-wallet/quote')result={quoteId:'test-transfer',recipient:body.recipient,amount:body.amount,fees:'Partner fees may apply.'};
   else if(path==='/api/belna-wallet/send')result={status:'succeeded'};
   else if(path==='/api/belna-wallet/receive')result={url:'https://whop.com/checkout/test',amount:body.amount};
   else if(path==='/api/belna-wallet/withdraw-session')result={accountId:'biz_test',accessToken:'owner-only-ui-token',expiresAt:new Date(Date.now()+15*60000).toISOString()};
   else if(path.startsWith('/api/shipping-addresses')){
    if(path.endsWith('/save')){const a={...body,id:body.id||crypto.randomUUID(),isDefault:body.isDefault||!addresses.length};a.formatted=[a.recipient,a.line1,a.line2,[a.postalCode,a.city].join(' '),a.region,a.country].filter(Boolean).join(', ');if(a.isDefault)addresses=addresses.map(x=>({...x,isDefault:false}));addresses=[...addresses.filter(x=>x.id!==a.id),a];}
    if(path.endsWith('/delete')){addresses=addresses.filter(x=>x.id!==body.id);if(addresses.length&&!addresses.some(x=>x.isDefault))addresses[0].isDefault=true;}
    result={addresses};
   }
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const option=method=>page.locator(`.wpay-opt[data-option="${method || 'off'}"]`);
  await page.goto(process.env.UI_BASE||'http://127.0.0.1:8000/app');
  // No way to pay yet: the panel offers the same choice as Settings, with no switcher above it.
  await page.locator('[data-act="togglecanvas"]').first().click();await page.locator('[data-act="ctab"][data-t="payments"]').click();
  await page.locator('.wallet-panel .wpay').waitFor();assert.equal(await page.locator('.wallet-panel .wpay-opt').count(),3);
  assert.equal(await option('').getAttribute('class').then(c=>/\bon\b/.test(c)),true,'Off is selected while nothing is chosen');
  await page.locator('.wallet-panel .wpay-side [data-act="wallet-existing-options"]').click();await page.getByRole('button',{name:'Connect Shop Pay',exact:true}).waitFor();
  await page.getByRole('button',{name:'Turn on',exact:true}).click();await page.locator('.wl-head').getByText('Audit pays with a card you already use',{exact:true}).waitFor();
  assert.match(await page.locator('.wallet-panel').innerText(),/Amazon[\s\S]*Submitted/);
  // Delivery addresses live in Settings › Wallet.
  await page.locator('.wallet-panel [data-act="wallet-manage-shipping"]').click();await page.locator('#wallet-settings-content').waitFor();
  assert.equal(await page.locator('[data-act="stab"][data-t="wallet"]').count(),1);
  await page.getByRole('button',{name:'Add address',exact:true}).click();
  for(const [name,value] of Object.entries({label:'Home',recipient:'Ada Lovelace',line1:'Main Street 1',city:'Stockholm',postalCode:'11122'}))await page.locator('#wallet-address-'+name).fill(value);
  await page.locator('#wallet-address-country').selectOption('SE');await page.getByRole('button',{name:'Save address',exact:true}).click();
  await page.locator('.wallet-address').waitFor();assert.match(await page.locator('.wallet-address').innerText(),/Default/);
  await page.locator('[data-act="wallet-address-edit"]').click();await page.locator('#wallet-address-line1').fill('New Street 2');await page.getByRole('button',{name:'Save address',exact:true}).click();
  await page.getByText('Ada Lovelace, New Street 2, 11122 Stockholm, SE',{exact:true}).waitFor();
  // Belna Wallet set up in Settings does not replace the card already paying; the owner switches to it.
  await option('belna_wallet').locator('.wpay-side [data-act="wallet-connect-belna"]').click();await page.locator('#belna-wallet-country').selectOption('SE');
  await page.getByRole('button',{name:'Create wallet',exact:true}).click();await option('belna_wallet').locator('.wpay-main[data-act="wallet-switch"]').waitFor();
  assert.equal(await option('existing_card').getAttribute('class').then(c=>/\bon\b/.test(c)),true,'the card already paying stays active');
  await option('belna_wallet').locator('.wpay-main').click();await page.locator('.wpay-opt.on').filter({hasText:'Belna Wallet'}).waitFor();
  assert.deepEqual(requests.find(x=>x.path.endsWith('/setup')).body,{country:'SE'});
  assert.equal(await page.locator('[data-act="belna-wallet-verify"]').count(),1);
  identityApproved=true;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByText('Identity verified · connect card',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-act="belna-wallet-verify"]').count(),0,'returning from KYC refreshes Wallet settings and removes repeat verification');
  assert.equal(wallet.cardReady,false,'identity approval does not enable card spending');
  await page.getByRole('button',{name:'Back to chat',exact:true}).click();await page.locator('.wallet-panel [data-act="belna-wallet-card-connect"]').waitFor();
  assert.match(await page.locator('.wl-balance').innerText(),/Available\s+\$12\.50/);
  assert.match(await page.locator('.wl-head').innerText(),/Audit pays with Belna Wallet/);
  assert.deepEqual(await page.locator('.wl-act').allInnerTexts(),['Add money','Send','Get paid','Withdraw']);
  assert.equal(await page.locator('.wallet-panel [role="radiogroup"]').count(),0,'the Belna panel has no payment switcher');
  assert.equal(await page.locator('.wallet-panel').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  assert.equal(await page.locator('.wallet-panel').locator('.wallet-virtual-card,#belna-wallet-limit,#shoppaylimit').count(),0);
  assert.match(await page.locator('.wl-setup').innerText(),/2 of 3 done/);
  await page.locator('.wl-setup').getByText('Identity verified',{exact:true}).waitFor();
  assert.equal(await page.locator('.wl-setup [data-act="belna-wallet-verify"]').count(),0);
  await page.getByRole('button',{name:'Check status',exact:true}).click();
  await page.locator('.wl-setup').getByText('Identity verified',{exact:true}).waitFor();
  for(const [issuer,copy,canContinue] of [['needs_verification','Finish the card issuer’s verification',true],['needs_information','The card issuer needs more information',true],['pending','Your card application is in review',false],['denied','The issuer has not approved your card application',false],['unavailable','Whop could not file your card application',true]]){
    cardApplicationState=issuer;await page.getByRole('button',{name:'Check status',exact:true}).click();
    await page.locator('.wl-setup').getByText(copy,{exact:false}).waitFor();
    assert.equal(await page.locator('.wl-setup [data-act="belna-wallet-card-connect"]').count(),canContinue?1:0);
    assert.equal(await page.locator('.wl-setup').getByText('Identity verified',{exact:true}).count(),1,'issuer verification never resets wallet KYC');
    if(issuer==='needs_verification'){
      await page.getByRole('button',{name:'Continue card setup',exact:true}).click();
      await page.getByText('Whop card verification',{exact:true}).waitFor();
      assert.equal(requests.filter(x=>x.path==='/api/belna-wallet/card-session').length,1,'issuer verification gets an owner-scoped Whop session');
      await page.getByRole('button',{name:'Close card setup',exact:true}).click();
    }
  }
  await page.getByRole('button',{name:'Wallet settings',exact:true}).click();await page.getByText('Card application not filed · retry setup or contact card support',{exact:true}).waitFor();
  if(await page.getByRole('button',{name:'Back to chat',exact:true}).count())await page.getByRole('button',{name:'Back to chat',exact:true}).click();
  else {await page.getByRole('button',{name:'Back to Settings',exact:true}).click();await page.getByRole('button',{name:'Close settings',exact:true}).click();}
  cardApplicationState=null;await page.getByRole('button',{name:'Check status',exact:true}).click();
  await page.getByRole('button',{name:'Connect card',exact:true}).click();await page.getByText('Card payments are on',{exact:true}).waitFor();
  await page.locator('.wallet-panel').getByRole('button',{name:'Send',exact:true}).click();await page.locator('#belna-wallet-recipient').fill('friend@example.com');await page.locator('#belna-wallet-send-amount').fill('5');
  await page.getByRole('button',{name:'Review send',exact:true}).click();await page.getByRole('button',{name:'Confirm send',exact:true}).waitFor();assert.equal(requests.filter(x=>x.path.endsWith('/send')).length,0);
  await page.getByRole('button',{name:'Get paid',exact:true}).click();await page.locator('#belna-wallet-receive-title').fill('Design');await page.locator('#belna-wallet-receive-amount').fill('25');
  await page.getByRole('button',{name:'Create payment link',exact:true}).click();await page.getByRole('link',{name:'Open payment link'}).waitFor();
  await page.getByRole('button',{name:'Withdraw',exact:true}).click();await page.getByRole('dialog',{name:'Withdraw to your bank'}).waitFor();await page.getByText('Secure bank connection · review fees and confirm').waitFor();
  assert.equal(requests.filter(x=>x.path.endsWith('/withdraw-session')).length,1);assert.deepEqual(requests.find(x=>x.path.endsWith('/withdraw-session')).body,{});assert.ok(!(await page.evaluate(()=>JSON.stringify(localStorage))).includes('owner-only-ui-token'));
  await page.getByRole('button',{name:'Close bank withdrawal'}).click();await page.getByRole('dialog',{name:'Withdraw to your bank'}).waitFor({state:'detached'});
  // Settings: daily card allowance and pausing card spending.
  await page.getByRole('button',{name:'Wallet settings',exact:true}).click();
  await page.getByRole('button',{name:'Change',exact:true}).click();await page.locator('#belna-wallet-limit').fill('75');await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.locator('.wset-row').filter({hasText:'Daily card allowance'}).getByText('$75.00',{exact:true}).waitFor();
  assert.deepEqual(requests.filter(x=>x.path.endsWith('/controls')).at(-1).body,{dailyLimitUsd:75});
  await page.getByRole('switch',{name:'Pause card spending'}).click();await page.locator('[role="switch"][aria-label="Pause card spending"][aria-checked="true"]').waitFor();
  assert.deepEqual(requests.filter(x=>x.path.endsWith('/controls')).at(-1).body,{frozen:true});
  // Switching keeps every connection; it only changes how future purchases are paid.
  await page.locator('[data-act="wallet-switch"][data-method="existing_card"]').click();
  await page.locator('.wpay-opt.on').filter({hasText:'A card you already use'}).waitFor();assert.equal(await option('belna_wallet').evaluate(el=>el.classList.contains('on')),false);
  await page.reload();await page.locator('[data-act="wallet-switch"][data-method="belna_wallet"]').waitFor();await page.locator('[data-act="wallet-switch"][data-method="belna_wallet"]').click();
  await page.locator('.wpay-opt.on').filter({hasText:'Belna Wallet'}).waitFor();
  await page.getByRole('button',{name:'Back to chat',exact:true}).click();if(!await page.getByText('Available',{exact:true}).isVisible())await page.locator('[data-act="togglecanvas"]').first().click();await page.getByText('Available',{exact:true}).waitFor();assert.match(await page.locator('.wallet-panel').innerText(),/\$12\.50/);
  assert.match(await page.locator('.wallet-panel').innerText(),/Card spending is paused/);
  await page.getByRole('button',{name:'Wallet settings',exact:true}).click();await page.locator('[data-act="wallet-switch"][data-method=""]').click();await page.locator('.wpay-opt.on').filter({hasText:'Off'}).waitFor();
  await page.locator('[data-act="wallet-address-edit"]').click();await page.locator('.wallet-address-form [data-act="wallet-address-delete"]').click();await page.locator('.wallet-address').waitFor({state:'detached'});assert.deepEqual(errors,[]);await context.close();
 }
 console.log('Wallet UI: desktop/mobile Settings, persisted switching, inactive connections, history, balance, card setup, allowance, pausing, reviewed sends, payment links and shipping CRUD passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
