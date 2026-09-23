const assert = require('node:assert/strict');
const { createTokenWallet } = require('../server/token-wallet');
const { PLANS } = require('../server/plans');

(async () => {
  let data = {};
  let seq = 0;
  const wallet = createTokenWallet({
    supa: () => null, loadLocal: () => data, saveLocal: (next) => { data = next; },
    ensureProfile: async () => {}, uid: () => String(++seq), plans: PLANS,
  });
  assert.deepEqual(wallet.freePeriod(new Date('2026-09-23T00:00:00Z')),
    { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z', ref: 'free:2026-09' });
  await wallet.ensureMonthlyTokens('u', 'free');
  await wallet.ensureMonthlyTokens('u', 'free');
  assert.equal((await wallet.tokenWallet('u', 'free')).granted, 50000000, 'free month grants once');
  const claim = await wallet.claimTokenDaily('u', 'image', 1);
  assert.ok(claim);
  assert.equal(await wallet.claimTokenDaily('u', 'image', 1), null);
  await wallet.releaseTokenDaily('u', claim);
  const again = await wallet.claimTokenDaily('u', 'image', 1);
  assert.ok(again);
  await wallet.chargeRawTokens('u', { id: 'use1', model: 'gpt-image-2',
    usage: { promptTokenCount: 100, candidatesTokenCount: 500, totalTokenCount: 600 },
    cost: 0.01, claimId: again });
  assert.equal((await wallet.tokenWallet('u', 'free')).remaining, 49999400);
  await wallet.chargeRawTokens('u', { id: 'use1', model: 'gpt-image-2',
    usage: { promptTokenCount: 100, candidatesTokenCount: 500, totalTokenCount: 600 }, cost: 0.01 });
  assert.equal((await wallet.tokenWallet('u', 'free')).remaining, 49999400, 'replayed usage cannot debit twice');
  await wallet.addTokenGrant('u', 1000000, 'pack', 'pack1');
  assert.equal((await wallet.tokenWallet('u', 'free')).remaining, 50999400);
  assert.equal((await wallet.tokenWallet('u', 'free')).imagesToday, 1, 'successful image uses daily slot');
  console.log('token wallet: monthly grant, charge, pack, daily limits and retry: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
