/* Stripe — real products, Checkout subscriptions, webhooks, portal.
   Products (created once via scripts/setup-stripe.mjs):
   - Pro $30/mo → 60 credits/mo + one $50 gift card (100 credits, first invoice)
   - Max $50/mo → 100 credits/mo + one $100 gift card (200 credits, first invoice)
   Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRO_PRICE_ID,
        STRIPE_MAX_PRICE_ID, SITE_URL (for checkout return URLs).
*/
const { PLANS } = require('./plans');
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
function priceFor(plan) {
  if (plan === 'pro') return (process.env.STRIPE_PRO_PRICE_ID || '').trim() || null;
  if (plan === 'max') return (process.env.STRIPE_MAX_PRICE_ID || '').trim() || null;
  return null;
}
function planForPrice(priceId) {
  if (!priceId) return null;
  if (priceId === (process.env.STRIPE_PRO_PRICE_ID || '').trim()) return 'pro';
  if (priceId === (process.env.STRIPE_MAX_PRICE_ID || '').trim()) return 'max';
  return null;
}
function siteUrl(req) {
  const env = (process.env.SITE_URL || '').replace(/\/$/, '');
  if (env) return env;
  if (req && req.headers && req.headers.origin) return String(req.headers.origin).replace(/\/$/, '');
  if (req) return (req.protocol + '://' + req.get('host')).replace(/\/$/, '');
  return 'http://localhost:8000';
}

async function createCheckout({ userId, email, plan, req }) {
  const s = client();
  if (!s) {
    const e = new Error('Payments are not configured yet (missing STRIPE_SECRET_KEY).');
    e.code = 'NO_STRIPE';
    throw e;
  }
  const price = priceFor(plan);
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
  const sub = await store.getSubscription(userId);
  const origin = siteUrl(req);
  let customerId = sub.stripe_customer_id || null;
  if (!customerId && email) {
    const found = await s.customers.list({ email, limit: 1 });
    if (found.data.length) customerId = found.data[0].id;
  }
  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    ...(customerId ? { customer: customerId } : { customer_email: email || undefined }),
    client_reference_id: userId,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { user_id: userId, plan } },
    metadata: { user_id: userId, plan },
    success_url: origin + '/?billing=success&plan=' + plan,
    cancel_url: origin + '/?billing=cancelled',
    allow_promotion_codes: true,
  });
  // Remember customer mapping early so webhooks can find the user.
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

// Grant monthly credits for an active subscription (idempotent per period).
async function grantSubscriptionCredits(userId, plan, periodRef) {
  const p = PLANS[plan];
  if (!p) return null;
  await store.ensureFreeGrant(userId);
  const ref = periodRef ? `${plan}:${periodRef}` : `${plan}:${Date.now()}`;
  if (await store.hasGrantRef(userId, ref)) return null;
  return store.addGrant(userId, p.credits, 'subscription', ref);
}

async function issueFirstInvoiceGift(userId, plan) {
  const p = PLANS[plan];
  if (!p || !p.giftUsd) return null;
  const sub = await store.getSubscription(userId);
  if (sub.gift_issued) return null;
  const gift = await store.createGift('stripe:' + plan, p.giftUsd);
  await store.setSubscription(userId, plan, sub.status || 'active', {
    stripe_customer_id: sub.stripe_customer_id,
    stripe_subscription_id: sub.stripe_subscription_id,
    current_period_end: sub.current_period_end,
    gift_issued: true,
  });
  return gift;
}

module.exports = { client, isConfigured, priceFor, planForPrice, createCheckout, createPortal, grantSubscriptionCredits, issueFirstInvoiceGift };
