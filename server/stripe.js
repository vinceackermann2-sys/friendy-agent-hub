/* Stripe — real products, Checkout subscriptions, credit packs, gift cards.
   Products (created via scripts/setup-stripe.mjs):
   - Pro $50/mo / Max $100/mo (promo $30 / $50 kept for the pre-lander)
   - Extra credit packs (one-time)
   - Gift cards $50 / $100 (one-time)
*/
const { PLANS, PRELANDER_OFFERS, creditPackFor, tokenPackFor, GIFT_AMOUNTS } = require('./plans');
const store = require('./store');

let stripe = null;
function subtleCryptoProvider() { return require('stripe').createSubtleCryptoProvider(); }
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
function priceForTokens(tokens) {
  const pack = tokenPackFor(tokens);
  return pack ? env(`STRIPE_TOKENS_${pack.millions}M_PRICE_ID`) : null;
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

async function createCheckout({ userId, email, plan, extraCredits, extraTokens, promo, req }) {
  const s = client();
  if (!s) {
    const e = new Error('Payments are not configured yet (missing STRIPE_SECRET_KEY).');
    e.code = 'NO_STRIPE';
    throw e;
  }
  // Public checkout cannot self-select a legacy discount with a request flag.
  const usePromo = false;
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
  if (Number(extraCredits || 0) && !pack) throw Object.assign(new Error('Choose a valid credit pack.'), { code: 'BAD_PLAN' });
  if (pack) throw Object.assign(new Error('Credit packs have moved to token packs. Choose a token pack under Billing.'), { code: 'BAD_PLAN' });
  const tokenPack = tokenPackFor(extraTokens);
  if (Number(extraTokens || 0) && !tokenPack) throw Object.assign(new Error('Choose a valid token pack.'), { code: 'BAD_PLAN' });
  if (pack && tokenPack) throw Object.assign(new Error('Choose one add-on pack.'), { code: 'BAD_PLAN' });
  const { sub, customerId } = await ensureCustomer({ userId, email });
  if (sub.stripe_subscription_id && !['canceled', 'incomplete_expired'].includes(sub.status)) {
    if (pack || tokenPack) throw Object.assign(new Error('Change your plan in the subscription portal, then buy extra tokens separately.'), { code: 'BAD_PLAN' });
    return s.billingPortal.sessions.create({
      customer: customerId || sub.stripe_customer_id,
      return_url: siteUrl(req) + '/?billing=portal',
      flow_data: { type: 'subscription_update', subscription_update: { subscription: sub.stripe_subscription_id } },
    });
  }
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
  if (tokenPack) {
    const tokenPrice = priceForTokens(tokenPack.tokens);
    if (!tokenPrice) throw Object.assign(new Error('Token pack Stripe price is not configured.'), { code: 'NO_PRICE' });
    line_items.push({ price: tokenPrice, quantity: 1 });
  }
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
      extra_tokens: tokenPack ? String(tokenPack.tokens) : '',
      promo: usePromo ? '1' : '',
    },
    success_url: origin + '/?billing=success&session_id={CHECKOUT_SESSION_ID}&plan=' + plan,
    cancel_url: origin + '/?billing=cancelled',
  });
  if (typeof session.customer === 'string' && session.customer) {
    try { await store.setSubscription(userId, sub.plan || 'free', sub.status || 'active', { stripe_customer_id: session.customer }); } catch {}
  }
  return session;
}

async function createTokenCheckout({ userId, email, packTokens, req }) {
  const s = client();
  if (!s) throw Object.assign(new Error('Payments are not configured yet.'), { code: 'NO_STRIPE' });
  const pack = tokenPackFor(packTokens);
  const price = pack && priceForTokens(pack.tokens);
  if (!pack) throw Object.assign(new Error('Choose a token pack.'), { code: 'BAD_PLAN' });
  if (!price) throw Object.assign(new Error('Token pack Stripe price is not configured.'), { code: 'NO_PRICE' });
  const { sub, customerId } = await ensureCustomer({ userId, email });
  const origin = siteUrl(req);
  const session = await s.checkout.sessions.create({
    mode: 'payment',
    ...(customerId ? { customer: customerId } : { customer_email: email || undefined }),
    client_reference_id: userId,
    line_items: [{ price, quantity: 1 }],
    metadata: { kind: 'tokens', user_id: userId, pack_tokens: String(pack.tokens) },
    success_url: origin + '/?billing=tokens&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: origin + '/?billing=cancelled',
  });
  if (typeof session.customer === 'string' && session.customer) {
    try { await store.setSubscription(userId, sub.plan || 'free', sub.status || 'active', { stripe_customer_id: session.customer }); } catch {}
  }
  return session;
}

async function createCreditsCheckout() {
  throw Object.assign(new Error('Credit packs have moved to token packs. Choose a token pack under Billing.'), { code: 'BAD_PLAN' });
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
  if (!p || plan === 'free' || !periodRef) return null;
  await store.ensureFreeGrant(userId);
  const ref = `subscription:${periodRef}`;
  if (await store.hasGrantRef(userId, ref)) return null;
  return store.addGrant(userId, p.credits, 'subscription', ref);
}
async function grantSubscriptionTokens(userId, plan, periodRef, periodEnd) {
  const p = PLANS[plan];
  if (!p || plan === 'free' || !periodRef) return null;
  const expiry = periodEnd ? new Date(periodEnd).toISOString() : new Date(Date.now() + 31 * 86400000).toISOString();
  return store.addTokenGrant(userId, p.tokens, 'plan', `token-subscription:${periodRef}`, expiry);
}
function subscriptionPeriodEnd(remote, invoice = null) {
  const period = remote?.current_period_end || remote?.items?.data?.[0]?.current_period_end
    || invoice?.lines?.data?.find((line) => line?.period?.end)?.period?.end;
  return period ? new Date(Number(period) * 1000).toISOString() : null;
}

async function issueFirstInvoiceGift(userId, plan, promo) {
  const offer = (promo ? PRELANDER_OFFERS[plan] : null) || PLANS[plan];
  const giftUsd = offer && offer.giftUsd;
  if (!giftUsd) return null;
  const sub = await store.getSubscription(userId);
  if (sub.gift_issued) return null;
  const source = 'promo:' + (sub.stripe_subscription_id || userId + ':' + plan);
  let gift = await store.findGiftByFrom(source);
  if (!gift) {
    try { gift = await store.createGift(source, giftUsd, userId); }
    catch (error) {
      gift = await store.findGiftByFrom(source);
      if (!gift) throw error;
    }
  }
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
  if (!userId || session.payment_status !== 'paid' || session.status !== 'complete' || session.currency !== 'usd') return { ok: false };
  const kind = meta.kind || (meta.plan ? 'subscription' : '');
  if (kind === 'gift') {
    const amount = Number(meta.amount_usd || 0);
    if (!GIFT_AMOUNTS.includes(amount) || session.mode !== 'payment' || session.amount_total < amount * 100) return { ok: false };
    let gift = await store.findGiftByFrom('stripe:' + session.id);
    if (!gift && amount) gift = await store.createGift('stripe:' + session.id, amount, userId);
    return { ok: true, kind, gift };
  }
  if (kind === 'credits') {
    const credits = Number(meta.pack_credits || 0);
    const pack = creditPackFor(credits);
    if (!pack || session.mode !== 'payment' || session.amount_total < pack.usd * 100) return { ok: false };
    const ref = 'credits:' + session.id;
    if (credits && !(await store.hasGrantRef(userId, ref))) {
      await store.ensureFreeGrant(userId);
      await store.addGrant(userId, credits, 'credit_pack', ref);
    }
    await store.addTokenGrant(userId, Math.floor(credits * 3333), 'legacy_pack', 'token-legacy:' + session.id);
    return { ok: true, kind, credits };
  }
  if (kind === 'tokens') {
    const tokens = Number(meta.pack_tokens || 0);
    const pack = tokenPackFor(tokens);
    if (!pack || session.mode !== 'payment' || session.amount_total < pack.usd * 100) return { ok: false };
    await store.addTokenGrant(userId, tokens, 'pack', 'token-pack:' + session.id);
    return { ok: true, kind, tokens };
  }
  const plan = meta.plan || null;
  if (plan && PLANS[plan] && plan !== 'free') {
    const promo = meta.promo === '1';
    const pack = creditPackFor(meta.extra_credits);
    const tokenPack = tokenPackFor(meta.extra_tokens);
    const extra = Number(meta.extra_credits || 0);
    const extraTokens = Number(meta.extra_tokens || 0);
    const expected = ((promo ? PRELANDER_OFFERS[plan]?.price : PLANS[plan].price) + (pack?.usd || 0) + (tokenPack?.usd || 0)) * 100;
    if (session.mode !== 'subscription' || (extra && !pack) || (extraTokens && !tokenPack)
      || !Number.isFinite(expected) || session.amount_total < expected) return { ok: false };
    const customerId = typeof session.customer === 'string' ? session.customer : (session.customer && session.customer.id) || null;
    const subId = typeof session.subscription === 'string' ? session.subscription : (session.subscription && session.subscription.id) || null;
    const prev = await store.getSubscription(userId);
    await store.setSubscription(userId, plan, 'active', {
      stripe_customer_id: customerId || prev.stripe_customer_id,
      stripe_subscription_id: subId || prev.stripe_subscription_id,
      gift_issued: prev.gift_issued,
    });
    const invoiceId = typeof session.invoice === 'string' ? session.invoice : session.invoice?.id;
    if (invoiceId) {
      const stripeClient = client();
      const remote = subId && stripeClient ? await stripeClient.subscriptions.retrieve(subId) : null;
      const end = subscriptionPeriodEnd(remote);
      await grantSubscriptionTokens(userId, plan, `invoice:${invoiceId}`, end);
    }
    if (extra) {
      const ref = 'extra:' + session.id;
      if (!(await store.hasGrantRef(userId, ref))) {
        await store.addGrant(userId, extra, 'credit_pack', ref);
      }
      await store.addTokenGrant(userId, Math.floor(extra * 3333), 'legacy_pack', 'token-legacy-extra:' + session.id);
    }
    if (extraTokens) await store.addTokenGrant(userId, extraTokens, 'pack', 'token-extra:' + session.id);
    if (promo) {
      const gift = await issueFirstInvoiceGift(userId, plan, true);
      return { ok: true, kind: 'subscription', plan, extra, gift };
    }
    return { ok: true, kind: 'subscription', plan, extra };
  }
  return { ok: true, kind };
}

async function fulfillInvoice(s, invoice) {
  if (!invoice || invoice.status !== 'paid' || invoice.currency !== 'usd') return { ok: false };
  const parent = invoice.parent?.subscription_details || {};
  const subId = (typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id)
    || (typeof parent.subscription === 'string' ? parent.subscription : parent.subscription?.id);
  if (!subId) return { ok: false };
  const remote = await s.subscriptions.retrieve(subId);
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  const userId = remote.metadata?.user_id || (customerId && await store.findUserByStripeCustomer(customerId));
  const priceId = remote.items?.data?.[0]?.price?.id;
  const plan = planForPrice(priceId);
  if (!userId || !PLANS[plan] || plan === 'free') return { ok: false };
  const remoteCustomer = typeof remote.customer === 'string' ? remote.customer : remote.customer?.id;
  if (!customerId || customerId !== remoteCustomer) return { ok: false };
  const promo = priceId === priceFor(plan, true);
  const minPaid = (promo ? PRELANDER_OFFERS[plan]?.price : PLANS[plan].price) * 100;
  if (!Number.isFinite(minPaid) || invoice.amount_paid < minPaid) return { ok: false, reason: 'underpaid' };
  const prev = await store.getSubscription(userId);
  await store.setSubscription(userId, plan, 'active', {
    stripe_customer_id: customerId,
    stripe_subscription_id: subId,
    current_period_end: subscriptionPeriodEnd(remote, invoice) || prev.current_period_end,
    gift_issued: prev.gift_issued,
  });
  await grantSubscriptionTokens(userId, plan, `invoice:${invoice.id}`,
    subscriptionPeriodEnd(remote, invoice));
  if (promo) await issueFirstInvoiceGift(userId, plan, true);
  return { ok: true, userId, plan };
}

async function loadSession(sessionId) {
  const s = client();
  if (!s || !sessionId) return null;
  return s.checkout.sessions.retrieve(sessionId);
}

module.exports = {
  client, subtleCryptoProvider, isConfigured, priceFor, planForPrice, priceForCredits, priceForTokens, priceForGift,
  createCheckout, createCreditsCheckout, createTokenCheckout, createGiftCheckout, createPortal,
  grantSubscriptionCredits, grantSubscriptionTokens, issueFirstInvoiceGift, fulfillCheckout, fulfillInvoice, loadSession,
};
