const assert = require('node:assert/strict');
const { createBelnaWallet } = require('../server/belna-wallet');
const { createWalletTools } = require('../server/agents/wallet-tools');

(async () => {
  const rows = new Map(), quotes = new Map(), calls = [];
  let checkoutOverride=null;
  let card = null, transferCalls=0, timeout=false,cardCapability='active',verificationUrl='https://verify.sumsub.com/session/abc',recoveryReady=false,applicationUrl=null,wrongParent=false,identityStatus='pending',verificationResultStatus='pending';
  const store = {
    supaConfigured:() => true,
    getBelnaWallet:async id => rows.get(id),
    claimBelnaWallet:async (id, data) => { if (!rows.has(id)) rows.set(id,{ user_id:id,...data }); return rows.get(id); },
    saveBelnaWallet:async (id, data) => { Object.assign(rows.get(id),data); return rows.get(id); },
    findBelnaWalletRecipient:async () => ({ user_id:'u2',account_id:'biz_two',environment:'sandbox' }),
    addBelnaWalletQuote:async (id, data) => { const q={ user_id:id,status:'quoted',...data }; quotes.set(q.id,q); return q; },
    getBelnaWalletQuote:async (id,key) => quotes.get(key)?.user_id === id ? quotes.get(key) : null,
    beginBelnaWalletTransfer:async (id,key) => { const q=quotes.get(key); if(q.user_id!==id)throw Error('owner'); if(q.status==='quoted')q.status='processing'; return q; },
    saveBelnaWalletTransfer:async (id,key,data) => { Object.assign(quotes.get(key),data); },
    listBelnaWalletTransfers:async id => [...quotes.values()].filter(x=>x.user_id===id && x.status!=='quoted'),
    listPendingWalletConnections:async environment => [...rows.values()].filter(x=>x.environment===environment && String(x.application_status||'').startsWith('connection_')),
    walletRecoveryReady:async()=>recoveryReady,
  };
  const fetchImpl=async (url, init) => {
    assert.equal(init.redirect, 'manual');
    const path=new URL(url).pathname.replace('/api/v1',''), body=init.body ? JSON.parse(init.body) : null;
    calls.push({path,method:init.method,key:init.headers['Idempotency-Key'],body,version:init.headers['Api-Version-Date']});
    let data;
    if(path==='/accounts' && init.method==='POST') data={id:'biz_one',owner:{id:'user_owner'},parent_account:{id:'biz_timewarp'}};
    else if(path==='/accounts/biz_timewarp') data={id:'biz_timewarp'};
    else if(path==='/accounts/biz_one') data={parent_account:{id:wrongParent?'biz_other':'biz_timewarp'},verification:{business:{status:'approved'},individual:{status:identityStatus}},balances:[{symbol:'USD',breakdown:{available:'100.25',pending:'2.50'}}],capabilities:{card_issuing:cardCapability,transfer:'active'}};
    else if(path==='/cards' && init.method==='POST') data=applicationUrl?{object:'card_application',id:'ciac_one',status:'needs_verification',hosted_url:applicationUrl}:card={object:'card',id:'icrd_one',status:'active',last4:'4242',name:body.name,user_id:'user_owner',secrets:{card_number:'4242424242424242',cvc:'123'}};
    else if(path==='/cards') data={data:card ? [card] : []};
    else if(path==='/cards/icrd_one') data=card={...card,status:body.canceled?'canceled':body.frozen ? 'frozen' : 'active'};
    else if(path==='/card_transactions') data={data:[{merchant_name:'Store',usd_amount:5.25,status:'completed',secrets:'LEAK'}]};
    else if(path==='/financial_activity') data={data:[{line_type:'onchain_deposit',currency:{code:'usd'},usd_amount:'25.10',posted_at:'2026-01-01',source:{secrets:'LEAK'}},{line_type:'payment_gross',currency:{code:'btc'},usd_amount:'20'}]};
    else if(path==='/verifications') {if(init.method==='GET')return {ok:false,status:403,json:async()=>({error:{message:'Missing identity read permission'}})};data={status:verificationResultStatus,session_url:verificationResultStatus==='approved'?undefined:verificationUrl};if(verificationResultStatus==='approved')identityStatus='approved';}
    else if(path==='/deposits') data={hosted_url:'https://whop.com/deposit/biz_one'};
    else if(path==='/checkout_configurations') {assert.equal(body.plan.company_id,'biz_one','inline checkout plans must belong to the connected owner');assert.equal(body.account_id,undefined);assert.equal(body.plan.account_id,undefined);data={account_id:'biz_one',plan:{currency:'usd',initial_price:body.plan.initial_price,plan_type:'one_time'},purchase_url:'https://whop.com/checkout/ch_one',...checkoutOverride};}
    else if(path==='/access_tokens')data={token:'owner-only-withdrawal-token-'.repeat(3),expires_at:body.expires_at};
    else if(path==='/transfers') { transferCalls++; if(timeout){timeout=false;throw Error('timeout');} data={object:'transfer',id:'ctt_one',status:'succeeded'}; }
    else throw Error('Unexpected API call '+path);
    return {ok:true,json:async () => data};
  };
  const wallet=createBelnaWallet({store,fetchImpl,env:{WHOP_COMPANY_API_KEY:'secret',WHOP_PLATFORM_ACCOUNT_ID:'biz_timewarp',WHOP_SANDBOX:'true',WHOP_CARD_ISSUING_ENABLED:'true'}});
  await assert.rejects(createBelnaWallet({store,fetchImpl,env:{WHOP_COMPANY_API_KEY:'secret',WHOP_SANDBOX:'true'}}).connectCard('u1'),/not available/);
  assert.equal((await createBelnaWallet({store,env:{}}).snapshot('u1')).wallet.configured,false);
  assert.equal((await wallet.snapshot('new-owner')).wallet.status,'not_created');
  await assert.rejects(createBelnaWallet({store,env:{WHOP_COMPANY_API_KEY:'rejected',WHOP_PLATFORM_ACCOUNT_ID:'biz_timewarp'},fetchImpl:async()=>({ok:false,status:401,json:async()=>({})})}).snapshot('new-owner'),/could not be completed/);
  for (const [status,message,expected] of [[400,'No Rain account found',0],[400,'No Rain account found. Please apply for a card first.',0],[400,'Invalid account',1],[401,'No Rain account found',1]]) {
    const pendingWallet=createBelnaWallet({env:{WHOP_COMPANY_API_KEY:'secret',WHOP_PLATFORM_ACCOUNT_ID:'biz_timewarp'},
      store:{supaConfigured:()=>true,listPendingWalletConnections:async()=>[{account_id:'biz_pending'}],saveBelnaWallet:async()=>{}},
      fetchImpl:async(url,init)=>{assert.equal(init.redirect,'manual');assert.ok(url.includes('/cards?'));return {ok:false,status,json:async()=>({error:{message}})};}});
    assert.equal((await pendingWallet.reconcileConnectionCards()).unresolved,expected,'only the precise pre-issuer no-account response is an empty card list');
  }
  const owner={id:'u1',email:'a@example.com',email_confirmed_at:'2026-09-01T00:00:00Z'};
  await assert.rejects(wallet.setup(owner,{country:'Sweden'}),/country code/);
  await assert.rejects(wallet.setup({id:'u1',email:'a@example.com'},{country:'SE'}),/Confirm your email/,'an unconfirmed email never becomes a wallet address');
  assert.equal(calls.filter(c=>c.path==='/accounts').length,0);
  await wallet.setup(owner,{country:'SE',dailyLimitUsd:1.10});
  await wallet.setup(owner,{country:'SE'});
  assert.equal(calls.filter(c=>c.path==='/accounts').length,1,'same owner never gets a second account');
  assert.equal(rows.get('u1').owner_provider_id,'user_owner','card belongs to the human owner');
  const account=await wallet.snapshot('u1');
  assert.equal(account.wallet.card,null,'connecting a wallet does not issue a reusable card');
  assert.equal(account.wallet.balance.available,100.25);
  assert.equal(account.wallet.agentCardPayments,false);
  const liveEnv={WHOP_COMPANY_API_KEY:'secret',WHOP_PLATFORM_ACCOUNT_ID:'biz_timewarp',WHOP_SANDBOX:'false',WHOP_CARD_ISSUING_ENABLED:'true'};
  const liveWallet=createBelnaWallet({store,fetchImpl,env:liveEnv,secureCheckout:async()=>{throw Error('must not execute while recovery is unavailable');}});
  rows.set('liveOwner',{...rows.get('u1'),user_id:'liveOwner',environment:'live'});
  assert.equal((await liveWallet.snapshot('liveOwner')).wallet.agentCardPayments,false,'configured executor without healthy recovery is unavailable');
  await assert.rejects(liveWallet.executePurchase('liveOwner',{}),/Secure card checkout is not available/);
  recoveryReady=true;
  assert.equal((await liveWallet.snapshot('liveOwner')).wallet.agentCardPayments,true);
  rows.get('liveOwner').card_status='frozen';
  assert.equal((await liveWallet.snapshot('liveOwner')).wallet.agentCardPayments,false,'frozen wallet cannot advertise checkout');
  recoveryReady=false;
  assert.deepEqual(account.activity,[{title:'Deposit',amount:25.1,currency:'USD',status:'recorded',at:'2026-01-01'}]);
  assert.ok(!JSON.stringify(account).includes('LEAK'));
  assert.ok(!JSON.stringify(account).includes('4242424242424242'));
  assert.ok(!JSON.stringify(rows.get('u1')).includes('secrets'));
  assert.equal(calls.filter(c=>c.path==='/cards' && c.method==='POST').length,0);
  cardCapability='inactive';identityStatus='pending';
  assert.equal((await wallet.snapshot('u1')).wallet.identityVerified,false,'business verification cannot complete the human identity step');
  identityStatus='approved';
  const verified=await wallet.snapshot('u1');
  assert.equal(verified.wallet.identityVerified,true);
  assert.equal(verified.wallet.verificationStatus,'approved');
  assert.equal(verified.wallet.status,'card_required','approved KYC advances to card connection, even before an issuer account exists');
  assert.equal(verified.wallet.cardReady,false);
  assert.equal(verified.wallet.agentCardPayments,false);
  assert.ok(!JSON.stringify(verified).includes('PRIVATE'),'verified personal data never leaves the provider adapter');
  assert.ok(!JSON.stringify(verified).includes(verificationUrl),'identity session is owner-action only');
  const verificationPosts=calls.filter(c=>c.path==='/verifications'&&c.method==='POST').length;
  assert.equal((await wallet.verify('u1')).wallet.identityVerified,true,'a completed verification has no session URL and must not be restarted');
  assert.equal(calls.filter(c=>c.path==='/verifications'&&c.method==='POST').length,verificationPosts);
  assert.ok(!calls.some(c=>c.path==='/verifications'&&c.method==='GET'),'status uses the account summary and never needs private identity-read access');
  identityStatus='manual_review';
  assert.equal((await wallet.verify('u1')).wallet.verificationStatus,'manual_review','a review is polled, never restarted');
  assert.equal(calls.filter(c=>c.path==='/verifications'&&c.method==='POST').length,verificationPosts);
  identityStatus='pending';verificationResultStatus='approved';
  const immediate=await wallet.verify('u1');
  assert.equal(immediate.wallet.identityVerified,true,'approval without a session URL advances identity setup');
  assert.equal(immediate.wallet.cardReady,false,'immediate approval does not grant card access');
  identityStatus='rejected';verificationResultStatus='pending';
  assert.equal((await wallet.snapshot('u1')).wallet.identityVerified,false);
  await wallet.verify('u1');
  assert.deepEqual(calls.filter(c=>c.path==='/verifications'&&c.method==='POST').at(-1).body,{kind:'individual',restart:true},'only declined KYC is restarted');
  identityStatus='pending';cardCapability='active';
  assert.ok(calls.every(c=>c.version==='2026-09-25'));
  await assert.rejects(wallet.updateCard('u2',{frozen:true}),/Create your/);
  await assert.rejects(wallet.updateCard('u1',{dailyLimitUsd:0}),/amount/);
  await wallet.updateCard('u1',{frozen:true});
  assert.equal(rows.get('u1').card_status,'frozen');
  assert.ok(!calls.some(c=>c.path==='/cards/icrd_one' && c.method==='GET'),'never retrieve card credentials');
  assert.equal((await wallet.verify('u1')).url,verificationUrl,'Whop can return a Sumsub-hosted KYC session');
  verificationUrl='https://sumsub.com.evil.example/session/abc';
  await assert.rejects(wallet.verify('u1'),/secure wallet link/,'verification rejects lookalike domains');
  assert.match((await wallet.deposit('u1')).url,/deposit/);
  const receive=await wallet.receive('u1',{amount:10,title:'Design work',requestKey:'abcdefghijklmnop'});
  assert.equal(receive.amount,10);
  assert.equal(calls.find(c=>c.path==='/checkout_configurations').body.plan.company_id,'biz_one');
  for(const invalid of [{account_id:'biz_other'},{plan:{currency:'eur',initial_price:10,plan_type:'one_time'}},{plan:{currency:'usd',initial_price:10,plan_type:'renewal'}},{plan:{currency:'usd',initial_price:100,plan_type:'one_time'}}]){
    checkoutOverride=invalid;
    await assert.rejects(wallet.receive('u1',{amount:10,title:'Design work',requestKey:'abcdefghijklmnop'}),/could not be confirmed/,'never share a checkout for another owner, currency, recurring plan or amount');
  }
  checkoutOverride=null;
  const checkoutDenied=createBelnaWallet({store,env:{WHOP_COMPANY_API_KEY:'secret',WHOP_PLATFORM_ACCOUNT_ID:'biz_timewarp',WHOP_SANDBOX:'true'},fetchImpl:async()=>({ok:false,status:403,json:async()=>({error:{message:'You do not have permission to access this resource'}})})});
  await assert.rejects(checkoutDenied.receive('u1',{amount:10,title:'Design work',requestKey:'abcdefghijklmnop'}),/additional Whop permissions/,'permission failures require setup rather than another identity check');
  const tools=createWalletTools(wallet);
  await assert.rejects(wallet.withdrawalSession('u1'),/withdrawals are being connected/);
  const withdrawalWallet=createBelnaWallet({store,fetchImpl,env:{WHOP_COMPANY_API_KEY:'secret',WHOP_PLATFORM_ACCOUNT_ID:'biz_timewarp',WHOP_SANDBOX:'true',WHOP_WITHDRAWALS_ENABLED:'true'}});
  await assert.rejects(withdrawalWallet.withdrawalSession('unknown'),/Create your/);
  const withdrawal=await withdrawalWallet.withdrawalSession('u1');assert.equal(withdrawal.accountId,'biz_one');
  const tokenCall=calls.find(c=>c.path==='/access_tokens');assert.deepEqual(tokenCall.body.scoped_actions,['payout:withdraw_funds','payout:destination:read','payout:create_destination']);assert.equal(tokenCall.body.account_id,'biz_one');assert.ok(Date.parse(withdrawal.expiresAt)-Date.now()<=15*60000);
  assert.ok(!JSON.stringify(await wallet.snapshot('u1')).includes('owner-only-withdrawal-token'));assert.ok(!Object.keys(tools).some(x=>/withdraw.*session|access.*token/.test(x)));
  wrongParent=true;await assert.rejects(withdrawalWallet.withdrawalSession('u1'),/connection could not be confirmed/);wrongParent=false;
  assert.equal(tools.wallet_send.approval,true);
  assert.equal(tools.wallet_receive.approval,true);
  await assert.rejects(async()=>tools.wallet_send.run({recipient:'b@example.com',amount:5},{userId:'u1'}),/Approve/);
  const detail=await tools.wallet_send.approvalDetail({recipient:'b@example.com',amount:5},{userId:'u1'});
  await assert.rejects(async()=>tools.wallet_send.run({recipient:'evil@example.com',amount:5},{userId:'u1',approvedDetail:detail}),/Approve/);
  const quoteId=JSON.parse(detail).quoteId;
  await assert.rejects(wallet.send('u2',{quoteId,approvedDetail:detail}),/Create your/);
  await assert.rejects(wallet.confirmTransfer('u1',{quoteId,confirm:false}),/confirm/);
  timeout=true;
  await assert.rejects(tools.wallet_send.run({recipient:'b@example.com',amount:5},{userId:'u1',approvedDetail:detail}),/could not be reached/);
  assert.equal(quotes.get(quoteId).status,'processing','timeout keeps the reservation');
  const sent=await tools.wallet_send.run({recipient:'b@example.com',amount:5},{userId:'u1',approvedDetail:detail});
  assert.equal(sent.status,'succeeded');
  await tools.wallet_send.run({recipient:'b@example.com',amount:5},{userId:'u1',approvedDetail:detail});
  assert.equal(transferCalls,2,'completed transfer is not called again');
  assert.equal((await wallet.snapshot('u1')).transfers[0].status,'succeeded');
  const sends=calls.filter(c=>c.path==='/transfers');
  assert.ok(sends.every(c=>c.key===quoteId && c.body.idempotence_key===quoteId && c.body.origin_id==='biz_one'));
  rows.set('u3',{...rows.get('u1'),user_id:'u3',card_id:null,application_status:null});cardCapability='inactive';
  const connection=await wallet.connectCard('u3');assert.equal(connection.wallet.cardReady,false);assert.equal(connection.wallet.card,null);assert.equal(card.status,'canceled');
  const connectionCall=calls.find(c=>c.body?.name==='Belna card connection');assert.equal(connectionCall.body.spend_limit_frequency,'one_time');assert.equal(connectionCall.body.transaction_limit,undefined,'per-transaction limit must not override the lifetime limit');
  const count=calls.filter(c=>c.path==='/cards'&&c.method==='POST').length;await wallet.connectCard('u3');assert.equal(calls.filter(c=>c.path==='/cards'&&c.method==='POST').length,count,'pending connection never creates another card');
  card={...card,status:'active'};cardCapability='active';
  const recovered=await wallet.reconcileConnectionCards();
  assert.equal(recovered.unresolved,0);assert.equal(card.status,'canceled','late connection card is closed without a wallet refresh');
  assert.equal(rows.get('u3').application_status,'approved');
  assert.equal((await wallet.connectCard('u3')).wallet.cardReady,true);assert.equal(rows.get('u3').card_id,null);
  await wallet.updateCard('u3',{dailyLimitUsd:75});assert.equal(rows.get('u3').daily_card_limit,75,'agent allowance does not need a permanent card');
  rows.set('u4',{...rows.get('u1'),user_id:'u4',card_id:null,application_status:null});cardCapability='inactive';applicationUrl='https://verify.raincards.xyz/onboarding/owner';
  const application=await wallet.connectCard('u4');assert.equal(application.url,applicationUrl,'owner gets the issuer verification link');assert.ok(!JSON.stringify(await wallet.snapshot('u4')).includes(applicationUrl),'issuer session never reaches agent wallet status');
  assert.equal((await wallet.connectCard('u4')).url,applicationUrl,'pending verification can resume with the same idempotency key');
  applicationUrl='https://verify.raincards.xyz.evil.example/onboarding';await assert.rejects(wallet.connectCard('u4'),/secure wallet link/);
  // Money approvals show the amount and recipient in words, never the tool name or raw JSON.
  const {approvalCard}=require('../server/agents/cards');
  const sendCard=approvalCard('wallet_send',{recipient:'b@example.com',amount:5},detail,tools.wallet_send,'call');
  assert.equal(sendCard.title,'Send $5.00 to b@example.com');assert.deepEqual([sendCard.view.kind,sendCard.view.amount,sendCard.view.to],['money','$5.00','b@example.com']);
  assert.equal(approvalCard('wallet_receive',{},JSON.stringify({amount:150,title:'Logo',currency:'USD'})).title,'Create a $150.00 payment link');
  assert.equal(approvalCard('wallet_set_limit',{},await tools.wallet_set_limit.approvalDetail({dailyLimitUsd:100})).title,'Set your daily card limit to $100.00');
  // Pausing only lowers risk and runs without a card; resuming needs the owner's exact approval.
  const cardChanges=[],pauseTools=createWalletTools({updateCard:async(userId,change)=>{cardChanges.push([userId,change]);return {ok:true};}});
  assert.equal(await pauseTools.wallet_pause.needsApproval({paused:true}),false);
  assert.equal(await pauseTools.wallet_pause.needsApproval({paused:false}),true);
  await pauseTools.wallet_pause.run({paused:true},{userId:'u1'});
  assert.deepEqual(cardChanges.pop(),['u1',{frozen:true}]);
  await assert.rejects(async()=>pauseTools.wallet_pause.run({paused:false},{userId:'u1'}),/approve/);
  await assert.rejects(async()=>pauseTools.wallet_pause.run({paused:false},{userId:'u1',approvedDetail:await pauseTools.wallet_pause.approvalDetail({paused:true})}),/approve/);
  await assert.rejects(async()=>pauseTools.wallet_pause.approvalDetail({paused:'no'}),/pause/);
  await pauseTools.wallet_pause.run({paused:false},{userId:'u1',approvedDetail:await pauseTools.wallet_pause.approvalDetail({paused:false})});
  assert.deepEqual(cardChanges.pop(),['u1',{frozen:false}]);
  assert.equal(cardChanges.length,0);
  console.log('Belna wallet: ownership, private USD activity, card privacy, KYC connection cancellation, approval binding, pause/resume and safe retries passed');
})().catch(e=>{console.error(e);process.exit(1);});
