/* Stripe — real products, Checkout subscriptions, credit packs, gift cards.
   Products (created via scripts/setup-stripe.mjs):
   - Pro $50/mo / Max $100/mo (promo $30 / $50 kept for the pre-lander)
   - Extra credit packs (one-time)
   - Gift cards $50 / $100 (one-time)
*/
const { PLANS, PRELANDER_OFFERS, creditPackFor, GIFT_AMOUNTS } = require('./plans');
const store = require('./store');

let stripe = null;
function client() {
  if (stripe) return stripe;
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) return null;
  stripe = require('stripe')(key);
  return stripe;
}
function isConfigured() {
  return !!(process.env.STRIPE_SECRET_KEY || '').trim();
}
function env(name) {
  return (process.env[name] || '').trim() || null;
}
function priceFor(plan, promo) {
  if (plan === 'pro') return env(promo ? 'STRIPE_PRO_PROMO_PRICE_ID' : 'STRIPE_PRO_PRICE_ID');
  if (plan === 'max') return env(promo ? 'STRIPE_MAX_PROMO_PRICE_ID' : 'STRIPE_MAX_PRICE_ID');
  return null;
}
function planForPrice(priceId) {
  if (!priceId) return null;
  if (priceId === env('STRIPE_PRO_PRICE_ID') || priceId === env('STRIPE_PRO_PROMO_PRICE_ID')) return 'pro';
  if (priceId === env('STRIPE_MAX_PRICE_ID') || priceId === env('STRIPE_MAX_PROMO_PRICE_ID')) return 'max';
  return null;
}
function priceForCredits(credits) {
  const pack = creditPackFor(credits);
  if (!pack) return null;
  return env(`STRIPE_CREDITS_${pack.credits}_PRICE_ID`);
}
function priceForGift(amountUsd) {
  const amount = Number(amountUsd || 0);
  if (!GIFT_AMOUNTS.includes(amount)) return null;
  return env(`STRIPE_GIFT_${amount}_PRICE_ID`);
}
function siteUrl(req) {
  const origin = (process.env.SITE_URL || '').replace(/\/$/, '');
  if (origin) return origin;
  if (req && req.headers && req.headers.origin) return String(req.headers.origin).replace(/\/$/, '');
  if (req) return (req.protocol + '://' + req.get('host')).replace(/\/$/, '');
  return 'http://localhost:8000';
}

async function ensureCustomer({ userId, email }) {
  const s = client();
  const sub = await store.getSubscription(userId);
  let customerId = sub.stripe_customer_id || null;
  if (!customerId && email) {
    const found = await s.customers.list({ email, limit: 1 });
    if (found.data.length) customerId = found.data[0].id;
  }
  return { sub, customerId };
}

async function createCheckout({ userId, email, plan, extraCredits, promo, req }) {
  const s = client();
  if (!s) {
    const e = new Error('Payments are not configured yet (missing STRIPE_SECRET_KEY).');
    e.code = 'NO_STRIPE';
    throw e;
  }
  const usePromo = promo === true || promo === '1' || promo === 'true';
  const price = priceFor(plan, usePromo);
  if (!PLANS[plan] || plan === 'free') {
    const e = new Error('Choose pro or max.');
    e.code = 'BAD_PLAN';
    throw e;
  }
  if (!price) {
    const e = new Error(`No Stripe price configured for ${plan} (run scripts/setup-stripe.mjs).`);
    e.code = 'NO_PRICE';
    throw e;
  }
  const pack = creditPackFor(extraCredits);
  const line_items = [{ price, quantity: 1 }];
  if (pack) {
    const packPrice = priceForCredits(pack.credits);
    if (!packPrice) {
      const e = new Error(`No Stripe price configured for ${pack.credits} credits (run scripts/setup-stripe.mjs).`);
      e.code = 'NO_PRICE';
      throw e;
    }
    line_items.push({ price: packPrice, quantity: 1 });
  }
  const { sub, customerId } = await ensureCustomer({ userId, email });
  const origin = siteUrl(req);
  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    ...(customerId ? { customer: customerId } : { customer_email: email || undefined }),
    client_reference_id: userId,
    line_items,
    subscription_data: { metadata: { user_id: userId, plan, promo: usePromo ? '1' : '' } },
    metadata: {
      kind: 'subscription',
      user_id: userId,
      plan,
      extra_credits: pack ? String(pack.credits) : '',
      promo: usePromo ? '1' : '',
    },
    success_url: origin + '/?billing=success&session_id={CHECKOUT_SESSION_ID}&plan=' + plan,
    cancel_url: origin + '/?billing=cancelled',
    allow_promotion_codes: true,
  });
  if (typeof session.customer === 'string' && session.customer) {
    try { await store.setSubscription(userId, sub.plan || 'free', sub.status || 'active', { stripe_customer_id: session.customer }); } catch {}
  }
  return session;
}

async function createCreditsCheckout({ userId, email, packCredits, req }) {
  const s = client();
  if (!s) {
    const e = new Error('Payments are not configured yet.');
    e.code = 'NO_STRIPE';
    throw e;
  }
  const pack = creditPackFor(packCredits);
  const price = pack && priceForCredits(pack.credits);
  if (!pack || !price) {
    const e = new Error('Choose a credit pack.');
    e.code = 'BAD_PLAN';
    throw e;
  }
  const { sub, customerId } = await ensureCustomer({ userId, email });
  const origin = siteUrl(req);
  const session = await s.checkout.sessions.create({
    mode: 'payment',
    ...(customerId ? { customer: customerId } : { customer_email: email || undefined }),
    client_reference_id: userId,
    line_items: [{ price, quantity: 1 }],
    metadata: { kind: 'credits', user_id: userId, pack_credits: String(pack.credits) },
    success_url: origin + '/?billing=credits&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: origin + '/?billing=cancelled',
    allow_promotion_codes: true,
  });
  if (typeof session.customer === 'string' && session.customer) {
    try { await store.setSubscription(userId, sub.plan || 'free', sub.status || 'active', { stripe_customer_id: session.customer }); } catch {}
  }
  return session;
}

async function createGiftCheckout({ userId, email, amountUsd, req }) {
  const s = client();
  if (!s) {
    const e = new Error('Payments are not configured yet.');
    e.code = 'NO_STRIPE';
    throw e;
  }
  const amount = Number(amountUsd || 0);
  const price = priceForGift(amount);
  if (!price) {
    const e = new Error('Gift amount must be 50 or 100.');
    e.code = 'BAD_PLAN';
    throw e;
  }
  const { sub, customerId } = await ensureCustomer({ userId, email });
  const origin = siteUrl(req);
  const session = await s.checkout.sessions.create({
    mode: 'payment',
    ...(customerId ? { customer: customerId } : { customer_email: email || undefined }),
    client_reference_id: userId,
    line_items: [{ price, quantity: 1 }],
    metadata: { kind: 'gift', user_id: userId, amount_usd: String(amount) },
    success_url: origin + '/?billing=gift&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: origin + '/?billing=cancelled',
    allow_promotion_codes: true,
  });
  if (typeof session.customer === 'string' && session.customer) {
    try { await store.setSubscription(userId, sub.plan || 'free', sub.status || 'active', { stripe_customer_id: session.customer }); } catch {}
  }
  return session;
}

async function createPortal({ userId, req }) {
  const s = client();
  if (!s) {
    const e = new Error('Payments are not configured yet.');
    e.code = 'NO_STRIPE';
    throw e;
  }
  const sub = await store.getSubscription(userId);
  if (!sub.stripe_customer_id) {
    const e = new Error('No Stripe subscription yet — pick a plan first.');
    e.code = 'NO_CUSTOMER';
    throw e;
  }
  const portal = await s.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: siteUrl(req) + '/?billing=portal',
  });
  return portal;
}

async function grantSubscriptionCredits(userId, plan, periodRef) {
  const p = PLANS[plan];
  if (!p) return null;
  await store.ensureFreeGrant(userId);
  const ref = periodRef ? `${plan}:${periodRef}` : `${plan}:${Date.now()}`;
  if (await store.hasGrantRef(userId, ref)) return null;
  return store.addGrant(userId, p.credits, 'subscription', ref);
}

async function issueFirstInvoiceGift(userId, plan, promo) {
  const offer = (promo ? PRELANDER_OFFERS[plan] : null) || PLANS[plan];
  const giftUsd = offer && offer.giftUsd;
  if (!giftUsd) return null;
  const sub = await store.getSubscription(userId);
  if (sub.gift_issued) return null;
  const gift = await store.createGift('stripe:' + plan, giftUsd);
  await store.setSubscription(userId, plan, sub.status || 'active', {
    stripe_customer_id: sub.stripe_customer_id,
    stripe_subscription_id: sub.stripe_subscription_id,
    current_period_end: sub.current_period_end,
    gift_issued: true,
  });
  return gift;
}

async function fulfillCheckout(session) {
  const meta = (session && session.metadata) || {};
  const userId = meta.user_id || session.client_reference_id || null;
  const paid = session.payment_status === 'paid' || session.status === 'complete';
  if (!userId || !paid) return { ok: false };
  const kind = meta.kind || (meta.plan ? 'subscription' : '');
  if (kind === 'gift') {
    const amount = Number(meta.amount_usd || 0);
    let gift = await store.findGiftByFrom('stripe:' + session.id);
    if (!gift && amount) gift = await store.createGift('stripe:' + session.id, amount);
    return { ok: true, kind, gift };
  }
  if (kind === 'credits') {
    const credits = Number(meta.pack_credits || 0);
    const ref = 'credits:' + session.id;
    if (credits && !(await store.hasGrantRef(userId, ref))) {
      await store.ensureFreeGrant(userId);
      await store.addGrant(userId, credits, 'credit_pack', ref);
    }
    return { ok: true, kind, credits };
  }
  const plan = meta.plan || null;
  if (plan && PLANS[plan] && plan !== 'free') {
    const customerId = typeof session.customer === 'string' ? session.customer : (session.customer && session.customer.id) || null;
    const subId = typeof session.subscription === 'string' ? session.subscription : (session.subscription && session.subscription.id) || null;
    const prev = await store.getSubscription(userId);
    await store.setSubscription(userId, plan, 'active', {
      stripe_customer_id: customerId || prev.stripe_customer_id,
      stripe_subscription_id: subId || prev.stripe_subscription_id,
      gift_issued: prev.gift_issued,
    });
    await grantSubscriptionCredits(userId, plan, subId ? `start:${subId}` : `start:${session.id}`);
    const extra = Number(meta.extra_credits || 0);
    if (extra) {
      const ref = 'extra:' + session.id;
      if (!(await store.hasGrantRef(userId, ref))) {
        await store.addGrant(userId, extra, 'credit_pack', ref);
      }
    }
    if (meta.promo === '1') {
      const gift = await issueFirstInvoiceGift(userId, plan, true);
      return { ok: true, kind: 'subscription', plan, extra, gift };
    }
    return { ok: true, kind: 'subscription', plan, extra };
  }
  return { ok: true, kind };
}

async function loadSession(sessionId) {
  const s = client();
  if (!s || !sessionId) return null;
  return s.checkout.sessions.retrieve(sessionId);
}

module.exports = {
  client, isConfigured, priceFor, planForPrice, priceForCredits, priceForGift,
  createCheckout, createCreditsCheckout, createGiftCheckout, createPortal,
  grantSubscriptionCredits, issueFirstInvoiceGift, fulfillCheckout, loadSession,
};
