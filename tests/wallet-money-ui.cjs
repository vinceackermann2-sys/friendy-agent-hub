const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require('playwright');
const base=process.env.UI_BASE || 'http://127.0.0.1:8000';
(async()=>{
 const browser=await chromium.launch();
 try{for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:1050},reducedMotion:'reduce'});
  await context.addInitScript(()=>{
   localStorage.setItem('lingon.session',JSON.stringify({access_token:'fixture',user:{id:'money-owner',email:'owner@example.invalid'}}));
   localStorage.setItem('lingon.v1',JSON.stringify({ownerId:'money-owner',onboarded:true,agent:{name:'Audit',color:'lingon',pers:'Precise'},view:'chat',activeChat:'wallet',chats:[{id:'wallet',title:'Wallet',messages:[],at:Date.now()}],canvasOpen:true,canvasTab:'payments',vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
   window.moneyElements=[];
   window.WhopElements=()=>({wallet:{create:group=>({create:(kind,options)=>{window.moneyOptions=options;window.moneyElements.push({kind,accountId:group.accountId,availableBalance:options.availableBalance,pendingBalance:options.pendingBalance,payoutCountry:options.payoutCountry,allowNewCard:options.allowNewCard});return {mount:target=>{document.querySelector(target).innerHTML='<p>Secure '+kind+' form</p>';},destroy:()=>{}};},destroy:()=>{}})},verifications:{create:group=>({create:(kind,options)=>{window.moneyVerification=options;window.moneyElements.push({kind,accountId:group.accountId,verificationKind:group.kind});return {mount:target=>{document.querySelector(target).innerHTML='<p>Secure wallet check</p>';},destroy:()=>{}};},destroy:()=>{}})}});
  });
  const calls=[],wallet={configured:true,kind:'connected',status:'verification_required',cardProgramAvailable:false,withdrawalsAvailable:true,identityVerified:false,verificationStatus:'pending',balance:{available:125,pending:25},country:'SE'};
  let depositAttempts=0,quoteAttempts=0,linkAttempts=0,sendAttempts=0,holdWithdrawal=false,releaseWithdrawal;
  await context.route('**/api/**',async route=>{
   const req=route.request(),pathname=new URL(req.url()).pathname,body=req.postData()?JSON.parse(req.postData()):{};calls.push({pathname,method:req.method(),body});let result={};
   const reject=message=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:message})});
   if(pathname==='/api/belna-wallet')result={wallet,balanceHistory:[],activity:[]};
   else if(pathname==='/api/wallet-preferences')result={activeMethod:'belna_wallet',selectionSaved:true,merchantEnabled:false};
   else if(pathname==='/api/belna-wallet/card-waitlist')result={cardWaitlist:{joined:false}};
   else if(pathname==='/api/shipping-addresses')result={addresses:[]};
   else if(pathname==='/api/shop-pay')result={shopPay:{configured:true,connected:false}};
   else if(pathname==='/api/belna-wallet/deposit-session'){if(++depositAttempts===1)return reject('Funding methods could not load. Try again.');result={accountId:'biz_owner',expiresAt:new Date(Date.now()+15*60000).toISOString(),cardFundingAvailable:true};}
   else if(pathname==='/api/belna-wallet/verification-session')result={accountId:'biz_owner',accessToken:'identity-fixture-token'.repeat(3),verificationKind:'individual',expiresAt:new Date(Date.now()+15*60000).toISOString()};
   else if(pathname==='/api/belna-wallet/withdraw-session'){if(holdWithdrawal)await new Promise(resolve=>{releaseWithdrawal=resolve;});result={accountId:'biz_owner',accessToken:'withdrawal-fixture-token'.repeat(3),expiresAt:new Date(Date.now()+15*60000).toISOString(),availableBalance:125,pendingBalance:25,payoutCountry:'SE'};}
   else if(pathname==='/api/belna-wallet/quote'){if(++quoteAttempts===1)return reject('Sending money is not enabled for your wallet yet. Complete your identity check first.');result={quoteId:'reviewed-transfer',recipient:body.recipient,amount:body.amount,fees:'Partner fees may apply.'};}
   else if(pathname==='/api/belna-wallet/send'){sendAttempts++;result={quoteId:body.quoteId,recipient:'friend@example.invalid',amount:5,status:'succeeded'};}
   else if(pathname==='/api/belna-wallet/receive'){if(++linkAttempts===1)return reject('Your payment link could not be created. Try again.');result={url:'https://whop.com/checkout/fixture',amount:body.amount,title:body.title};}
   else if(pathname==='/api/belna-wallet/deposit')result={url:'https://whop.com/deposit/biz_owner'};
   await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await context.route('https://whop.com/deposit/**',route=>route.fulfill({contentType:'text/html',body:'<p>Secure card funding</p>'}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const panel=page.locator('.wallet-panel');
  const ensurePanel=async()=>{if(!await panel.isVisible())await page.locator('[data-act="togglecanvas"]:visible').first().click();await page.locator('[data-act="ctab"][data-t="payments"]:visible').click();};
  await page.goto(base+'/app');await ensurePanel();await panel.getByRole('button',{name:'Withdraw',exact:true}).waitFor();
  assert.equal(await panel.getByRole('radio').count(),0);assert.equal(await panel.getByText('Identity verification',{exact:true}).count(),0);assert.ok(!/Whop/i.test(await panel.innerText()));
  await panel.locator('.wl-balance').getByText('$150.00',{exact:true}).waitFor();
  fs.mkdirSync(path.resolve('artifacts/wallet-choice'),{recursive:true});await page.locator('#canvas').screenshot({path:path.resolve(`artifacts/wallet-choice/money-panel-${width}.png`)});
  await panel.getByRole('button',{name:'Add money',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Add money to Belna Wallet'});
  await dialog.getByText('Funding methods could not load. Try again.',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Try again',exact:true}).click();await dialog.getByText('Secure deposit form',{exact:true}).waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Try again',exact:true}).isVisible(),false,'retry disappears after successful loading');
  assert.equal(page.url(),base+'/app','funding stays inside Belna');
  await page.evaluate(()=>window.moneyOptions.onIdentityVerificationRequested({accountId:'biz_owner'}));await dialog.getByText('Secure wallet check',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.moneyElements.at(-1)),{kind:'kyc',accountId:'biz_owner',verificationKind:'individual'});
  await page.evaluate(()=>window.moneyVerification.onCompleted({verificationId:'fixture'}));await dialog.getByText('Secure deposit form',{exact:true}).waitFor();
  assert.equal(await panel.getByText('Identity verification',{exact:true}).count(),0,'required action checks never leave a permanent setup banner');
  await page.evaluate(()=>window.moneyOptions.onDepositConfirmed({}));await dialog.getByText('Watching for your deposit. Your balance updates after it arrives.',{exact:true}).waitFor();
  assert.equal(await panel.locator('.wl-balance strong').innerText(),'$150.00','deposit acknowledgement never invents settled money');
  await page.evaluate(()=>window.moneyOptions.onAddCardRequested({}));await page.getByText('Secure card funding',{exact:true}).waitFor();assert.equal(calls.filter(x=>x.pathname.endsWith('/deposit')).length,1,'card funding retains the supported payment collection flow');
  await page.goBack();await ensurePanel();await panel.getByRole('button',{name:'Send',exact:true}).waitFor();
  await panel.getByRole('button',{name:'Send',exact:true}).click();await page.locator('#belna-wallet-recipient').fill('friend@example.invalid');await page.locator('#belna-wallet-send-amount').fill('5');await panel.getByRole('button',{name:'Review send',exact:true}).click();
  await panel.getByRole('button',{name:'Continue secure wallet check',exact:true}).click();await page.getByText('Secure wallet check',{exact:true}).waitFor();await page.evaluate(()=>window.moneyVerification.onCompleted({verificationId:'fixture'}));await page.getByRole('dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('#belna-wallet-send-amount').inputValue(),'5','private check preserves the transfer draft');
  await panel.getByRole('button',{name:'Review send',exact:true}).click();await panel.getByRole('button',{name:'Confirm send',exact:true}).waitFor();assert.equal(sendAttempts,0,'review cannot send money');
  await panel.getByRole('button',{name:'Confirm send',exact:true}).click();await page.getByText('Money sent.',{exact:true}).waitFor();assert.equal(sendAttempts,1);assert.deepEqual(calls.find(x=>x.pathname.endsWith('/send')).body,{quoteId:'reviewed-transfer',confirm:true});
  await panel.getByRole('button',{name:'Get paid',exact:true}).click();await page.locator('#belna-wallet-receive-title').fill('Design');await page.locator('#belna-wallet-receive-amount').fill('25');await panel.getByRole('button',{name:'Create payment link',exact:true}).click();await panel.getByRole('alert').filter({hasText:'Your payment link could not be created.'}).waitFor();
  await panel.getByRole('button',{name:'Create payment link',exact:true}).click();await panel.getByRole('link',{name:'Open payment link',exact:true}).waitFor();
  const linkCalls=calls.filter(x=>x.pathname.endsWith('/receive'));assert.equal(linkCalls[0].body.requestKey,linkCalls[1].body.requestKey,'retry keeps the same payment request');
  await panel.getByRole('button',{name:'Withdraw',exact:true}).click();await page.getByText('Secure withdraw form',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>window.moneyElements.at(-1)),{kind:'withdraw',accountId:'biz_owner',availableBalance:125,pendingBalance:25,payoutCountry:'SE',allowNewCard:undefined});
  assert.ok(!/Whop/i.test(await page.getByRole('dialog').innerText()));
  assert.equal(await page.getByRole('dialog').getByRole('button',{name:'Try again',exact:true}).isVisible(),false);
  assert.ok(!/withdrawal-fixture-token|identity-fixture-token/.test(await page.evaluate(()=>JSON.stringify([localStorage,sessionStorage]))),'private tokens never enter browser storage');
  fs.mkdirSync(path.resolve('artifacts/wallet-choice'),{recursive:true});await page.screenshot({path:path.resolve(`artifacts/wallet-choice/withdraw-${width}.png`)});
  await page.evaluate(()=>window.moneyOptions.onDone({}));await page.getByRole('dialog').waitFor({state:'detached'});
  assert.equal(calls.filter(x=>x.pathname.endsWith('/card-connect')).length,0,'money actions never apply for or issue a virtual card');
  holdWithdrawal=true;await panel.getByRole('button',{name:'Withdraw',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.wallet-withdraw-status')?.textContent.includes('Opening'));
  while(!releaseWithdrawal)await new Promise(resolve=>setTimeout(resolve,20));
  await page.evaluate(()=>{const session=window.LingonAuth.get();window.LingonAuth.set({...session,user:{...session.user,id:'changed-owner'}});});releaseWithdrawal();await page.getByRole('dialog').waitFor({state:'detached'});
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('Wallet money UI: desktop/mobile embedded funding, retry, action-only private checks, preserved drafts, explicit sends, payment-link retries, correct withdrawal balances/country, private tokens and changed-owner closure passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
