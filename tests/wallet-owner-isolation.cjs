const assert = require('node:assert/strict');
const { createBusinessWallet: createBelnaWallet } = require('../server/belna-wallet');
const { createWalletTools } = require('../server/agents/wallet-tools');

// Exercise the adapter with two distinct owners, including forged client IDs.
// All provider operations are simulated: this test cannot move real money.
module.exports = async function walletOwnerIsolation() {
  const rows = new Map(), quotes = new Map(), purchases = new Map(), cards = new Map(), calls = [], submitted = [];
  let depositOwnerOverride, checkoutCompanyOverride, secretOverride, cardIssuing = true;
  const store = {
    supaConfigured: () => true,
    walletRecoveryReady: async () => true,
    getBelnaWallet: async id => rows.get(id),
    claimBelnaWallet: async (id, data) => { const row = {user_id:id, ...data}; rows.set(id,row); return row; },
    saveBelnaWallet: async (id, data) => { Object.assign(rows.get(id),data); return rows.get(id); },
    findBelnaWalletRecipient: async email => [...rows.values()].find(x => x.owner_email === email),
    addBelnaWalletQuote: async (id, data) => { const q = {user_id:id,status:'quoted',...data}; quotes.set(q.id,q); return q; },
    getBelnaWalletQuote: async (id, key) => quotes.get(key)?.user_id === id ? quotes.get(key) : null,
    beginBelnaWalletTransfer: async (id, key) => { const q = quotes.get(key); assert.equal(q.user_id,id); q.status='processing'; return q; },
    saveBelnaWalletTransfer: async (id, key, data) => { assert.equal(quotes.get(key).user_id,id); Object.assign(quotes.get(key),data); },
    listBelnaWalletTransfers: async id => [...quotes.values()].filter(x => x.user_id === id && x.status !== 'quoted'),
    claimWalletPurchase: async (id, data) => {
      const old = [...purchases.values()].find(x => x.user_id === id && x.approval_key === data.approval_key);
      if (old) return {claimed:false,purchase:old};
      const p = {user_id:id,status:'issuing',...data}; purchases.set(p.id,p); return {claimed:true,purchase:p};
    },
    saveWalletPurchase: async (id, key, data) => { assert.equal(purchases.get(key).user_id,id); Object.assign(purchases.get(key),data); return purchases.get(key); },
    listWalletPurchases: async id => [...purchases.values()].filter(x => x.user_id === id),
    listPendingWalletPurchases: async () => [...purchases.values()].filter(x => !x.canceled_at),
    getWalletPurchaseByCard: async (account, card) => [...purchases.values()].find(x => x.account_id === account && x.card_id === card),
  };
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url), path = parsed.pathname.replace('/api/v1','');
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({path,query:parsed.searchParams,method:init.method,body});
    let data;
    if (path === '/accounts' && init.method === 'POST') {
      const owner = body.email.split('@')[0];
      data = {id:'biz_'+owner,owner:{id:'user_'+owner},parent_account:{id:'biz_platform'}};
      assert.equal(body.metadata.external_id,owner);
    } else if (path.startsWith('/accounts/')) {
      const account = path.split('/').at(-1);
      data = {id:account,parent_account:{id:'biz_platform'},owner:{id:account.replace('biz_','user_')},
        verification:{individual:{status:'approved'}},capabilities:{transfer:'active',card_issuing:cardIssuing?'active':'inactive'},
        balances:[{symbol:'USD',breakdown:{available:account === 'biz_alice'?100:60,pending:0}}]};
    } else if (path === '/financial_activity') {
      data = {data:[{line_type:'payment_gross',currency:{code:'usd'},usd_amount:parsed.searchParams.get('account_id') === 'biz_alice'?11:22}]};
    } else if (path === '/deposits') {
      data = {account_id:depositOwnerOverride || body.destination,hosted_url:'https://whop.com/deposit/'+body.destination+'/'};
    } else if (path === '/checkout_configurations') {
      data = {account_id:body.plan.company_id,company_id:checkoutCompanyOverride || body.plan.company_id,
        plan:body.plan,purchase_url:'https://whop.com/checkout/ch_'+body.plan.company_id};
    } else if (path === '/access_tokens') {
      data = {token:('token-'+body.account_id+'-').repeat(4),expires_at:body.expires_at};
    } else if (path === '/transfers') {
      data = {object:'transfer',id:'ctt_'+quotes.size,status:'succeeded'};
    } else if (path === '/cards' && init.method === 'POST') {
      data = {object:'card',id:'icrd_'+cards.size,type:'virtual',status:'active',user_id:body.assigned_user_id,
        name:body.name,last4:'4242',limit:{amount:body.spend_limit,frequency:body.spend_limit_frequency},expiration_month:'12',expiration_year:'2099'};
      cards.set(data.id,{...data,account_id:body.account_id});
    } else if (path === '/cards') {
      data = {data:[...cards.values()].filter(x => x.account_id === parsed.searchParams.get('account_id'))};
    } else if (path.startsWith('/cards/')) {
      const c = cards.get(path.split('/').at(-1));
      assert.equal(body?.account_id || parsed.searchParams.get('account_id'),c.account_id);
      if (init.method === 'PATCH') { c.status='canceled'; data=c; }
      else data = {...c,secrets:{card_number:'4242424242424242',cvc:'123',pin:'9999'},...secretOverride};
    } else if (path === '/card_transactions') data = {data:[]};
    else throw Error('Unexpected provider request: '+path);
    return {ok:true,json:async () => data};
  };
  const wallet = createBelnaWallet({store,fetchImpl,env:{WHOP_COMPANY_API_KEY:'test-only',WHOP_PLATFORM_ACCOUNT_ID:'biz_platform',
    WHOP_SANDBOX:'false',WHOP_CARD_ISSUING_ENABLED:'true',WHOP_WITHDRAWALS_ENABLED:'true'},
    secureCheckout:async ({userId,approved}) => ({verify:async () => {},submit:async input => {
      assert.equal(cards.get(input.card.id).account_id,rows.get(userId).account_id);
      assert.equal(cards.get(input.card.id).user_id,rows.get(userId).owner_provider_id);
      assert.equal(cards.get(input.card.id).limit.amount,approved.amount);
      assert.equal(input.card.secrets.pin,undefined);
      submitted.push({userId,cardId:input.card.id});
    },close:async () => {}})});
  for (const id of ['alice','bob']) {
    await wallet.setup({id,email:id+'@example.com',email_confirmed_at:'2026-01-01'},
      {country:'SE',account_id:'biz_platform',user_id:'alice',owner_provider_id:'user_alice'});
    const state = await wallet.snapshot(id);
    assert.equal(state.wallet.balance.available,id === 'alice'?100:60);
    assert.equal(state.activity[0].amount,id === 'alice'?11:22);
    assert.equal(rows.get(id).account_id,'biz_'+id);
    assert.equal(rows.get(id).owner_provider_id,'user_'+id);
  }
  const forged = {account_id:'biz_alice',company_id:'biz_platform',destination_id:'biz_platform',user_id:'alice'};
  for (const id of ['alice','bob']) {
    assert.equal((await wallet.deposit(id,forged)).url,'https://whop.com/deposit/biz_'+id+'/');
    const pay = await wallet.receive(id,{...forged,amount:5,title:'Work',requestKey:'payment-request-'+id});
    assert.ok(pay.url.endsWith('biz_'+id));
    const withdrawal = await wallet.withdrawalSession(id,forged);
    assert.equal(withdrawal.accountId,'biz_'+id);
    assert.ok(withdrawal.accessToken.includes('biz_'+id));
  }
  const quote = await wallet.transferQuote('bob',{...forged,recipient:'alice@example.com',amount:5});
  const before = calls.length;
  await assert.rejects(wallet.confirmTransfer('alice',{quoteId:quote.quoteId,confirm:true}),/not found/);
  assert.equal(calls.length,before,'another owner cannot use Bob’s transfer quote');
  await wallet.confirmTransfer('bob',{...forged,quoteId:quote.quoteId,confirm:true});
  const transfer = calls.find(x => x.path === '/transfers').body;
  assert.equal(transfer.origin_id,'biz_bob'); assert.equal(transfer.destination_id,'biz_alice');
  const tools = createWalletTools(wallet);
  const linkArgs = {amount:7,title:'Bob’s work',...forged};
  await tools.wallet_receive.run(linkArgs,{userId:'bob',approvedDetail:await tools.wallet_receive.approvalDetail(linkArgs)});
  assert.equal(calls.at(-1).body.plan.company_id,'biz_bob','agent earnings use the agent owner’s wallet');
  // The same approval key is independent for each owner; a retry is not a second charge.
  const approved = {paymentMethod:'belna_wallet',checkoutKey:'a'.repeat(64),website:'https://shop.example/checkout',amount:12.34,currency:'USD',...forged};
  for (const id of ['alice','bob']) await wallet.executePurchase(id,approved,{userId:'alice'});
  await wallet.executePurchase('bob',approved);
  assert.deepEqual(submitted.map(x => x.userId),['alice','bob']);
  assert.equal((await wallet.snapshot('bob')).purchases.length,1);
  assert.equal((await wallet.reconcilePurchaseCard('biz_alice',submitted[1].cardId)).matched,false,'Alice’s webhook cannot settle Bob’s card');
  cardIssuing=false;
  await wallet.connectCard('bob',forged);
  const connection = calls.findLast(x => x.path === '/cards' && x.method === 'POST');
  assert.equal(connection.body.account_id,'biz_bob'); assert.equal(connection.body.assigned_user_id,'user_bob');
  assert.equal(cards.get('icrd_2').status,'canceled');
  cardIssuing=true;
  const count = calls.length;
  for (const action of ['deposit','withdrawalSession','connectCard']) await assert.rejects(wallet[action]('missing'),/Create your/);
  await assert.rejects(wallet.receive('missing',{amount:5,title:'Work',requestKey:'payment-missing-01'}),/Create your/);
  await assert.rejects(wallet.executePurchase('missing',approved),/Create your/);
  assert.equal(calls.length,count,'a missing wallet never falls back to the platform or founder');

  depositOwnerOverride='biz_alice';
  await assert.rejects(wallet.deposit('bob'),/deposit.*confirmed/i,'provider deposit must identify the same destination');
  depositOwnerOverride=undefined;
  checkoutCompanyOverride='biz_platform';
  await assert.rejects(wallet.receive('bob',{amount:5,title:'Work',requestKey:'payment-conflict-01'}),/link.*confirmed/);
  checkoutCompanyOverride=undefined;
  const original = rows.get('bob');
  for (const wrong of [{...original,user_id:'alice'},{...original,account_id:'biz_platform'}]) {
    rows.set('bob',wrong);
    const start = calls.length;
    await assert.rejects(wallet.deposit('bob'),/wallet connection.*confirmed/i);
    assert.equal(calls.length,start,'invalid owner mapping is rejected before contacting the provider');
  }
  rows.set('bob',original);
  for (const [index,override] of [{type:'physical'},{limit:{amount:2000,frequency:'daily'}},{user_id:'user_alice'}].entries()) {
    secretOverride=override;
    await assert.rejects(wallet.executePurchase('bob',{...approved,checkoutKey:String(index+1).repeat(64)}),/could not be confirmed/);
    assert.equal(submitted.length,2,'changed card owner/type/limit cannot reach checkout');
    assert.equal([...cards.values()].at(-1).status,'canceled','unusable purchase card is canceled');
  }
  console.log('Wallet owner isolation: two owners, forged IDs, deposits, earnings, sending, withdrawals, virtual card purchases and readback checks passed');
};
if (require.main === module) module.exports().catch(e => {console.error(e);process.exit(1);});
