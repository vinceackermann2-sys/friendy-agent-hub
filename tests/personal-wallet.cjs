const assert=require('node:assert/strict');
const {createBusinessWallet}=require('../server/belna-wallet');
const {createPersonalWallet}=require('../server/personal-wallet');
const createBelnaWallet=options=>{const legacy=createBusinessWallet(options),personal=createPersonalWallet({...options,legacy});return {...personal,reconcilePurchaseCard:(id,card)=>personal.reconcilePersonalPurchaseCard(id,card),reconcilePurchases:personal.reconcilePersonalPurchases};};
const {createWhopUserAuth}=require('../server/whop-user-auth');
(async()=>{
  const env={WHOP_OAUTH_CLIENT_ID:'app_test',WHOP_OAUTH_REDIRECT_URI:'https://belna.se/app',WHOP_OAUTH_SCOPES:'openid profile user:balance:read payout:account:read payout:account:update payout:transfer_funds identity:write',WHOP_SANDBOX:'false',ENCRYPTION_KEY:'test-encryption-key-only-not-a-production-key',WHOP_PERSONAL_CARD_APPLICATIONS_ENABLED:'true',WHOP_WITHDRAWALS_ENABLED:'true',WHOP_COMPANY_API_KEY:'company-must-not-be-used',WHOP_PLATFORM_ACCOUNT_ID:'biz_platform'};
  const states=new Map(),authRows=new Map(),wallets=new Map(),quotes=new Map(),requests=new Map(),calls=[],cards=new Map();
  const store={supaConfigured:()=>true,getBelnaWallet:async id=>wallets.get(id),getWhopWalletAuth:async id=>authRows.get(id),
    saveWhopWalletOAuthState:async(id,fields)=>states.set(id,{user_id:id,...fields}),
    consumeWhopWalletOAuthState:async(id,hash,environment)=>{const s=states.get(id);if(!s || s.state_hash!==hash || s.environment!==environment)return null;states.delete(id);return s;},
    connectPersonalWhopWallet:async(id,c)=>{if([...wallets].some(([u,w])=>u!==id && w.account_id===c.whop_user_id))throw Error('already bound');authRows.set(id,{user_id:id,...c,version:1});wallets.set(id,{user_id:id,wallet_kind:'personal',account_id:c.whop_user_id,owner_provider_id:c.whop_user_id,environment:'live',country:c.country,owner_email:c.owner_email,setup_key:c.setup_key,card_request_key:c.card_request_key,daily_card_limit:50});},
    claimWhopWalletRefresh:async()=>true,finishWhopWalletRefresh:async(id,lease,data)=>Object.assign(authRows.get(id),data),releaseWhopWalletRefresh:async()=>{},
    saveBelnaWallet:async(id,fields)=>Object.assign(wallets.get(id),fields),listBelnaWalletTransfers:async()=>[],listWalletPurchases:async()=>[],listPendingWalletPurchases:async()=>[],walletRecoveryReady:async()=>false,
    findBelnaWalletRecipient:async email=>[...wallets.values()].find(w=>w.owner_email===email),
    addBelnaWalletQuote:async(id,fields)=>{const q={user_id:id,status:'quoted',...fields};quotes.set(q.id,q);return q;},getBelnaWalletQuote:async(id,key)=>quotes.get(key)?.user_id===id?quotes.get(key):null,
    beginBelnaWalletTransfer:async(id,key)=>{const q=quotes.get(key);assert.equal(q.user_id,id);q.status='processing';return q;},saveBelnaWalletTransfer:async(id,key,fields)=>Object.assign(quotes.get(key),fields),
    saveWalletPaymentRequest:async(id,fields)=>{if(!requests.has(fields.id))requests.set(fields.id,{user_id:id,created_at:new Date().toISOString(),...fields});return requests.get(fields.id);},getWalletPaymentRequest:async id=>requests.get(id),getWalletTransferByRequest:async id=>[...quotes.values()].find(q=>q.payment_request_id===id)};
  let personalBalance={cash:[{currency:'usd',total_withdrawable_balance:60,pending_balance_usd:2}],cash_usd:60,businesses_total_usd:9000,total_usd:9060};
  let cardResponse='application',failTransferReadback=false,submitted=0,tx=[];
  const purchaseRows=new Map();
  store.claimWalletPurchase=async(id,data)=>{const old=[...purchaseRows.values()].find(p=>p.user_id===id && p.approval_key===data.approval_key);if(old)return {claimed:false,purchase:old};const p={...data,user_id:id,status:'issuing'};purchaseRows.set(p.id,p);return {claimed:true,purchase:p};};
  store.saveWalletPurchase=async(id,key,data)=>{const p=purchaseRows.get(key);assert.equal(p.user_id,id);Object.assign(p,data);return p;};
  store.listPendingWalletPurchases=async()=>[...purchaseRows.values()];
  store.getWalletPurchaseByCard=async(owner,card)=>[...purchaseRows.values()].find(p=>p.account_id===owner && p.card_id===card);
  const response=(data,status=200)=>({ok:status<300,status,headers:new Headers(),json:async()=>data});
  const fetchImpl=async(url,opts={})=>{
    const parsed=new URL(url),body=opts.body?JSON.parse(opts.body):null,token=opts.headers?.Authorization?.replace('Bearer ','');calls.push({path:parsed.pathname,query:parsed.search,body,token,key:opts.headers?.['Idempotency-Key']});
    if(parsed.pathname==='/oauth/token'){const user=body.code || body.refresh_token.split('-').at(-1);return response({access_token:'personal-access-token-'+user,refresh_token:'personal-refresh-token-'+user,token_type:'Bearer',expires_in:3600});}
    const whopId='user_'+String(token).split('-').at(-1);
    if(parsed.pathname==='/oauth/userinfo')return response({sub:whopId});
    assert.ok(token.startsWith('personal-access-token-'),'personal APIs must use OAuth, never company key');
    assert.equal(body?.account_id,undefined);assert.equal(body?.assigned_user_id,undefined);assert.equal(parsed.searchParams.get('account_id'),null);
    if(parsed.pathname==='/api/v1/users/me')return response({id:whopId,verification:{individual:{status:'approved'}},balance:personalBalance});
    if(parsed.pathname==='/api/v1/cards' && !body)return response({data:cards.get(whopId)||[]});
    if(parsed.pathname==='/api/v1/financial_activity'){assert.equal(parsed.searchParams.get('user_id'),whopId);assert.equal(parsed.searchParams.get('include_owned_accounts'),'false');return response({data:[{id:'activity1',line_type:'transfer_incoming',currency:{code:'usd'},usd_amount:10,posted_at:new Date().toISOString()}]});}
    if(parsed.pathname==='/api/v1/cards'){
      assert.equal(body.user_id,whopId);
      if(cardResponse==='unsupported')return response({error:{type:'bad_request',message:'Card applications are only supported for accounts, not user wallets.'}},400);
      if(cardResponse==='application')return response({object:'card_application',status:'pending'},202);
      if(cardResponse==='approved')return response({object:'card_application',status:'approved'},202);
      const card={id:'icrd_'+whopId.slice(5)+(cards.get(whopId)||[]).length,object:'card',user_id:whopId,type:'virtual',status:'active',last4:'1234',name:body.name,limit:{amount:body.spend_limit,frequency:body.spend_limit_frequency},expiration_month:12,expiration_year:2099,secrets:{card_number:'4242424242421234',cvc:'123'}};cards.set(whopId,[...(cards.get(whopId)||[]),card]);return response(card,201);
    }
    if(parsed.pathname.startsWith('/api/v1/cards/')){const card=(cards.get(whopId)||[]).find(c=>c.id===parsed.pathname.split('/').at(-1));assert.ok(card);if(body?.canceled)card.status='canceled';if(body?.frozen!=null)card.status=body.frozen?'frozen':'active';return response(card);}
    if(parsed.pathname==='/api/v1/card_transactions'){assert.equal(parsed.searchParams.get('cardholder_id'),whopId);return response({data:tx});}
    if(parsed.pathname==='/api/v1/access_tokens'){assert.equal(body.user_id,undefined,'OAuth derives own user');assert.ok(body.scoped_actions.length);return response({token:'narrow-owner-only-token-not-oauth-refresh',expires_at:body.expires_at});}
    if(parsed.pathname==='/api/v1/transfers'){assert.equal(body.origin_id,whopId);return response({object:'transfer',id:'ctt_transfer1',origin:{id:failTransferReadback?'biz_platform':whopId},destination:{id:body.destination_id},currency:'usd',amount:body.amount,status:'succeeded'});}
    if(parsed.pathname==='/api/v1/transfers/ctt_transfer1')return response({object:'transfer',id:'ctt_transfer1',origin:{id:whopId},destination:{id:'user_bob'},currency:'usd',amount:10,status:'succeeded'});
    throw Error('Unexpected path '+parsed.pathname);
  };
  const a={id:'alice',email:'alice@example.test',email_confirmed_at:'today'},b={id:'bob',email:'bob@example.test',email_confirmed_at:'today'};
  const auth=createWhopUserAuth({store,env,fetchImpl});
  const startA=await auth.start(a,{country:'SE'}),startB=await auth.start(b,{country:'US'});
  const uri=new URL(startA.url);assert.equal(uri.searchParams.get('company_id'),null);assert.equal(uri.searchParams.get('code_challenge_method'),'S256');assert.equal(uri.searchParams.get('redirect_uri'),'https://belna.se/app');
  assert.match(uri.searchParams.get('nonce'),/^[a-f0-9]{64}$/);assert.notEqual(uri.searchParams.get('nonce'),new URL(startB.url).searchParams.get('nonce'),'OpenID nonce is unique per sign-in');
  assert.ok(!JSON.stringify(states.get('alice')).includes('verifier":"'),'PKCE verifier encrypted');
  await assert.rejects(auth.finish(b,{state:startA.state,code:'alice'}),/expired/);
  await auth.finish(a,{state:startA.state,code:'alice'});await auth.finish(b,{state:startB.state,code:'bob'});
  await assert.rejects(auth.finish(a,{state:startA.state,code:'alice'}),/expired/,'callback cannot replay');
  assert.ok(!JSON.stringify(authRows.get('alice')).includes('personal-access-token'),'OAuth tokens encrypted');
  assert.deepEqual(await auth.credentials('alice'),{userId:'user_alice',token:'personal-access-token-alice'});
  const saved=authRows.get('alice').encrypted_tokens;authRows.get('alice').encrypted_tokens=authRows.get('bob').encrypted_tokens;
  await assert.rejects(auth.credentials('alice'),/Reconnect/,'ciphertext is owner-bound');authRows.get('alice').encrypted_tokens=saved;
  const wallet=createBelnaWallet({store,env,fetchImpl});
  assert.equal((await wallet.snapshot('alice')).wallet.balance.available,60,'personal cash only, excludes owned businesses');
  assert.equal((await wallet.snapshot('unknown')).wallet.status,'not_created');
  await wallet.connectCard('alice');const firstKey=calls.filter(x=>x.path==='/api/v1/cards'&&x.body).at(-1).key;
  assert.equal((await wallet.snapshot('alice')).wallet.status,'review');
  cardResponse='approved';await wallet.connectCard('alice');assert.notEqual(calls.filter(x=>x.path==='/api/v1/cards'&&x.body).at(-1).key,firstKey,'approval polls do not replay initial 202');
  const fundedBalance=personalBalance;personalBalance={cash:[],cash_usd:'0.00',pending_usd:'0.00',businesses_total_usd:'9000.00'};
  assert.deepEqual((await wallet.snapshot('alice')).wallet.balance,{currency:'USD',available:0,pending:0},'confirmed empty personal cash is zero, excluding business funds');
  personalBalance={cash:[]};assert.equal((await wallet.snapshot('alice')).wallet.balance.available,null,'missing provider balance remains unavailable');
  personalBalance=fundedBalance;
  cardResponse='unsupported';const blockedUser=await wallet.connectCard('bob');
  assert.equal(blockedUser.wallet.cardApplicationStatus,'unsupported_personal_wallet');
  assert.equal(blockedUser.wallet.cardProgramAvailable,false);
  const blockedCalls=calls.filter(x=>x.path==='/api/v1/cards'&&x.body).length;
  await wallet.connectCard('bob');assert.equal(calls.filter(x=>x.path==='/api/v1/cards'&&x.body).length,blockedCalls,'unsupported personal application is not retried');
  cardResponse='card';const ready=await wallet.connectCard('alice');assert.equal(ready.wallet.cardReady,true);assert.ok(!JSON.stringify(ready).includes('secrets'));assert.ok(!JSON.stringify(ready).includes('must never return'));
  const [deposit,withdraw,card]=await Promise.all([wallet.deposit('alice'),wallet.withdrawalSession('bob'),wallet.cardSession('alice')]);
  assert.equal(deposit.accountId,'user_alice');assert.equal(withdraw.accountId,'user_bob');assert.equal(card.accountId,'user_alice');
  const quote=await wallet.transferQuote('alice',{recipient:b.email,amount:10});await assert.rejects(wallet.confirmTransfer('bob',{quoteId:quote.quoteId,confirm:true}),/not found/);await assert.rejects(wallet.confirmTransfer('alice',{quoteId:quote.quoteId,confirm:false}),/confirm/);
  assert.equal((await wallet.confirmTransfer('alice',{quoteId:quote.quoteId,confirm:true})).status,'succeeded');
  const malformed=await wallet.transferQuote('bob',{recipient:a.email,amount:10});failTransferReadback=true;
  await assert.rejects(wallet.confirmTransfer('bob',{quoteId:malformed.quoteId,confirm:true}),/awaiting confirmation/);assert.equal(quotes.get(malformed.quoteId).status,'processing');failTransferReadback=false;
  const receive=await wallet.receive('bob',{amount:20,title:'Design',requestKey:'personal-payment-request-001'});assert.match(receive.url,/belna.se\/app\?wallet_request=/);assert.equal((await wallet.paymentRequest('alice','personal-payment-request-001')).amount,20);
  const pay=await wallet.transferQuote('alice',{amount:1,paymentRequestId:'personal-payment-request-001'});assert.equal(pay.amount,20,'payer cannot alter requested amount');assert.equal(quotes.get(pay.quoteId).destination_id,'user_bob');
  const secureCheckout=async()=>({verify:async()=>{},submit:async({card})=>{submitted++;assert.equal(card.secrets.card_number,'4242424242421234');assert.equal(card.secrets.pin,undefined);return {submitted:true};},close:async()=>{}});
  secureCheckout.available=async()=>true;store.walletRecoveryReady=async()=>true;
  const spend=createBelnaWallet({store,env:{...env,WHOP_PERSONAL_CARD_ISSUING_ENABLED:'true'},fetchImpl,secureCheckout});
  const approved={paymentMethod:'belna_wallet',checkoutKey:'a'.repeat(64),website:'https://shop.example/checkout',amount:12.34,currency:'USD'};
  const purchase=await spend.executePurchase('alice',approved);assert.equal(submitted,1);assert.equal(purchase.status,'submitted');
  const issued=calls.filter(c=>c.path==='/api/v1/cards' && c.body).at(-1);assert.equal(issued.body.user_id,'user_alice');assert.equal(issued.body.spend_limit,12.34);assert.equal(issued.body.spend_limit_frequency,'one_time');assert.equal(issued.token,'personal-access-token-alice');
  assert.ok(!JSON.stringify(purchase).includes('4242424242421234'));assert.ok(!JSON.stringify([...purchaseRows.values()]).includes('secrets'));
  await spend.executePurchase('alice',approved);assert.equal(submitted,1);
  await assert.rejects(spend.executePurchase('bob',{...approved,checkoutKey:'b'.repeat(64)}),/approved card/);
  const p=purchaseRows.get(purchase.purchaseId);tx=[{card_id:p.card_id,cardholder_id:'user_bob',transaction_type:'spend',status:'completed'}];assert.equal((await spend.reconcilePurchaseCard('user_alice',p.card_id)).settled,false);
  tx=[{card_id:p.card_id,cardholder_id:'user_alice',transaction_type:'spend',status:'completed'}];assert.equal((await spend.reconcilePurchaseCard('user_alice',p.card_id)).settled,true);assert.ok(p.canceled_at);
  cards.get('user_alice').find(c=>c.id===wallets.get('alice').card_id).status='frozen';assert.equal((await spend.snapshot('alice')).wallet.agentCardPayments,false);await assert.rejects(spend.executePurchase('alice',{...approved,checkoutKey:'c'.repeat(64)}),/paused|approved card/);
  wallets.set('old',{user_id:'old',account_id:'biz_old',environment:'live'});const prior=await wallet.snapshot('old');assert.equal(prior.wallet.status,'personal_connection_required');assert.equal(prior.wallet.legacyWallet,true);assert.ok(!calls.some(c=>c.path==='/api/v1/accounts'),'new setup never creates a business account');
  console.log('Personal wallet: PKCE, callback ownership/replay, encrypted owner binding, personal balances, user cards, scoped elements, transfers and payment requests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
