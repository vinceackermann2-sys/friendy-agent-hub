const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch();
 try{for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:1000}});
  await context.addInitScript(()=>{
   window.WhopElements=()=>({wallet:{create:()=>({create:()=>({mount:selector=>{document.querySelector(selector).innerHTML='<p>Secure bank connection · review fees and confirm</p>';},destroy:()=>{}}),destroy:()=>{}})}});
   localStorage.setItem('lingon.session',JSON.stringify({access_token:'ui-audit',user:{id:'ui-audit',email:'audit@example.invalid'}}));
   if(!localStorage.getItem('lingon.v1'))localStorage.setItem('lingon.v1',JSON.stringify({ownerId:'ui-audit',onboarded:true,agent:{name:'Audit',color:'lingon',pers:'Precise'},view:'chat',activeChat:'wallet-chat',chats:[{id:'wallet-chat',title:'Wallet setup',messages:[],at:Date.now()}],canvasTab:'payments',vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
  });
  const requests=[],wallet={configured:true,status:'not_created',cardProgramAvailable:true,card:null,balance:null};let addresses=[],prefs={activeMethod:null,merchantEnabled:false};
  await context.route('**/api/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname,body=req.postData()?JSON.parse(req.postData()):{};let result={};
   if(req.method()==='POST')requests.push({path,body});
   if(path==='/api/wallet-preferences'){if(req.method()==='POST')prefs={...prefs,...body};result=prefs;}
   else if(path==='/api/wallet-history')result={history:[{title:'Amazon',amount:29,currency:'USD',status:'awaiting_confirmation'}]};
   else if(path==='/api/belna-wallet')result={wallet,activity:[{title:'Deposit',amount:12.5,status:'recorded'}]};
   else if(path==='/api/shop-pay')result={shopPay:{configured:true,connected:false},orders:[]};
   else if(path==='/api/belna-wallet/setup'){Object.assign(wallet,{status:'verification_required',cardReady:false,balance:{available:12.5,pending:3},agentCardPayments:false});result={wallet,activity:[]};}
   else if(path==='/api/belna-wallet/card-connect'){Object.assign(wallet,{status:'ready',cardReady:true});result={wallet,activity:[]};}
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
  await page.goto(process.env.UI_BASE||'http://127.0.0.1:8000/app');
  await page.locator('[data-act="togglecanvas"]').first().click();await page.locator('[data-act="ctab"][data-t="payments"]').click();
  await page.locator('.wallet-panel [data-act="wallet-existing-options"]').waitFor();assert.equal(await page.locator('.wallet-panel .wallet-choice-card').count(),2);
  await page.locator('.wallet-panel [data-act="wallet-existing-options"]').click();await page.getByRole('button',{name:'Connect Shop Pay',exact:true}).waitFor();
  await page.getByRole('button',{name:'Connect logged-in payments',exact:true}).click();await page.locator('.wallet-active-heading').getByText('Existing card',{exact:true}).waitFor();
  assert.match(await page.locator('.wallet-panel').innerText(),/Amazon/);
  await page.getByRole('button',{name:'Manage shipping addresses',exact:true}).click();await page.locator('#wallet-settings-content').waitFor();
  assert.equal(await page.locator('[data-act="stab"][data-t="wallet"]').count(),1);
  await page.getByRole('button',{name:'Add shipping address',exact:false}).click();
  for(const [name,value] of Object.entries({label:'Home',recipient:'Ada Lovelace',line1:'Main Street 1',city:'Stockholm',postalCode:'11122'}))await page.locator('#wallet-address-'+name).fill(value);
  await page.locator('#wallet-address-country').selectOption('SE');await page.getByRole('button',{name:'Save address',exact:true}).click();
  await page.locator('.wallet-address').waitFor();assert.match(await page.locator('.wallet-address').innerText(),/Default/);
  await page.locator('[data-act="wallet-address-edit"]').click();await page.locator('#wallet-address-line1').fill('New Street 2');await page.getByRole('button',{name:'Save address',exact:true}).click();
  await page.getByText('Ada Lovelace, New Street 2, 11122 Stockholm, SE',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Connect Belna Wallet',exact:true}).click();await page.locator('#belna-wallet-country').selectOption('SE');
  await page.getByRole('button',{name:'Create wallet',exact:true}).click();await page.locator('.wallet-choice-card').filter({hasText:'Belna Wallet'}).getByText('Active',{exact:true}).waitFor();
  assert.deepEqual(requests.find(x=>x.path.endsWith('/setup')).body,{country:'SE'});
  await page.getByRole('button',{name:'Back to chat',exact:true}).click();await page.locator('.wallet-panel [data-act="belna-wallet-card-connect"]').waitFor();
  assert.match(await page.locator('.wallet-account-card').innerText(),/Available balance\s+\$12\.50/);
  assert.equal(await page.locator('.wallet-money-action').count(),4);
  assert.equal(await page.locator('.wallet-panel').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  assert.equal(await page.locator('.wallet-virtual-card,#belna-wallet-limit,#shoppaylimit').count(),0);
  await page.getByRole('button',{name:'Connect card',exact:true}).click();await page.getByText('Card connection approved',{exact:true}).waitFor();
  await page.locator('.wallet-panel').getByRole('button',{name:'Send',exact:true}).click();await page.locator('#belna-wallet-recipient').fill('friend@example.com');await page.locator('#belna-wallet-send-amount').fill('5');
  await page.getByRole('button',{name:'Review send',exact:true}).click();await page.getByRole('button',{name:'Confirm send',exact:true}).waitFor();assert.equal(requests.filter(x=>x.path.endsWith('/send')).length,0);
  await page.getByRole('button',{name:'Earn',exact:true}).click();await page.locator('#belna-wallet-receive-title').fill('Design');await page.locator('#belna-wallet-receive-amount').fill('25');
  await page.getByRole('button',{name:'Create payment link',exact:true}).click();await page.getByRole('link',{name:'Open payment link'}).waitFor();
  await page.getByRole('button',{name:'Withdraw',exact:true}).click();await page.getByRole('dialog',{name:'Withdraw to your bank'}).waitFor();await page.getByText('Secure bank connection · review fees and confirm').waitFor();
  assert.equal(requests.filter(x=>x.path.endsWith('/withdraw-session')).length,1);assert.deepEqual(requests.find(x=>x.path.endsWith('/withdraw-session')).body,{});assert.ok(!(await page.evaluate(()=>JSON.stringify(localStorage))).includes('owner-only-ui-token'));
  await page.getByRole('button',{name:'Close bank withdrawal'}).click();await page.getByRole('dialog',{name:'Withdraw to your bank'}).waitFor({state:'detached'});
  await page.getByRole('button',{name:'Wallet settings',exact:true}).click();await page.locator('[data-act="wallet-switch"][data-method="existing_card"]').click();
  await page.locator('.wallet-choice-card').filter({hasText:'Existing card'}).getByText('Active',{exact:true}).waitFor();assert.match(await page.locator('.wallet-choice-card').filter({hasText:'Belna Wallet'}).innerText(),/Inactive/);
  await page.reload();await page.locator('[data-act="wallet-switch"][data-method="belna_wallet"]').waitFor();await page.locator('[data-act="wallet-switch"][data-method="belna_wallet"]').click();
  await page.locator('.wallet-choice-card').filter({hasText:'Belna Wallet'}).getByText('Active',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Back to chat',exact:true}).click();if(!await page.getByText('Available balance',{exact:true}).isVisible())await page.locator('[data-act="togglecanvas"]').first().click();await page.getByText('Available balance',{exact:true}).waitFor();assert.match(await page.locator('.wallet-panel').innerText(),/\$12\.50/);
  await page.getByRole('button',{name:'Wallet settings',exact:true}).click();await page.getByRole('button',{name:'Deactivate',exact:true}).click();await page.locator('[data-act="wallet-switch"][data-method="belna_wallet"]').waitFor();
  await page.locator('[data-act="wallet-address-delete"]').click();await page.locator('.wallet-address').waitFor({state:'detached'});assert.deepEqual(errors,[]);await context.close();
 }
 console.log('Wallet UI: desktop/mobile Settings, persisted switching, inactive connections, history, balance, card connection, reviewed sends, payment links and shipping CRUD passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
