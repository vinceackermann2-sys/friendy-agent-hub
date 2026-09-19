/* Stripe Issuing — one-time virtual cards for approved agent purchases.
   PAN/CVC never go to the model. The owner can reveal them via Stripe Elements. */
const store = require('./store');

function secret() { return String(process.env.STRIPE_SECRET_KEY || process.env.LINGON_STRIPE_SECRET_KEY || '').trim(); }
function publishable() {
  return String(process.env.STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PK || process.env.LINGON_STRIPE_PUBLISHABLE_KEY || '').trim();
}
function client() {
  const key = secret();
  if (!key) return null;
  return require('stripe')(key);
}
function configured() { return !!secret(); }
function testMode() { return secret().startsWith('sk_test_'); }

function issuingError(e, fallback) {
  const msg = String((e && e.message) || fallback || 'Stripe Issuing failed.');
  const out = new Error(/issuing/i.test(msg) && /not enabled|permission/i.test(msg)
    ? 'Stripe Issuing is not enabled on this Stripe account. Turn it on in Stripe Dashboard → Issuing.'
    : msg.slice(0, 400));
  out.code = e && e.code === 'NEED_BILLING' ? 'NEED_BILLING' : (e && e.statusCode === 400 ? 'ISSUING' : 'ISSUING');
  out.status = e && e.statusCode || 502;
  return out;
}

function splitName(name) {
  const parts = String(name || 'Agent').trim().split(/\s+/);
  return { first: parts[0] || 'Agent', last: parts.slice(1).join(' ') || 'Wallet' };
}

async function userEmail(userId) {
  try {
    const { adminClient } = require('./auth');
    const admin = adminClient();
    if (!admin) return null;
    const { data } = await admin.auth.admin.getUserById(userId);
    return (data && data.user && data.user.email) || null;
  } catch {
    return null;
  }
}

function billingFrom(card) {
  const b = (card && card.billing) || {};
  const line1 = String(b.line1 || '').trim();
  const city = String(b.city || '').trim();
  const postal = String(b.postal || b.postal_code || '').trim();
  const country = String(b.country || 'US').trim().toUpperCase().slice(0, 2);
  if (line1 && city && postal && country) {
    return {
      line1,
      city,
      state: String(b.state || '').trim() || undefined,
      postal_code: postal,
      country,
    };
  }
  if (testMode()) {
    return { line1: '123 Market St', city: 'San Francisco', state: 'CA', postal_code: '94111', country: 'US' };
  }
  return null;
}

async function ensureCardholder(userId, { name, email } = {}) {
  const s = client();
  if (!s) {
    const e = new Error('Stripe is not configured (STRIPE_SECRET_KEY).');
    e.code = 'NO_STRIPE';
    throw e;
  }
  const row = await store.getAgentWallet(userId);
  if (row && row.stripeCardholderId) return row.stripeCardholderId;
  const addr = billingFrom(row && row.card);
  if (!addr) {
    const e = new Error('Add a billing address under Wallet → Card before issuing a virtual card.');
    e.code = 'NEED_BILLING';
    throw e;
  }
  const who = splitName(name || (row && row.card && row.card.holderName) || 'Agent');
  const mail = email || await userEmail(userId) || undefined;
  try {
    const holder = await s.issuing.cardholders.create({
      type: 'individual',
      name: `${who.first} ${who.last}`.trim(),
      email: mail,
      status: 'active',
      billing: { address: addr },
      individual: { first_name: who.first, last_name: who.last },
      metadata: { user_id: String(userId) },
    });
    await store.upsertAgentWallet(userId, { stripeCardholderId: holder.id });
    return holder.id;
  } catch (e) {
    throw issuingError(e);
  }
}

async function createOneTimeCard(userId, { amountUsd, merchant, purchaseId, name, email }) {
  const s = client();
  if (!s) {
    const e = new Error('Stripe is not configured (STRIPE_SECRET_KEY).');
    e.code = 'NO_STRIPE';
    throw e;
  }
  const cents = Math.max(1, Math.round(Number(amountUsd) * 100));
  const holder = await ensureCardholder(userId, { name, email });
  try {
    const card = await s.issuing.cards.create({
      cardholder: holder,
      currency: 'usd',
      type: 'virtual',
      status: 'active',
      spending_controls: {
        spending_limits: [{ amount: cents, interval: 'all_time' }],
      },
      metadata: {
        user_id: String(userId),
        purchase_id: String(purchaseId || ''),
        merchant: String(merchant || '').slice(0, 80),
        single_use: '1',
      },
    });
    return {
      stripeCardId: card.id,
      last4: card.last4 || null,
      brand: card.brand || 'visa',
      expMonth: card.exp_month || null,
      expYear: card.exp_year || null,
      status: card.status || 'active',
    };
  } catch (e) {
    throw issuingError(e);
  }
}

async function cancelCard(cardId) {
  const s = client();
  if (!s || !cardId) return null;
  try {
    return await s.issuing.cards.update(cardId, { status: 'canceled' });
  } catch {
    return null;
  }
}

async function ephemeralKey(userId, cardId, nonce) {
  const s = client();
  if (!s) {
    const e = new Error('Stripe is not configured.');
    e.code = 'NO_STRIPE';
    throw e;
  }
  if (!cardId || !nonce) {
    const e = new Error('Card and nonce required.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  const row = await store.getAgentWallet(userId);
  const mine = ((row && row.envelopes) || []).some((p) => p && p.stripeCardId === cardId && p.ownerUserId === userId);
  if (!mine) {
    const e = new Error('That card does not belong to this account.');
    e.code = 'FORBIDDEN';
    throw e;
  }
  try {
    const key = await s.ephemeralKeys.create(
      { nonce: String(nonce), issuing_card: cardId },
      { apiVersion: '2024-12-18.acacia' }
    );
    return {
      secret: key.secret,
      cardId,
      publishableKey: publishable(),
    };
  } catch (e) {
    throw issuingError(e);
  }
}

module.exports = {
  configured,
  testMode,
  publishable,
  ensureCardholder,
  createOneTimeCard,
  cancelCard,
  ephemeralKey,
};
