const assert = require('node:assert/strict');
const { createPrivyWallet, BASE_USDC } = require('../server/privy-wallet');
const { createWalletTools } = require('../server/agents/wallet-tools');
(async () => {
  const rows = new Map(),
    intents = new Map(),
    calls = [];
  let sequence = 0,
    clock = Date.now(),
    timeout = false,
    actionStatus = 'pending',
    additionalSigners = [],
    quorumUsers = ['did:privy:alice'], bankReady = false, bankAccountOwner = 'did:privy:alice', bankAccounts = [], bankChainSubmitted = false;
  const address = '0x' + '1'.repeat(40),
    other = '0x' + '2'.repeat(40);
  const payload = {
    sub: 'did:privy:alice',
    linked_accounts: JSON.stringify([
      { type: 'custom_auth', custom_user_id: 'alice' },
      {
        type: 'wallet',
        wallet_client_type: 'privy',
        chain_type: 'ethereum',
        id: 'wallet_alice',
        address,
      },
    ]),
  };
  const store = {
    supaConfigured: () => true,
    getPrivyWallet: async (id) => rows.get(id),
    getBelnaWallet: async () => null,
    claimPrivyWallet: async (id, f) => {
      if (!rows.has(id)) rows.set(id, { user_id: id, daily_limit_usd: 50, paused: false, ...f });
      return rows.get(id);
    },
    updatePrivyWallet: async (id, f) => Object.assign(rows.get(id), f),
    recordPrivyBalance: async () => [],
    createPrivyIntent: async (id, f) => {
      const i = {
        user_id: id,
        created_at: new Date(clock).toISOString(),
        ...f,
        amount: Number(f.amount),
      };
      intents.set(i.id, i);
      return { ...i };
    },
    getPrivyIntent: async (id, key) =>
      intents.get(key)?.user_id === id ? { ...intents.get(key) } : null,
    updatePrivyIntent: async (id, key, f) => {
      assert.equal(intents.get(key).user_id, id);
      Object.assign(intents.get(key), f);
      return { ...intents.get(key) };
    },
    markPrivyIntentAwaitingOwner: async (id, key) => {
      const i = intents.get(key);
      if (i.user_id !== id || i.status !== 'quoted') return null;
      i.status = 'awaiting_owner';
      return { ...i };
    },
    cancelPrivyIntent: async (id, key) => {
      const i = intents.get(key);
      if (i.user_id !== id || !['quoted', 'awaiting_owner'].includes(i.status)) return null;
      i.status = 'canceled';
      return { ...i };
    },
    listPrivyIntents: async (id) =>
      [...intents.values()].filter((i) => i.user_id === id).map((i) => ({ ...i })),
    beginPrivyIntent: async (id, key) => {
      const i = intents.get(key);
      assert.equal(i.user_id, id);
      if (i.status !== 'processing') {
        i.status = 'processing';
        i.started_at = new Date(clock).toISOString();
      }
      return { ...i };
    },
    findPrivyRecipient: async (email) =>
      email === 'bob@example.com' ? { user_id: 'bob', address: other } : null,
  };
  const env = {
    PRIVY_APP_ID: 'test-app',
    PRIVY_APP_SECRET: 'never-public',
    PRIVY_AUTH_MODE: 'jwt',
    PRIVY_EARN_ENABLED: 'true',
    PRIVY_EARN_VAULT_ID: 'vault-reviewed',
    PRIVY_EARN_FEE_PERCENT: '10',
    PRIVY_BANK_WITHDRAWALS_ENABLED: 'true',
  };
  const fetchImpl = async (url, init) => {
    assert.equal(new URL(url).hostname, 'api.privy.io');
    calls.push({ url, ...init });
    let data;
    if (url.endsWith('/v1/wallets/wallet_alice'))
      data = {
        id: 'wallet_alice',
        address,
        owner_id: 'quorum-alice',
        chain_type: 'ethereum',
        additional_signers: additionalSigners,
      };
    else if (url.endsWith('/v1/key_quorums/quorum-alice'))
      data = {
        id: 'quorum-alice',
        user_ids: quorumUsers,
        authorization_keys: [],
        authorization_threshold: 1,
      };
    else if (url.endsWith('/kyc')) data = {kyc_statuses:[{provider:'bridge',environment:'production',status:bankReady?'active':'not_started',tos:{status:bankReady?'approved':'pending'},kyc:{status:bankReady?'active':'not_started'},endorsements:bankReady?[{name:'sepa',status:'approved'}]:[],capabilities:{payout_fiat:bankReady?'active':'pending'}}]};
    else if (url.includes('/external_fiat_accounts?')) data = {external_fiat_accounts:bankAccounts};
    else if (url.endsWith('/external_fiat_accounts/bank_alice')) data = {external_fiat_account:{id:'bank_alice',user_id:bankAccountOwner,provider:'bridge',environment:'production',currency:'eur',account_type:'iban',bank_name:'Fixture bank',last_4:'3000'}};
    else if (url.endsWith('/external_fiat_accounts') && init.method==='POST') {
      assert.equal(JSON.parse(init.body).account.country,'DEU');
      bankAccounts=[{id:'bank_alice',user_id:bankAccountOwner,provider:'bridge',environment:'production',currency:'eur',account_type:'iban',bank_name:'Fixture bank',last_4:'3000'}];
      data={external_fiat_account:bankAccounts[0]};
    }
    else if (url.endsWith('/kyc/tos')) data={provider:'bridge',environment:'production',status:'pending',link:'https://bridge.xyz/terms/fixture'};
    else if (url.endsWith('/v1/earn/ethereum/vaults/vault-reviewed'))
      data = {
        id: 'vault-reviewed',
        caip2: 'eip155:8453',
        asset: { address: BASE_USDC, decimals: 6 },
        name: 'Reviewed USDC',
        user_apy: 413,
        provider: 'aave',
      };
    else if (url.includes('/earn/ethereum/vaults?vault_id='))
      data = {
        asset: { address: BASE_USDC, decimals: 6 },
        assets_in_vault: '5000000',
        total_deposited: '4000000',
        total_withdrawn: '0',
      };
    else if (url.includes('/transactions?'))
      data = {
        transactions: [
          {
            wallet_id: 'wallet_alice',
            caip2: 'eip155:8453',
            created_at: clock,
            status: 'confirmed',
            details: {
              type: 'transfer_received',
              asset: 'usdc',
              chain: 'base',
              raw_value: '1000000',
              raw_value_decimals: 6,
              recipient: address,
            },
          },
          {
            wallet_id: 'wallet_bob',
            caip2: 'eip155:8453',
            created_at: clock,
            status: 'confirmed',
            details: {
              type: 'transfer_received',
              asset: 'usdc',
              chain: 'base',
              raw_value: '9000000',
              raw_value_decimals: 6,
              recipient: other,
            },
          },
        ],
      };
    else if (url.includes('/actions/'))
      data = { id: 'action-1', wallet_id: 'wallet_alice', type: 'transfer', status: actionStatus,
        ...(bankChainSubmitted ? {steps:[{type:'evm_transaction',transaction_hash:'0x'+'f'.repeat(64)}]} : {}) };
    else {
      if (timeout) throw Error('transport failure with sensitive data');
      assert.equal(init.method, 'POST');
      assert.ok(init.headers['privy-authorization-signature']);
      const type = url.endsWith('/deposit')
        ? 'earn_deposit'
        : url.endsWith('/withdraw')
          ? 'earn_withdraw'
          : url.endsWith('/payout/fiat') ? 'payout' : 'transfer';
      data = { id: 'action-' + sequence, wallet_id: 'wallet_alice', type, status: actionStatus };
    }
    return { ok: true, json: async () => data };
  };
  const wallet = createPrivyWallet({
    store,
    env,
    fetchImpl,
    verifyIdentity: async (token) => {
      assert.equal(token, 'identity-alice');
      return payload;
    },
    readBalance: async () => 100,
    randomId: () => String(++sequence),
    now: () => clock,
    shared: {
      preferences: async () => ({
        activeMethod: 'belna_wallet',
        methods: { belna_wallet: true, shop_pay: true },
      }),
    },
  });
  assert.equal((await wallet.config()).agentSigningEnabled, false);
  assert.equal(JSON.stringify(await wallet.config()).includes('never-public'), false);
  const user = { id: 'alice', email: 'alice@example.com', email_confirmed_at: '2026-10-08' };
  await assert.rejects(
    wallet.setup(
      { ...user, email_confirmed_at: null },
      { identityToken: 'identity-alice', walletId: 'wallet_alice', country: 'SE' },
    ),
    /Confirm your Belna email/,
  );
  await assert.rejects(
    wallet.setup(
      { ...user, id: 'bob' },
      { identityToken: 'identity-alice', walletId: 'wallet_alice', country: 'SE' },
    ),
    /different Belna account/,
  );
  quorumUsers = ['did:privy:alice', 'did:privy:server'];
  await assert.rejects(
    wallet.setup(user, {
      identityToken: 'identity-alice',
      walletId: 'wallet_alice',
      country: 'SE',
    }),
    /Only your verified wallet identity/,
  );
  quorumUsers = ['did:privy:alice'];
  additionalSigners = [{ signer_id: 'agent-key' }];
  await assert.rejects(
    wallet.setup(user, {
      identityToken: 'identity-alice',
      walletId: 'wallet_alice',
      country: 'SE',
    }),
    /no delegated/,
  );
  additionalSigners = [];
  const snapshot = await wallet.setup(user, {
    identityToken: 'identity-alice',
    walletId: 'wallet_alice',
    country: 'SE',
  });
  assert.equal(snapshot.wallet.kind, 'privy');
  assert.equal(snapshot.wallet.balance.asset, 'USDC');
  assert.equal(snapshot.wallet.cardProgramAvailable, false);
  assert.equal(snapshot.earn.apy, 4.13);
  assert.equal(snapshot.activity.length, 1);
  assert.equal(snapshot.activity[0].amount, 1, 'only this owner’s USDC transactions appear');
  for (const amount of [-1, 0, 0.001, NaN, Infinity, 2001, 1.234])
    await assert.rejects(wallet.transferQuote('alice', { recipient: other, amount }));
  await assert.rejects(
    wallet.transferQuote('alice', { recipient: 'missing@example.com', amount: 10 }),
    /confirmed Belna Wallet/,
  );
  await assert.rejects(
    wallet.transferQuote('alice', { recipient: address, amount: 10 }),
    /other than/,
  );
  const tools = createWalletTools(wallet),
    args = { recipient: 'bob@example.com', amount: 10 };
  const detail = await tools.wallet_send.approvalDetail(args, { userId: 'alice' }),
    quote = JSON.parse(detail);
  const writes = calls.filter((c) => c.method === 'POST').length;
  const waiting = await tools.wallet_send.run(args, { userId: 'alice', approvedDetail: detail });
  assert.equal(waiting.status, 'awaiting_owner');
  assert.equal(
    calls.filter((c) => c.method === 'POST').length,
    writes,
    'an agent approval never signs or moves money',
  );
  await assert.rejects(
    async () =>
      tools.wallet_send.run({ ...args, amount: 11 }, { userId: 'alice', approvedDetail: detail }),
    /exact transfer/,
  );
  await assert.rejects(
    wallet.prepare('bob', { quoteId: quote.quoteId, confirm: true }, 'identity-alice'),
  );
  await assert.rejects(
    wallet.confirmTransfer('alice', { quoteId: quote.quoteId, confirm: true }, 'identity-alice'),
    /Authorize this request/,
  );
  const prepared = await wallet.prepare(
    'alice',
    { quoteId: quote.quoteId, confirm: true },
    'identity-alice',
  );
  assert.deepEqual(prepared.request.body, {
    source: { asset: 'usdc', chain: 'base', amount: '10.00' },
    destination: { address: other, chain: 'base', asset: 'usdc' },
  });
  const input = {
    quoteId: quote.quoteId,
    signature: 'owner-signature-only-for-request',
    expiry: prepared.request.headers['privy-request-expiry'],
    confirm: true,
    amount: 999,
    recipient: address,
  };
  timeout = true;
  await assert.rejects(wallet.confirmTransfer('alice', input, 'identity-alice'), /uncertain/);
  assert.equal(intents.get(quote.quoteId).status, 'processing');
  timeout = false;
  const submitted = await wallet.confirmTransfer('alice', input, 'identity-alice');
  assert.equal(submitted.status, 'processing');
  assert.equal(
    JSON.parse(calls.at(-1).body).destination.address,
    other,
    'client substitutions are ignored',
  );
  assert.equal(calls.at(-1).headers['privy-idempotency-key'], quote.quoteId);
  const writeCount = calls.filter((c) => c.method === 'POST').length;
  actionStatus = 'succeeded';
  assert.equal(
    (await wallet.confirmTransfer('alice', input, 'identity-alice')).status,
    'succeeded',
  );
  assert.equal(
    calls.filter((c) => c.method === 'POST').length,
    writeCount,
    'known actions are polled rather than resent',
  );
  const earn = await wallet.transferQuote('alice', { kind: 'earn_deposit', amount: 1 });
  await assert.rejects(
    wallet.prepare('alice', { quoteId: earn.quoteId, confirm: true }, 'identity-alice'),
    /Earn risks/,
  );
  const ep = await wallet.prepare(
    'alice',
    { quoteId: earn.quoteId, confirm: true, riskAccepted: true },
    'identity-alice',
  );
  assert.deepEqual(ep.request.body, { vault_id: 'vault-reviewed', amount: '1.00' });
  assert.equal((await wallet.earn('alice')).position.earned,1);
  assert.equal((await wallet.earn('alice')).yieldFeePercent,10);
  await assert.rejects(wallet.transferQuote('alice',{kind:'earn_withdraw',amount:6}),/Earn balance/);
  assert.equal((await wallet.bankStatus('alice')).verification.ready,false);
  await assert.rejects(wallet.transferQuote('alice',{kind:'bank_withdraw',fiatAccountId:'bank_alice',amount:1}),/verification/);
  await assert.rejects(wallet.bankVerify('alice',{consent:true},undefined),/identity/);
  await assert.rejects(wallet.bankVerify('alice',{consent:false},'identity-alice'),/Confirm/);
  assert.equal((await wallet.bankVerify('alice',{consent:true},'identity-alice')).step,'terms');
  bankReady=true;
  const registration={consent:true,iban:'DE89370400440532013000',bic:'COBADEFFXXX',accountOwnerName:'Fixture Alice'};
  await assert.rejects(wallet.bankRegister('alice',{...registration,iban:'DE00370400440532013000'},'identity-alice'),/check digits/);
  const linked=await wallet.bankRegister('alice',registration,'identity-alice');
  assert.equal(linked.accounts[0].last4,'3000');assert.equal(JSON.stringify(linked).includes(registration.iban),false);
  bankAccountOwner='did:privy:bob';
  await assert.rejects(wallet.transferQuote('alice',{kind:'bank_withdraw',fiatAccountId:'bank_alice',amount:1}),/does not belong/);
  bankAccountOwner='did:privy:alice';
  const bankArgs={fiatAccountId:'bank_alice',amount:1};
  const bankDetail=await tools.wallet_withdraw.approvalDetail(bankArgs,{userId:'alice'});
  const beforeBankAgent=calls.filter(c=>c.method==='POST').length;
  assert.equal((await tools.wallet_withdraw.run(bankArgs,{userId:'alice',approvedDetail:bankDetail})).status,'awaiting_owner');
  assert.equal(calls.filter(c=>c.method==='POST').length,beforeBankAgent,'agent bank approval cannot sign or move money');
  await assert.rejects(async()=>tools.wallet_withdraw.run({...bankArgs,fiatAccountId:'bank_bob'},{userId:'alice',approvedDetail:bankDetail}),/exact bank withdrawal/);
  const bankQuote=await wallet.transferQuote('alice',{kind:'bank_withdraw',fiatAccountId:'bank_alice',amount:1});
  const bp=await wallet.prepare('alice',{quoteId:bankQuote.quoteId,confirm:true},'identity-alice');
  assert.equal(bp.request.url.endsWith('/payout/fiat'),true);
  assert.deepEqual(bp.request.body.destination,{fiat_account_id:'bank_alice',payment_rail:'sepa'});
  bankReady=false;
  await assert.rejects(wallet.prepare('alice',{quoteId:bankQuote.quoteId,confirm:true},'identity-alice'),/verification/);
  bankReady=true;actionStatus='pending';
  assert.equal((await wallet.confirmTransfer('alice',{quoteId:bankQuote.quoteId,signature:'owner-signature-only-for-request',expiry:bp.request.headers['privy-request-expiry']},'identity-alice')).status,'processing');
  const bankWrites=calls.filter(c=>c.method==='POST').length;
  actionStatus='failed';bankChainSubmitted=true;
  const reviewBank=await wallet.prepare('alice',{quoteId:bankQuote.quoteId,confirm:true},'identity-alice');
  assert.equal(reviewBank.intent.status,'processing');assert.equal(reviewBank.intent.providerReviewRequired,true);
  assert.equal(reviewBank.request,undefined);assert.equal(calls.filter(c=>c.method==='POST').length,bankWrites,'failed bank leg after crypto is never reissued');
  bankChainSubmitted=false;
  actionStatus='succeeded';
  assert.equal((await wallet.prepare('alice',{quoteId:bankQuote.quoteId,confirm:true},'identity-alice')).intent.providerReviewRequired,false);
  const old = await wallet.transferQuote('alice', { recipient: other, amount: 1 });
  intents.get(old.quoteId).status = 'processing';
  intents.get(old.quoteId).started_at = new Date(clock - 24 * 3600000).toISOString();
  await assert.rejects(
    wallet.prepare('alice', { quoteId: old.quoteId, confirm: true }, 'identity-alice'),
    /provider reconciliation/,
  );
  const canceled = await wallet.transferQuote('alice', { recipient: other, amount: 1 });
  await wallet.cancel('alice', { quoteId: canceled.quoteId });
  await assert.rejects(
    wallet.prepare('alice', { quoteId: canceled.quoteId, confirm: true }, 'identity-alice'),
    /no longer/,
  );
  assert.equal((await wallet.preferences('alice')).methods.belna_wallet, false);
  assert.equal((await wallet.preferences('alice')).spendingMethod, 'existing_card');
  await assert.rejects(wallet.updateCard('alice', { dailyLimitUsd: 51 }), /at most/);
  const raced = await wallet.transferQuote('alice', { recipient: other, amount: 1 });
  const cancelRace = createPrivyWallet({
    store: {
      ...store,
      cancelPrivyIntent: async (_, id) => {
        intents.get(id).status = 'processing';
        return null;
      },
    },
    env,
  });
  await assert.rejects(cancelRace.cancel('alice', { quoteId: raced.quoteId }), /already reserved/);
  assert.equal(
    intents.get(raced.quoteId).status,
    'processing',
    'a stale cancellation cannot release a payment reservation',
  );
  const racedApproval = await wallet.transferQuote('alice', { recipient: other, amount: 1 });
  const approvalRace = createPrivyWallet({
    store: {
      ...store,
      markPrivyIntentAwaitingOwner: async (_, id) => {
        intents.get(id).status = 'processing';
        return null;
      },
    },
    env,
  });
  assert.equal(
    (
      await approvalRace.send('alice', {
        quoteId: racedApproval.quoteId,
        approvedDetail: JSON.stringify(racedApproval),
      })
    ).status,
    'processing',
    'a stale approval cannot reopen a payment reservation',
  );
  const emailPayload = {
    ...payload,
    linked_accounts: JSON.stringify([
      { type: 'email', address: 'alice@example.com' },
      ...JSON.parse(payload.linked_accounts).filter((a) => a.type === 'wallet'),
    ]),
  };
  const emailWallet = createPrivyWallet({
    store: { ...store, getPrivyAccountUser: async (id) => (id === 'alice' ? user : null) },
    env: { ...env, PRIVY_AUTH_MODE: 'email' },
    fetchImpl,
    verifyIdentity: async () => emailPayload,
    readBalance: async () => 100,
  });
  assert.equal((await emailWallet.config()).authMode, 'email');
  await emailWallet.setup(user, {
    identityToken: 'email-token',
    walletId: 'wallet_alice',
    country: 'SE',
  });
  await assert.rejects(
    emailWallet.setup(
      { ...user, email: 'wrong@example.com' },
      { identityToken: 'email-token', walletId: 'wallet_alice', country: 'SE' },
    ),
    /same email/,
  );
  const emailQuote = await emailWallet.transferQuote('alice', { recipient: other, amount: 1 });
  await emailWallet.prepare('alice', { quoteId: emailQuote.quoteId, confirm: true }, 'email-token');
  const unconfirmed = createPrivyWallet({
    store: { ...store, getPrivyAccountUser: async () => ({ ...user, email_confirmed_at: null }) },
    env: { ...env, PRIVY_AUTH_MODE: 'email' },
    verifyIdentity: async () => emailPayload,
  });
  await assert.rejects(
    unconfirmed.prepare('alice', { quoteId: emailQuote.quoteId, confirm: true }, 'email-token'),
    /same email/,
  );
  assert.equal(
    JSON.stringify([...rows.values(), ...intents.values()]).includes('owner-signature'),
    false,
  );
  console.log(
    'Privy wallet: ownership, signer isolation, exact owner authorization, agent approval, idempotent recovery, Earn risks and expiry passed',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
