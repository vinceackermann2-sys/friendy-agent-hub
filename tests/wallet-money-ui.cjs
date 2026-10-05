const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require('playwright');
const base=process.env.UI_BASE || 'http://127.0.0.1:8000';
(async()=>{
 const browser=await chromium.launch();
 try{for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:1050},reducedMotion:'reduce'});
  await context.addInitScript(()=>{
   localStorage.setItem('lingon.session',JSON.stringify({access_token:'fixture',user:{id:'money-owner',email:'owner@example.invalid'}}));
   localStorage.setItem('lingon.v1',JSON.stringify({ownerId:'money-owner',onboarded:true,agent:{name:'Audit',color:'lingon',pers:'Precise'},view:'chat',activeChat:'wallet',chats:[{id:'wallet',title:'Wallet',messages:[],at:Date.now()}],canvasOpen:true,canvasTab:'wallet',vault:{secrets:[],apps:[],approvals:[],mode:'default'}}));
   window.moneyElements=[];
   window.WhopElements=()=>({wallet:{create:group=>({create:(kind,options)=>{window.moneyOptions=options;window.moneyElements.push({kind,accountId:group.accountId,availableBalance:options.availableBalance,pendingBalance:options.pendingBalance,payoutCountry:options.payoutCountry,allowNewCard:options.allowNewCard});return {mount:target=>{document.querySelector(target).innerHTML='<p>Secure '+kind+' form</p>';queueMicrotask(()=>options.onReady?.());},destroy:()=>{}};},destroy:()=>{}})},verifications:{create:group=>({create:(kind,options)=>{window.moneyVerification=options;window.moneyElements.push({kind,accountId:group.accountId,verificationKind:group.kind});return {mount:target=>{document.querySelector(target).innerHTML='<p>Secure wallet check</p>';queueMicrotask(()=>options.onReady?.());},destroy:()=>{}};},destroy:()=>{}})}});
  });
  const calls=[],wallet={configured:true,kind:'connected',status:'verification_required',cardProgramAvailable:false,withdrawalsAvailable:true,identityVerified:false,verificationStatus:'pending',balance:{available:125,pending:25},country:'SE'};
  // Live server clocks can run a few seconds ahead of the owner's device.
  let depositAttempts=0,cardFundingAttempts=0,quoteAttempts=0,sendAttempts=0,holdWithdrawal=false,releaseWithdrawal,sendRejection=null;
  await context.route('**/api/**',async route=>{
   const req=route.request(),pathname=new URL(req.url()).pathname,body=req.postData()?JSON.parse(req.postData()):{};calls.push({pathname,method:req.method(),body});let result={};
   const reject=(message,extra={},status=503)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({error:message,...extra})});
   if(pathname==='/api/belna-wallet')result={wallet,balanceHistory:[],activity:[]};
   else if(pathname==='/api/wallet-preferences')result={activeMethod:'belna_wallet',selectionSaved:true,merchantEnabled:false};
   else if(pathname==='/api/belna-wallet/card-waitlist')result={cardWaitlist:{joined:false}};
   else if(pathname==='/api/shipping-addresses')result={addresses:[]};
   else if(pathname==='/api/shop-pay')result={shopPay:{configured:true,connected:false}};
   else if(pathname==='/api/belna-wallet/deposit-session'){if(++depositAttempts===1)return reject('Funding methods could not load. Try again.');result={accountId:'biz_owner',expiresAt:new Date(Date.now()+15*60000+3000).toISOString(),cardFundingAvailable:true};}
   else if(pathname==='/api/belna-wallet/verification-session')result={accountId:'biz_owner',accessToken:'identity-fixture-token'.repeat(3),verificationKind:'individual',expiresAt:new Date(Date.now()+15*60000+3000).toISOString()};
   else if(pathname==='/api/belna-wallet/withdraw-session'){if(holdWithdrawal)await new Promise(resolve=>{releaseWithdrawal=resolve;});result={accountId:'biz_owner',accessToken:'withdrawal-fixture-token'.repeat(3),expiresAt:new Date(Date.now()+15*60000+3000).toISOString(),availableBalance:125,pendingBalance:25,payoutCountry:'SE'};}
   else if(pathname==='/api/belna-wallet/quote'){if(++quoteAttempts===1)return reject('Sending money is not enabled for your wallet yet. Complete your identity check first.');result={quoteId:'reviewed-transfer',recipient:body.recipient,amount:body.amount,fees:'Partner fees may apply.'};}
   else if(pathname==='/api/belna-wallet/send'){++sendAttempts;if(sendRejection)return reject(sendRejection,{transferNotStarted:true},400);if(sendAttempts===1)return reject('Your transfer is awaiting confirmation.');result={quoteId:body.quoteId,recipient:'friend@example.invalid',amount:5,status:'succeeded'};}
   else if(pathname==='/api/belna-wallet/deposit'){if(++cardFundingAttempts===1)return reject('Card funding could not load. Try again.');result={url:'https://whop.com/deposit/biz_owner/'};}
   await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await context.route('https://whop.com/deposit/**',route=>route.fulfill({contentType:'text/html',body:'<h2>Secure card funding</h2><label>Amount<input type="number" aria-label="Amount"></label><button onclick="document.querySelector(\'p\').textContent=\'Review card funding\'">Continue</button><p role="status">Choose your amount</p>'}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const panel=page.locator('.wallet-panel');
  const ensurePanel=async()=>{if(!await panel.isVisible())await page.locator('[data-act="togglecanvas"]:visible').first().click();await page.locator('[data-act="ctab"][data-t="wallet"]:visible').click();};
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
  await page.evaluate(()=>window.moneyOptions.onAddCardRequested({}));await dialog.getByText('Card funding could not load. Try again.',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Try again',exact:true}).click();const funding=dialog.frameLocator('iframe[title="Secure card funding"]');await funding.getByRole('heading',{name:'Secure card funding',exact:true}).waitFor();
  assert.equal(page.url(),base+'/app','card funding stays in the wallet popup');
  assert.equal(await dialog.locator('iframe').getAttribute('src'),'https://whop.com/deposit/biz_owner/','funding uses a verified biz resource ID');
  const box=await dialog.locator('iframe').boundingBox();assert.ok(box.width>250 && box.height>=320 && box.x>=0 && box.x+box.width<=width,'funding frame is visible on phone and desktop');
  await funding.getByRole('spinbutton',{name:'Amount'}).fill('5');await funding.getByRole('button',{name:'Continue',exact:true}).click();await funding.getByText('Review card funding',{exact:true}).waitFor();
  assert.equal(await panel.locator('.wl-balance strong').innerText(),'$150.00','opening card funding never invents money');
  assert.equal(await dialog.getByRole('link',{name:'open secure funding in a new tab'}).getAttribute('href'),'https://whop.com/deposit/biz_owner/');
  await dialog.getByRole('button',{name:'Back to funding methods',exact:true}).click();await dialog.getByText('Secure deposit form',{exact:true}).waitFor();assert.equal(await dialog.locator('iframe').count(),0,'back destroys the funding frame');
  await page.evaluate(()=>window.moneyOptions.onCardDepositRequested({amount:5,currency:'usd',paymentMethodId:'pmt_fixture'}));await funding.getByRole('heading',{name:'Secure card funding',exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Close wallet action'}).click();await dialog.waitFor({state:'detached'});assert.equal(await page.locator('iframe[title="Secure card funding"]').count(),0,'closing removes private funding');
  assert.equal(cardFundingAttempts,3,'both SDK card callbacks open funding and failed sessions can retry');
  await ensurePanel();await panel.getByRole('button',{name:'Send',exact:true}).waitFor();
  await panel.getByRole('button',{name:'Send',exact:true}).click();const sendDialog=page.getByRole('dialog',{name:'Send money',exact:true});await sendDialog.waitFor({timeout:3000});
  await sendDialog.getByRole('button',{name:'Review send',exact:true}).click();assert.equal(quoteAttempts,0,'empty drafts cannot reach the money API');
  await page.locator('#belna-wallet-recipient').fill('friend@example.invalid');await page.locator('#belna-wallet-send-amount').fill('51');await sendDialog.getByRole('button',{name:'Review send',exact:true}).click();assert.equal(quoteAttempts,0,'transfer amount enforces the $50 limit');
  await page.locator('#belna-wallet-send-amount').fill('5');await sendDialog.getByRole('button',{name:'Review send',exact:true}).click();
  await sendDialog.getByRole('button',{name:'Continue secure wallet check',exact:true}).click();const checkDialog=page.getByRole('dialog',{name:'Continue your wallet setup',exact:true});await checkDialog.getByText('Secure wallet check',{exact:true}).waitFor();await page.evaluate(()=>window.moneyVerification.onCompleted({verificationId:'fixture'}));await checkDialog.waitFor({state:'detached'});assert.equal(await sendDialog.isVisible(),true,'the send popup survives its private check');
  assert.equal(await page.locator('#belna-wallet-send-amount').inputValue(),'5','private check preserves the transfer draft');
  await sendDialog.getByRole('button',{name:'Review send',exact:true}).click();await sendDialog.getByRole('button',{name:'Confirm send',exact:true}).waitFor();assert.equal(sendAttempts,0,'review cannot send money');
  await page.locator('#belna-wallet-send-amount').fill('6');assert.equal(await sendDialog.getByRole('button',{name:'Confirm send',exact:true}).count(),0,'editing invalidates the reviewed transfer');
  await page.locator('#belna-wallet-send-amount').fill('5');await sendDialog.getByRole('button',{name:'Review send',exact:true}).click();await sendDialog.getByRole('button',{name:'Confirm send',exact:true}).click();
  await sendDialog.getByRole('button',{name:'Check transfer status',exact:true}).waitFor();assert.equal(await page.locator('#belna-wallet-send-amount').isDisabled(),true,'unknown outcomes cannot start a new transfer');
  await sendDialog.getByRole('button',{name:'Close wallet action',exact:true}).click();await panel.getByRole('button',{name:'Send',exact:true}).click();await sendDialog.getByRole('button',{name:'Check transfer status',exact:true}).waitFor();assert.equal(await page.locator('#belna-wallet-send-amount').inputValue(),'5','reopening retains the unresolved transfer');
  await sendDialog.getByRole('button',{name:'Check transfer status',exact:true}).click();await page.getByText('Money sent.',{exact:true}).waitFor();assert.equal(sendAttempts,2);assert.deepEqual(calls.filter(x=>x.pathname.endsWith('/send')).map(x=>x.body),Array(2).fill({quoteId:'reviewed-transfer',confirm:true}));
  await sendDialog.getByRole('button',{name:'Close wallet action',exact:true}).click();await sendDialog.waitFor({state:'detached'});
  assert.equal(await panel.getByRole('button',{name:'Get paid',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Create payment link',exact:true}).count(),0);
  assert.equal(calls.filter(x=>/\/(receive|payment-request)$/.test(x.pathname)).length,0,'retired payment links make no API calls');
  await panel.getByRole('button',{name:'Send',exact:true}).click();await sendDialog.waitFor();
  assert.match(await sendDialog.innerText(),/Both people need a Belna Wallet/);
  for(const rejection of ['QUOTE_EXPIRED','TRANSFER_LIMIT']){
    sendRejection=rejection;
    await page.locator('#belna-wallet-recipient').fill('friend@example.invalid');await page.locator('#belna-wallet-send-amount').fill('5');
    await sendDialog.getByRole('button',{name:'Review send',exact:true}).click();await sendDialog.getByRole('button',{name:'Confirm send',exact:true}).click();
    await sendDialog.getByText(rejection,{exact:true}).waitFor();
    assert.equal(await page.locator('#belna-wallet-send-amount').isDisabled(),false,'a definitive no-send rejection restores the draft');
    assert.equal(await sendDialog.getByRole('button',{name:'Check transfer status',exact:true}).count(),0,'a rejected quote cannot be retried as an unresolved send');
    await sendDialog.getByRole('button',{name:'Review send',exact:true}).waitFor();
    assert.equal(await page.locator('#belna-wallet-send-amount').inputValue(),'5','rejected sends preserve the entered amount');
  }
  await page.screenshot({path:path.resolve(`artifacts/wallet-choice/send-${width}.png`)});
  await page.keyboard.press('Escape');await sendDialog.waitFor({state:'detached'});assert.equal(await panel.getByRole('button',{name:'Send',exact:true}).evaluate(node=>node===document.activeElement),true,'closing restores keyboard focus');
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
 console.log('Wallet money UI: desktop/mobile popups, validation, preserved drafts and private checks, invalidated quotes, safe transfer retries, removed payment links, embedded funding/withdrawals and owner isolation passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
