// Creates the REAL Stripe products + monthly prices for Belna plans.
// Usage:
//   1. Paste your keys into .env (STRIPE_SECRET_KEY=sk_test_... or sk_live_...)
//   2. node scripts/setup-stripe.mjs
//   3. Copy the printed PRICE IDs back into .env as STRIPE_PRO_PRICE_ID /
//      STRIPE_MAX_PRICE_ID, then configure the webhook (step 4 output).
// Safe to re-run: existing Belna products/prices are reused, never duplicated.
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
  console.error('Test mode: https://dashboard.stripe.com/test/apikeys (sk_test_...)');
  process.exit(1);
}
const { default: Stripe } = await import('stripe');
const stripe = new Stripe(key);

const WANTED = [
  { plan: 'pro', name: 'Belna Pro', amount: 3000, credits: 60, gift: '$50 gift card (100 credits, first invoice)' },
  { plan: 'max', name: 'Belna Max', amount: 5000, credits: 100, gift: '$100 gift card (200 credits, first invoice)' },
];

const out = {};
for (const w of WANTED) {
  // Reuse existing product by name lookup.
  const found = await stripe.products.search({ query: `name:"${w.name}"` }).catch(() => ({ data: [] }));
  let product = found.data[0];
  if (!product) {
    product = await stripe.products.create({
      name: w.name,
      description: `${w.credits} credits every month + one ${w.gift}. 1 credit = $0.50 of AI usage.`,
      metadata: { plan: w.plan, credits: String(w.credits) },
    });
    console.log(`created product ${w.name} (${product.id})`);
  } else {
    console.log(`reusing product ${w.name} (${product.id})`);
  }
  // Reuse an active monthly price with the same amount, else create one.
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 10 });
  let price = prices.data.find((p) => p.unit_amount === w.amount && p.recurring && p.recurring.interval === 'month');
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: w.amount,
      currency: 'usd',
      recurring: { interval: 'month' },
      nickname: `${w.name} monthly`,
      metadata: { plan: w.plan },
    });
    console.log(`created price ${w.name} $${w.amount / 100}/mo (${price.id})`);
  } else {
    console.log(`reusing price ${w.name} $${w.amount / 100}/mo (${price.id})`);
  }
  out[w.plan] = price.id;
}

console.log('\n---- paste into .env ----');
console.log(`STRIPE_PRO_PRICE_ID=${out.pro}`);
console.log(`STRIPE_MAX_PRICE_ID=${out.max}`);
console.log('\n---- webhook ----');
console.log('1. Stripe Dashboard → Developers → Webhooks → Add endpoint:');
console.log('     https://belna.se/api/stripe/webhook');
console.log('2. Select events: checkout.session.completed, invoice.paid,');
console.log('   customer.subscription.created, customer.subscription.updated,');
console.log('   customer.subscription.deleted');
console.log('3. Copy the Signing secret (whsec_...) into .env as STRIPE_WEBHOOK_SECRET');
console.log('4. Local test: stripe listen --forward-to localhost:8000/api/stripe/webhook');
