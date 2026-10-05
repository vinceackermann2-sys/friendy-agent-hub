const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require('playwright');
const {startAppServer}=require('./helpers/app-server.cjs');
// The Wallet tab is Belna Wallet: balance, actions, activity, then the card interest. One
// Payment methods button, separate from the balance, opens the owner's own methods in
// Settings, where each method is off until turned on. There is no Payments tab.
(async()=>{
 const server=await startAppServer(),browser=await chromium.launch();
 try{for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:1050},reducedMotion:'reduce'}),calls=[],errors=[];
  // A Swish (payment app) order to approve and its QR code to scan, from a task that is waiting.
  const pending=[
   {id:'approve',kind:'card',at:Date.now(),card:{type:'approval',status:'pending',managedCallId:'call-1',taskId:'t1',tool:'browser_submit',title:'Place an order at lamps.example',view:{kind:'purchase',merchant:'lamps.example',items:[{title:'Lamp',quantity:1,price:'SEK 499.00'}],total:'SEK 499.00',payment:'Swish',phoneApproval:'Swish',delivery:['Ada, Main Street 1'],estimated:false}}},
   {id:'scan',kind:'card',at:Date.now(),card:{type:'auth_handoff',status:'pending',managedCallId:'call-2',taskId:'t1',liveId:'live_1',website:'https://lamps.example/checkout',method:'Swish',purpose:'payment'}},
  ];
  // A saved session from before still points at the Payments tab.
  await context.addInitScript(({pending})=>{
   localStorage.setItem('lingon.session',JSON.stringify({access_token:'fixture',user:{id:'separate-owner',email:'owner@example.invalid'}}));
   if(!localStorage.getItem('lingon.v1'))localStorage.setItem('lingon.v1',JSON.stringify({ownerId:'separate-owner',onboarded:true,agent:{name:'Audit',color:'lingon',pers:'Precise'},view:'chat',activeChat:'wallet',chats:[{id:'wallet',title:'Shopping',messages:pending,managedTasks:{t1:{status:'waiting_approval'}},at:Date.now()}],canvasOpen:true,canvasTab:'payments',settingsTab:'payments',vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
  },{pending});
  const wallet={kind:'connected',configured:true,status:'ready',cardProgramAvailable:false,withdrawalsAvailable:false,identityVerified:true,verificationStatus:'approved',cardReady:false,balance:{available:125,pending:25},country:'SE'};
  let methods={payment_apps:false,shop_pay:false,saved_card:false,belna_wallet:false},shop={configured:true,connected:false,dailyLimitUsd:200},addresses=[],rejectSave=false,waitlist=false;
  const prefs=()=>({activeMethod:null,selectionSaved:true,merchantEnabled:methods.saved_card,methods});
  await context.route('**/api/**',async route=>{
   const request=route.request(),pathname=new URL(request.url()).pathname,body=request.postData()?JSON.parse(request.postData()):{};
   calls.push({pathname,body,method:request.method()});let result={};
   const reject=message=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:message})});
   if(pathname==='/api/belna-wallet')result={wallet,balanceHistory:[],activity:[{title:'Deposit',amount:125,status:'completed'}]};
   else if(pathname==='/api/wallet-preferences'){if(request.method()==='POST'){if(rejectSave){rejectSave=false;return reject('Payment methods could not be saved. Try again.');}methods={...methods,...(body.methods||{})};}result=prefs();}
   else if(pathname==='/api/shop-pay')result={shopPay:shop,orders:[{title:'Unsafe order link',status:'needs_buyer',amount:10,currency:'USD',continueUrl:'https://user:password@malicious.example/checkout'}]};
   else if(pathname==='/api/shop-pay/connect')return reject('Shop Pay is temporarily unavailable. Try again.');
   else if(pathname==='/api/wallet-history')result={history:[{title:'Store purchase',amount:12,currency:'USD',status:'completed'}]};
   else if(pathname==='/api/belna-wallet/card-waitlist'){if(request.method()==='POST')waitlist=true;result={cardWaitlist:{joined:waitlist,joinedAt:waitlist?new Date().toISOString():null}};}
   else if(pathname.startsWith('/api/shipping-addresses')){
    if(pathname.endsWith('/save')){const value={...body,id:body.id || 'home',isDefault:true,formatted:[body.recipient,body.line1,body.postalCode,body.city,body.country].join(', ')};addresses=[value];}
    if(pathname.endsWith('/delete'))addresses=[];result={addresses};
   }
   await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(server.base+'/app');
  const panel=page.locator('#canvas');if(!await panel.isVisible())await page.locator('[data-act="togglecanvas"]:visible').first().click();
  // The old Payments tab opens Wallet, and there is no Payments tab any more.
  await panel.locator('.wl-balance').getByText('$150.00',{exact:true}).waitFor().catch(async e=>{console.log({width,errors,calls:calls.map(x=>x.pathname),panel:await panel.innerText()});throw e;});
  assert.equal(await panel.getByRole('tab',{name:'Wallet',exact:true}).getAttribute('aria-selected'),'true');
  assert.equal(await panel.getByRole('tab',{name:'Payments',exact:true}).count(),0,'no separate Payments tab');
  assert.match(await panel.locator('.wl-head').innerText(),/Belna Wallet/);

  // Belna Wallet first: balance, actions, activity, then the card interest, then Payment methods.
  const order=await panel.locator('.wallet-panel').evaluate(root=>['.wl-balance','.wl-acts','[aria-label="Wallet activity"]','[aria-label="Card and payment methods"]'].map(sel=>{const el=root.querySelector(sel);return el?[...root.querySelectorAll('*')].indexOf(el):-1;}));
  assert.ok(order.every((n,i)=>n>=0 && (i===0 || n>order[i-1])),'balance, actions, activity, then the card and Payment methods box: '+order);
  assert.equal(await panel.getByRole('switch').count(),0,'payment methods are not switched in the Wallet tab');
  assert.equal(await panel.getByText('Shop Pay',{exact:true}).count(),0);
  // Withdraw is always shown; it is greyed out while bank withdrawals are off.
  assert.equal(await panel.getByRole('button',{name:'Withdraw',exact:true}).isDisabled(),true);
  await panel.getByText('Bank withdrawals are currently unavailable.',{exact:true}).waitFor();
  // One Activity list: Belna money and purchases with your own methods, in the same rows.
  const activity=panel.getByRole('region',{name:'Wallet activity'});
  await activity.getByText('Deposit',{exact:true}).waitFor();await activity.getByText('Store purchase',{exact:true}).waitFor();
  assert.match(await activity.innerText(),/Store purchase\s+Your own payment method[\s\S]*−\$12\.00/);
  assert.equal(await activity.locator('.wl-row').count(),3,'deposit, own-method purchase and Shop Pay order share one list');
  assert.equal(await panel.locator('a[href*="malicious.example"]').count(),0,'credential-bearing checkout URLs are never offered');
  const more=panel.getByRole('region',{name:'Card and payment methods'});
  await more.getByText('Spend your balance with a card',{exact:true}).waitFor();await more.getByText('Coming soon',{exact:true}).waitFor();
  await more.getByRole('button',{name:'Apply interest',exact:true}).click();await panel.getByText('Registered',{exact:true}).waitFor();
  const link=panel.getByRole('button',{name:/^Payment methods/});
  assert.match(await link.innerText(),/never uses your balance/);
  assert.equal(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth),true,'Wallet fits without sideways scrolling');
  fs.mkdirSync(path.resolve('artifacts/wallet-payments'),{recursive:true});await panel.screenshot({path:path.resolve(`artifacts/wallet-payments/wallet-${width}.png`)});

  // Payment methods opens Settings › Wallet at your own methods: all off until turned on.
  await link.click();
  const settings=page.locator('#wallet-settings-content'),own=settings.locator('#payment-connections');await own.waitFor();
  assert.equal(await page.locator('[data-act="stab"][data-t="payments"]').count(),0,'no Payments tab in Settings');
  await page.waitForFunction(()=>{const r=document.querySelector('#payment-connections')?.getBoundingClientRect();return r && r.top>=-2 && r.top<window.innerHeight/2;});
  assert.deepEqual(await settings.getByRole('list',{name:'How payment methods work'}).getByRole('listitem').allInnerTexts(),['Never uses your Belna balance','You approve every purchase','Audit never sees card or bank details']);
  assert.equal(await settings.getByText('Store logins',{exact:true}).count(),0,'logins live in Secrets, not Wallet');
  await settings.getByText('Spend your balance with a card',{exact:true}).waitFor();
  assert.deepEqual(await own.getByRole('switch').evaluateAll(n=>n.map(x=>x.getAttribute('aria-label'))),['Cards saved in stores','Payment apps and pay later'],'two switches until Shop Pay is connected');
  for(const name of ['Payment apps and pay later','Cards saved in stores'])assert.equal(await own.getByRole('switch',{name,exact:true}).getAttribute('aria-checked'),'false',name+' starts off');
  await own.getByRole('switch',{name:'Payment apps and pay later',exact:true}).click();await own.locator('[role="switch"][aria-label="Payment apps and pay later"][aria-checked="true"]').waitFor();
  assert.deepEqual(calls.filter(x=>x.pathname==='/api/wallet-preferences' && x.method==='POST').at(-1).body,{methods:{payment_apps:true}});
  rejectSave=true;await own.getByRole('switch',{name:'Cards saved in stores',exact:true}).click();
  await own.getByRole('alert').filter({hasText:'Payment methods could not be saved'}).waitFor();assert.equal(methods.saved_card,false);
  await own.getByRole('button',{name:'Connect Shop Pay',exact:true}).click();await own.getByRole('alert').filter({hasText:'Shop Pay is temporarily unavailable'}).waitFor();
  assert.equal(await own.getByRole('switch',{name:'Shop Pay',exact:true}).count(),0,'Shop Pay cannot be turned on before it is connected');
  await own.getByRole('switch',{name:'Cards saved in stores',exact:true}).click();await own.locator('[role="switch"][aria-label="Cards saved in stores"][aria-checked="true"]').waitFor();
  assert.equal(await settings.getByText('Store purchase',{exact:true}).count(),0,'purchases are in Activity, not Settings');
  await settings.getByRole('button',{name:'Add address',exact:true}).click();
  for(const [name,value] of Object.entries({label:'Home',recipient:'Ada',line1:'Main Street 1',city:'Stockholm',postalCode:'11122'}))await page.locator('#wallet-address-'+name).fill(value);
  await page.getByRole('button',{name:'Save address',exact:true}).click();await page.locator('.wallet-address').waitFor();
  await own.scrollIntoViewIfNeeded();await page.screenshot({path:path.resolve(`artifacts/wallet-payments/settings-${width}.png`),fullPage:true});

  // Back in Wallet, the button says which methods are on.
  if(await page.getByRole('button',{name:'Back to chat',exact:true}).isVisible())await page.getByRole('button',{name:'Back to chat',exact:true}).click();else{await page.getByRole('button',{name:'Back to Settings',exact:true}).click();await page.getByRole('button',{name:'Close settings',exact:true}).click();}
  if(!await panel.isVisible())await page.locator('[data-act="togglecanvas"]:visible').first().click();
  await panel.getByRole('tab',{name:'Wallet',exact:true}).click();
  await panel.getByRole('button',{name:/^Payment methods/}).filter({hasText:'Cards saved in stores, Payment apps and pay later on'}).waitFor();

  // The order card in the chat says the payment is approved in Swish afterwards.
  await page.locator('.cv-pay').filter({hasText:'You approve the payment in Swish yourself'}).first().waitFor({state:'attached'});
  await page.getByRole('button',{name:'Show QR',exact:true}).first().waitFor({state:'attached'});
  assert.deepEqual(errors,[]);
  await context.close();
 }
 console.log('Wallet: Belna Wallet layout with activity then card interest, no Payments tab, Payment methods button separate from the balance into Settings, methods off until turned on, retry, one Activity list, disabled Withdraw, phone approval cards and secure links passed on desktop and mobile');
 }finally{await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
