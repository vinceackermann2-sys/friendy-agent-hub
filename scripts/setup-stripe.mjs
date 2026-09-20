// Creates the REAL Stripe products + prices for Belna.
// Usage:
//   1. Paste your keys into .env (STRIPE_SECRET_KEY=sk_test_... or sk_live_...)
//   2. node scripts/setup-stripe.mjs
// Safe to re-run: existing products/prices are reused, never duplicated.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['.env']) {
  const p = join(root, f);
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}

const key = (process.env.STRIPE_SECRET_KEY || '').trim();
if (!key) {
  console.error('Missing STRIPE_SECRET_KEY — paste your Stripe secret key into .env first.');
  process.exit(1);
}
const { default: Stripe } = await import('stripe');
const stripe = new Stripe(key);

const PLANS = [
  { plan: 'pro', name: 'Belna Pro', amount: 5000, credits: 60, promoAmount: 3000 },
  { plan: 'max', name: 'Belna Max', amount: 10000, credits: 100, promoAmount: 5000 },
];
const CREDIT_PACKS = [
  { credits: 50, usd: 15 },
  { credits: 100, usd: 30 },
  { credits: 200, usd: 45 },
  { credits: 300, usd: 60 },
  { credits: 500, usd: 75 },
  { credits: 750, usd: 100 },
  { credits: 1000, usd: 125 },
];
const GIFTS = [50, 100];

async function productByName(name) {
  const found = await stripe.products.search({ query: `name:"${name}"` }).catch(() => ({ data: [] }));
  return found.data[0] || null;
}

async function ensureProduct(name, description, metadata) {
  let product = await productByName(name);
  if (!product) {
    product = await stripe.products.create({ name, description, metadata });
    console.log(`created product ${name} (${product.id})`);
  } else {
    console.log(`reusing product ${name} (${product.id})`);
  }
  return product;
}

async function ensurePrice(product, { amount, recurring, nickname, metadata }) {
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 30 });
  let price = prices.data.find((p) => {
    if (p.unit_amount !== amount || p.currency !== 'usd') return false;
    if (recurring) return p.recurring && p.recurring.interval === recurring.interval;
    return !p.recurring;
  });
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: amount,
      currency: 'usd',
      ...(recurring ? { recurring } : {}),
      nickname,
      metadata,
    });
    console.log(`created price ${nickname} (${price.id})`);
  } else {
    console.log(`reusing price ${nickname} (${price.id})`);
  }
  return price;
}

const out = {};

for (const w of PLANS) {
  const product = await ensureProduct(
    w.name,
    `${w.credits} credits every month. 1 credit = $0.50 of AI usage.`,
    { plan: w.plan, credits: String(w.credits) },
  );
  const live = await ensurePrice(product, {
    amount: w.amount,
    recurring: { interval: 'month' },
    nickname: `${w.name} monthly`,
    metadata: { plan: w.plan },
  });
  const promo = await ensurePrice(product, {
    amount: w.promoAmount,
    recurring: { interval: 'month' },
    nickname: `${w.name} pre-lander`,
    metadata: { plan: w.plan, promo: '1' },
  });
  out[w.plan] = live.id;
  out[`${w.plan}Promo`] = promo.id;
}

const creditsProduct = await ensureProduct(
  'Belna Credits',
  'One-time purchased credits. 1 credit = $0.50 of AI usage.',
  { kind: 'credits' },
);
for (const pack of CREDIT_PACKS) {
  const price = await ensurePrice(creditsProduct, {
    amount: pack.usd * 100,
    nickname: `${pack.credits} credits`,
    metadata: { kind: 'credits', credits: String(pack.credits) },
  });
  out[`credits${pack.credits}`] = price.id;
}

for (const amount of GIFTS) {
  const product = await ensureProduct(
    `Belna Gift Card $${amount}`,
    `$${amount} gift card. Redeems for ${amount * 2} credits.`,
    { kind: 'gift', amount_usd: String(amount) },
  );
  const price = await ensurePrice(product, {
    amount: amount * 100,
    nickname: `Gift card $${amount}`,
    metadata: { kind: 'gift', amount_usd: String(amount) },
  });
  out[`gift${amount}`] = price.id;
}

console.log('\n---- paste into .env ----');
console.log(`STRIPE_PRO_PRICE_ID=${out.pro}`);
console.log(`STRIPE_MAX_PRICE_ID=${out.max}`);
console.log(`STRIPE_PRO_PROMO_PRICE_ID=${out.proPromo}`);
console.log(`STRIPE_MAX_PROMO_PRICE_ID=${out.maxPromo}`);
for (const pack of CREDIT_PACKS) {
  console.log(`STRIPE_CREDITS_${pack.credits}_PRICE_ID=${out[`credits${pack.credits}`]}`);
}
console.log(`STRIPE_GIFT_50_PRICE_ID=${out.gift50}`);
console.log(`STRIPE_GIFT_100_PRICE_ID=${out.gift100}`);
