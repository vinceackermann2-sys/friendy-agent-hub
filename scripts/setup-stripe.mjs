// Creates the REAL Stripe products + prices for Belna.
// Usage:
//   1. Paste your keys into .env (STRIPE_SECRET_KEY=sk_test_... or sk_live_...)
//   2. node scripts/setup-stripe.mjs
// Safe to re-run: existing products/prices are reused, never duplicated.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { TOKEN_PACKS: TOKEN_POLICY_PACKS } = require('../server/plans.js');

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
  { plan: 'pro', name: 'Belna Pro', amount: 5000, tokens: 100000000 },
  { plan: 'max', name: 'Belna Max', amount: 10000, tokens: 200000000 },
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
    if (product.description !== description) product = await stripe.products.update(product.id, { description, metadata });
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
    `${(w.tokens / 1000000)} million raw tokens every month.`,
    { plan: w.plan, tokens: String(w.tokens) },
  );
  const live = await ensurePrice(product, {
    amount: w.amount,
    recurring: { interval: 'month' },
    nickname: `${w.name} monthly`,
    metadata: { plan: w.plan },
  });
  out[w.plan] = live.id;
}

const tokensProduct = await ensureProduct(
  'Belna Token Packs',
  'One-time raw token packs for AI usage. Daily image and transcription limits follow your plan.',
  { kind: 'tokens' },
);
for (const pack of TOKEN_POLICY_PACKS) {
  const price = await ensurePrice(tokensProduct, {
    amount: pack.usd * 100,
    nickname: `${pack.millions}M tokens`,
    metadata: { kind: 'tokens', tokens: String(pack.tokens) },
  });
  out[`tokens${pack.millions}`] = price.id;
}

for (const amount of GIFTS) {
  const product = await ensureProduct(
    `Belna Gift Card $${amount}`,
    `$${amount} gift card. Redeems for ${amount * 20000} raw tokens.`,
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
for (const pack of TOKEN_POLICY_PACKS) {
  console.log(`STRIPE_TOKENS_${pack.millions}M_PRICE_ID=${out[`tokens${pack.millions}`]}`);
}
console.log(`STRIPE_GIFT_50_PRICE_ID=${out.gift50}`);
console.log(`STRIPE_GIFT_100_PRICE_ID=${out.gift100}`);
