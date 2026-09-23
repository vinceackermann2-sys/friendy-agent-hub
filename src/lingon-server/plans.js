/* Plans + credit ledger (Stripe-backed, monthly subscriptions).
   1 credit = $0.50 face value. Packs go as low as $0.125 per credit, so
   usage consumes 20 credits per $1 provider cost (60% margin on that pack).
   Free: 20 credits. Pro $50/mo: 60 credits/mo. Max $100/mo: 100 credits/mo.
   Gift / discount copy lives in PRELANDER_OFFERS for a later pre-lander.
*/
const CREDIT_VALUE_USD = 0.5;
const BILLING_MARKUP = 10;
const CREDITS_PER_USD = 1 / CREDIT_VALUE_USD;

const PRELANDER_OFFERS = {
  pro: { price: 30, was: 50, giftUsd: 50, credits: 60 },
  max: { price: 50, was: 100, giftUsd: 100, credits: 100 },
};

const CREDIT_PACKS = [
  { credits: 50, usd: 15 },
  { credits: 100, usd: 30 },
  { credits: 200, usd: 45 },
  { credits: 300, usd: 60 },
  { credits: 500, usd: 75 },
  { credits: 750, usd: 100 },
  { credits: 1000, usd: 125 },
];

const GIFT_AMOUNTS = [50, 100];
const TOKENS_PER_MILLION = 1_000_000;
const TOKEN_PACKS = [
  { millions: 10, usd: 15 },
  { millions: 20, usd: 25 },
  { millions: 30, usd: 35 },
  { millions: 50, usd: 55 },
  { millions: 75, usd: 85 },
  { millions: 100, usd: 105 },
  { millions: 500, usd: 500 },
].map((pack) => ({ ...pack, tokens: pack.millions * TOKENS_PER_MILLION }));
function tokenPackFor(tokens) {
  return TOKEN_PACKS.find((pack) => pack.tokens === Number(tokens)) || null;
}
const REFERRAL_TOTAL_USD = 50;
const REFERRAL_GIFT_USD_EACH = 25;
const REFERRAL_CREDITS_EACH = 50;

const PLANS = {
  free: { id: 'free', name: 'Free', price: 0, was: null, credits: 20, tokens: 50_000_000, imagesPerDay: 5, transcriptionsPerDay: 10, giftUsd: 0, interval: 'month', blurb: '50 million tokens monthly. No card.' },
  pro: { id: 'pro', name: 'Pro', price: 50, was: null, credits: 60, tokens: 100_000_000, imagesPerDay: 10, transcriptionsPerDay: 15, giftUsd: 0, interval: 'month', blurb: '100 million tokens monthly.' },
  max: { id: 'max', name: 'Max', price: 100, was: null, credits: 100, tokens: 200_000_000, imagesPerDay: 15, transcriptionsPerDay: 20, giftUsd: 0, interval: 'month', blurb: '200 million tokens monthly.' },
};

function creditPackFor(credits) {
  const n = Number(credits || 0);
  return CREDIT_PACKS.find((p) => p.credits === n) || null;
}

function rate(name, fallback) {
  const value = Number(process.env[name]);
  return (Number.isFinite(value) && value > 0 ? value : fallback) / 1e6;
}
const RATE_IN = rate('MODEL_RATE_IN_USD_PER_MILLION', 0.10);
const RATE_CACHED_IN = rate('MODEL_RATE_CACHED_IN_USD_PER_MILLION', 0.01);
const RATE_CACHE_WRITE = rate('MODEL_RATE_CACHE_WRITE_USD_PER_MILLION', 0.125);
const RATE_OUT = rate('MODEL_RATE_OUT_USD_PER_MILLION', 0.50);
const FALLBACK_RATES = {
  in: 0.20 / 1e6, cached: 0.02 / 1e6, write: 0.25 / 1e6, out: 1.20 / 1e6,
};
function costOf(usage) {
  if (!usage) return 0;
  const pin = Math.max(0, Number(usage.promptTokenCount ?? usage.promptTokens ?? usage.input_tokens ?? 0) || 0);
  const pout = Math.max(0, Number(usage.candidatesTokenCount ?? usage.candidatesTokens ?? usage.output_tokens ?? 0) || 0);
  const details = usage.input_tokens_details || {};
  const cached = Math.max(0, Math.min(pin, Number(details.cached_tokens ?? usage.cachedInputTokens ?? 0) || 0));
  const cacheWrite = Math.max(0, Math.min(pin - cached, Number(details.cache_write_tokens ?? usage.cacheWriteTokens ?? 0) || 0));
  const regular = Math.max(0, pin - cached - cacheWrite);
  const rates = String(usage.model || '').startsWith('gpt-5.6-luna') ? FALLBACK_RATES
    : { in: RATE_IN, cached: RATE_CACHED_IN, write: RATE_CACHE_WRITE, out: RATE_OUT };
  const long = pin > 272000;
  return (regular * rates.in + cached * rates.cached + cacheWrite * rates.write) * (long ? 2 : 1)
    + pout * rates.out * (long ? 1.5 : 1);
}
function creditsForCost(costUsd) {
  const cost = Number(costUsd || 0);
  if (!Number.isFinite(cost) || cost < 0) throw new Error('Invalid provider cost.');
  return cost * BILLING_MARKUP * CREDITS_PER_USD;
}
function creditsForGiftUsd(amountUsd) {
  return Number(amountUsd || 0) * CREDITS_PER_USD;
}

export {
  PLANS, PRELANDER_OFFERS, CREDIT_PACKS, GIFT_AMOUNTS, creditPackFor,
  TOKEN_PACKS, TOKENS_PER_MILLION, tokenPackFor,
  CREDIT_VALUE_USD, BILLING_MARKUP, CREDITS_PER_USD, costOf, creditsForCost, creditsForGiftUsd,
  REFERRAL_TOTAL_USD, REFERRAL_GIFT_USD_EACH, REFERRAL_CREDITS_EACH,
};
