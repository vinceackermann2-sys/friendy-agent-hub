const assert = require('node:assert/strict');
const { createTokenWallet } = require('../server/token-wallet');
const { PLANS } = require('../server/plans');

(async () => {
  let data = {};
  let seq = 0;
  const wallet = createTokenWallet({
    supa: () => null, loadLocal: () => data, saveLocal: (next) => { data = next; },
    ensureProfile: async () => {}, getSignupAt: async () => '2026-09-23T10:30:00.000Z',
    uid: () => String(++seq), plans: PLANS,
  });
  assert.deepEqual(wallet.freePeriod('2026-01-31T10:30:00.000Z', new Date('2026-02-28T10:29:59Z')),
    { start: '2026-01-31T10:30:00.000Z', end: '2026-02-28T10:30:00.000Z', ref: 'free:2026-01-31T10:30:00.000Z' });
  assert.deepEqual(wallet.freePeriod('2026-01-31T10:30:00.000Z', new Date('2026-02-28T10:30:00Z')),
    { start: '2026-02-28T10:30:00.000Z', end: '2026-03-31T10:30:00.000Z', ref: 'free:2026-02-28T10:30:00.000Z' });
  await wallet.ensureMonthlyTokens('u', 'free');
  await wallet.ensureMonthlyTokens('u', 'free');
  assert.equal((await wallet.tokenWallet('u', 'free')).granted, 50000000, 'free month grants once');
  assert.equal((await wallet.tokenWallet('u', 'free')).resetAt, wallet.freePeriod('2026-09-23T10:30:00.000Z').end);
  assert.equal((await wallet.tokenWallet('paid', 'pro', '2026-10-17T08:00:00.000Z')).resetAt,
    '2026-10-17T08:00:00.000Z', 'paid reset follows the subscription renewal date');
  await wallet.addTokenGrant('upgrade', 50000000, 'plan', 'free:old', new Date(Date.now() + 86400000).toISOString());
  await wallet.addTokenGrant('upgrade', 100000000, 'plan', 'token-subscription:invoice:paid', new Date(Date.now() + 2592000000).toISOString());
  assert.equal((await wallet.tokenWallet('upgrade', 'pro')).planGranted, 100000000,
    'upgrading replaces the free allowance in the paid plan meter');
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
  const now = new Date();
  const legacyMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const legacyEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const legacy = { id: 'legacy', user_id: 'legacy-user', tokens: 50000000, remaining: 49000000,
    reason: 'plan', ref: `free:${legacyMonth.toISOString().slice(0, 7)}`, expires_at: legacyEnd.toISOString() };
  data.tokenGrants.push(legacy);
  const migrated = await wallet.tokenWallet('legacy-user', 'free');
  assert.equal(migrated.planGranted, 50000000, 'legacy grant is migrated without doubling the monthly allowance');
  assert.equal(migrated.planUsed, 1000000, 'legacy spending is preserved');
  assert.equal(legacy.ref, wallet.freePeriod('2026-09-23T10:30:00.000Z').ref);
  console.log('token wallet: monthly grant, charge, pack, daily limits and retry: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
