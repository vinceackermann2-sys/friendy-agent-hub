const assert = require('node:assert/strict');
const Module = require('node:module');
const plans = require('../server/plans');
process.env.STRIPE_PRO_PRICE_ID = 'price_pro_test';

for (const pack of plans.CREDIT_PACKS) {
  const providerCostAtZero = pack.credits / plans.creditsForCost(1);
  assert.ok(1 - providerCostAtZero / pack.usd >= 0.6 - 1e-9,
    `${pack.credits} credits must retain at least 60% gross margin on metered cost`);
}
assert.deepEqual(plans.TOKEN_PACKS.map(({ millions, usd }) => [millions, usd]),
  [[10,15],[20,25],[30,35],[50,55],[75,85],[100,105],[500,500]]);
assert.equal(plans.tokenPackFor(1_000_000), null);
assert.equal(plans.tokenPackFor(5_000_000), null);
for (const pack of plans.TOKEN_PACKS) {
  const mixedCost = pack.millions * (0.94 * 0.18 + 0.01 * (0.9 * 2.5 + 0.1 * 10) + 0.05 * 15);
  const cardFee = pack.usd * 0.029 + 0.30;
  assert.ok(pack.usd - cardFee - mixedCost > 0,
    `${pack.millions}M token pack loses money in the modeled 5% image mix`);
}
assert.ok(plans.costOf({ model: 'gpt-5.6-luna', input_tokens: 1e6, output_tokens: 1e6 })
  > plans.costOf({ model: 'gpt-6-luna', input_tokens: 1e6, output_tokens: 1e6 }));
assert.ok(plans.costOf({ model: 'gpt-6-luna', input_tokens: 272001, output_tokens: 1 })
  > 2 * plans.costOf({ model: 'gpt-6-luna', input_tokens: 272000, output_tokens: 1 }) - 0.001);

const grants = [];
const tokenGrants = [];
const gifts = [];
const subs = new Map();
const store = {
  ensureFreeGrant: async () => {},
  hasGrantRef: async (userId, ref) => grants.some((g) => g.userId === userId && g.ref === ref),
  addGrant: async (userId, credits, reason, ref) => {
    if (grants.some((g) => g.userId === userId && g.ref === ref)) return null;
    const row = { userId, credits, reason, ref }; grants.push(row); return row;
  },
  addTokenGrant: async (userId, tokens, reason, ref, expiresAt) => {
    if (tokenGrants.some((g) => g.userId === userId && g.ref === ref)) return false;
    tokenGrants.push({ userId, tokens, reason, ref, expiresAt }); return true;
  },
  getSubscription: async (userId) => subs.get(userId) || { plan: 'free', status: 'active' },
  setSubscription: async (userId, plan, status, extra) => {
    subs.set(userId, { ...(subs.get(userId) || {}), plan, status, ...extra });
  },
  findGiftByFrom: async (source) => gifts.find((g) => g.from_user === source) || null,
  createGift: async (source, amount, purchasedBy) => {
    const row = { code: `LNG-${gifts.length}`, from_user: source, amount_usd: amount, purchased_by: purchasedBy };
    gifts.push(row); return row;
  },
};
const oldLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === './store' && /[\\/]server[\\/]stripe\.js$/.test(parent?.filename || '')) return store;
  return oldLoad.call(this, name, parent, isMain);
};
const stripe = require('../server/stripe');
Module._load = oldLoad;

(async () => {
  const base = { id: 'cs_credit', mode: 'payment', status: 'complete', currency: 'usd',
    client_reference_id: 'u1', metadata: { kind: 'credits', user_id: 'u1', pack_credits: '50' }, amount_total: 1500 };
  assert.deepEqual(await stripe.fulfillCheckout({ ...base, payment_status: 'unpaid' }), { ok: false });
  assert.deepEqual(await stripe.fulfillCheckout({ ...base, payment_status: 'paid', amount_total: 100 }), { ok: false });
  await stripe.fulfillCheckout({ ...base, payment_status: 'paid' });
  await stripe.fulfillCheckout({ ...base, payment_status: 'paid' });
  assert.equal(grants.filter((g) => g.reason === 'credit_pack').length, 1);

  const tokenPack = plans.TOKEN_PACKS[0];
  const tokenSession = { id: 'cs_tokens', mode: 'payment', status: 'complete', payment_status: 'paid',
    currency: 'usd', client_reference_id: 'u1', metadata: { kind: 'tokens', user_id: 'u1', pack_tokens: String(tokenPack.tokens) },
    amount_total: tokenPack.usd * 100 };
  assert.deepEqual(await stripe.fulfillCheckout({ ...tokenSession, amount_total: 1 }), { ok: false });
  await stripe.fulfillCheckout(tokenSession);
  await stripe.fulfillCheckout(tokenSession);
  assert.equal(tokenGrants.filter((g) => g.reason === 'pack').length, 1);

  const gift = { id: 'cs_gift', mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'usd',
    client_reference_id: 'u1', metadata: { kind: 'gift', user_id: 'u1', amount_usd: '50' }, amount_total: 5000 };
  assert.equal((await stripe.fulfillCheckout(gift)).gift.purchased_by, 'u1');
  await stripe.fulfillCheckout(gift);
  assert.equal(gifts.length, 1);

  const subscription = { id: 'cs_sub', mode: 'subscription', status: 'complete', payment_status: 'paid', currency: 'usd',
    client_reference_id: 'u1', metadata: { kind: 'subscription', user_id: 'u1', plan: 'pro' },
    amount_total: 5000, customer: 'cus_1', subscription: 'sub_1', invoice: 'in_1' };
  await stripe.fulfillCheckout(subscription);
  const api = { subscriptions: { retrieve: async () => ({ id: 'sub_1', customer: 'cus_1',
    metadata: { user_id: 'u1', plan: 'pro' }, current_period_end: 1790000000,
    items: { data: [{ price: { id: 'price_pro_test' } }] } }) } };
  await stripe.fulfillInvoice(api, { id: 'in_1', status: 'paid', currency: 'usd', amount_paid: 5000,
    customer: 'cus_1', subscription: 'sub_1' });
  assert.equal(tokenGrants.filter((g) => g.reason === 'plan').length, 1,
    'checkout and invoice for the same payment must grant only once');
  await stripe.fulfillInvoice(api, { id: 'in_2', status: 'paid', currency: 'usd', amount_paid: 5000,
    customer: 'cus_1', subscription: 'sub_1' });
  assert.equal(tokenGrants.filter((g) => g.reason === 'plan').length, 2);
  assert.deepEqual(await stripe.fulfillInvoice(api, { id: 'in_3', status: 'paid', currency: 'usd', amount_paid: 0,
    customer: 'cus_1', subscription: 'sub_1' }), { ok: false, reason: 'underpaid' });

  // Exercise the buyer-facing Checkout payload without contacting Stripe.
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_TOKENS_10M_PRICE_ID = 'price_token_10m';
  const created = [];
  const mockStripe = {
    customers: { list: async () => ({ data: [] }) },
    checkout: { sessions: { create: async (payload) => {
      created.push(payload);
      return { id: 'cs_mock', url: 'https://checkout.stripe.com/mock' };
    } } },
  };
  Module._load = function (name, parent, isMain) {
    if (name === 'stripe') return () => mockStripe;
    return oldLoad.call(this, name, parent, isMain);
  };
  try {
    await stripe.createTokenCheckout({ userId: 'u2', email: 'buyer@example.com',
      packTokens: tokenPack.tokens });
    assert.equal(created[0].mode, 'payment');
    assert.deepEqual(created[0].line_items, [{ price: 'price_token_10m', quantity: 1 }]);
    assert.equal(created[0].metadata.pack_tokens, '10000000');
    await assert.rejects(stripe.createTokenCheckout({ userId: 'u2', email: 'buyer@example.com',
      packTokens: 1_000_000 }), { code: 'BAD_PLAN' });
    await stripe.createCheckout({ userId: 'u2', email: 'buyer@example.com', plan: 'pro' });
    assert.equal(created[1].mode, 'subscription');
    assert.deepEqual(created[1].line_items, [{ price: 'price_pro_test', quantity: 1 }]);
    assert.match(created[1].success_url, /\/\?billing=success&/, 'web checkouts return to the site');
    // Checkouts from the Apple app finish in the browser and hand back to the app.
    await stripe.createTokenCheckout({ userId: 'u2', email: 'buyer@example.com', packTokens: tokenPack.tokens, returnTo: 'app' });
    assert.match(created[2].success_url, /\/app-return\?billing=tokens&session_id=/);
    assert.match(created[2].cancel_url, /\/app-return\?billing=cancelled$/);
    await stripe.createCheckout({ userId: 'u2', email: 'buyer@example.com', plan: 'pro', returnTo: 'app' });
    assert.match(created[3].success_url, /\/app-return\?billing=success&/);
  } finally {
    Module._load = oldLoad;
  }
  console.log('billing checkout: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
