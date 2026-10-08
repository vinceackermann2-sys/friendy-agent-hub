const assert = require('node:assert/strict');
const { build } = require('esbuild');
(async () => {
  const result = await build({
    entryPoints: ['app/wallet/review-request.ts'],
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'node',
  });
  const { assertReviewedRequest: review } = await import(
    'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64')
  );
  const now = Date.now(),
    intent = {
      quoteId: 'exact-intent',
      asset: 'USDC',
      chainId: 8453,
      amount: 10,
      kind: 'send',
      address: '0x' + 'b'.repeat(40),
    };
  const request = {
    version: 1,
    method: 'POST',
    url: 'https://api.privy.io/v1/wallets/wallet_alice/transfer',
    headers: {
      'privy-app-id': 'production-app',
      'privy-idempotency-key': intent.quoteId,
      'privy-request-expiry': String(now + 300000),
    },
    body: {
      source: { asset: 'usdc', chain: 'base', amount: '10.00' },
      destination: { asset: 'usdc', chain: 'base', address: intent.address },
    },
  };
  review(request, intent, intent.quoteId, 'production-app', now);
  const rejects = (change) => {
    const r = structuredClone(request);
    change(r);
    assert.throws(
      () => review(r, intent, intent.quoteId, 'production-app', now),
      /reviewed details/,
    );
  };
  rejects((r) => (r.body.destination.address = '0x' + 'c'.repeat(40)));
  rejects((r) => (r.body.source.amount = '11.00'));
  rejects((r) => (r.body.source.chain = 'ethereum'));
  rejects((r) => (r.body.source.asset = 'eth'));
  rejects((r) => (r.body.extra = 'arbitrary data'));
  rejects((r) => (r.headers['privy-app-id'] = 'other-app'));
  rejects((r) => (r.headers['privy-idempotency-key'] = 'new-transfer'));
  rejects((r) => (r.headers['privy-request-expiry'] = String(now - 1)));
  rejects((r) => (r.url = 'https://api.privy.io/v1/wallets/wallet_alice/rpc'));
  rejects((r) => (r.url += '?unreviewed=true'));
  const earn = { ...intent, kind: 'earn_deposit', vaultId: 'reviewed-vault' },
    er = {
      ...request,
      url: 'https://api.privy.io/v1/wallets/wallet_alice/earn/ethereum/deposit',
      body: { vault_id: 'reviewed-vault', amount: '10.00' },
    };
  review(er, earn, intent.quoteId, 'production-app', now);
  const bank = { ...intent, kind: 'bank_withdraw', fiatAccountId: 'bank_alice', bankCurrency: 'EUR', paymentRail: 'sepa' };
  const br = { ...request, url: 'https://api.privy.io/v1/wallets/wallet_alice/payout/fiat',
    body: { source: request.body.source, destination: { fiat_account_id: 'bank_alice', payment_rail: 'sepa' } } };
  review(br, bank, intent.quoteId, 'production-app', now);
  for (const change of [r=>r.body.destination.fiat_account_id='bank_bob',r=>r.body.destination.payment_rail='ach',r=>r.body.destination.address=intent.address,r=>r.body.developer_fee='1']) {
    const r=structuredClone(br);change(r);assert.throws(()=>review(r, bank, intent.quoteId, 'production-app', now));
  }
  assert.throws(() =>
    review(
      { ...er, body: { ...er.body, vault_id: 'unreviewed-vault' } },
      earn,
      intent.quoteId,
      'production-app',
      now,
    ),
  );
  console.log(
    'Privy client review: altered recipient, amount, asset, network, vault, request and expiry cannot be signed',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
