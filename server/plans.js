/* Raw-token plans and packs. The credit constants below remain solely for
   legacy ledger rows and in-flight Stripe sessions from the old catalog.
   The old credit policy was:
   - 1 credit = $0.50 face value. Credit packs sell for as little as $0.125
     per credit, so usage consumes 20 credits per $1 of provider cost. Even
     at that lowest sale price this leaves 60% gross margin before fees.
   - Free: 20 starter credits; Pro: 60/month; Max: 100/month.
   Existing discounted subscriptions and old purchases can still fulfill.
   New purchases grant raw tokens; purchased packs do not expire.
   Default internal model rates match GPT-6 Luna's published API prices.
   Azure prices can vary by deployment and region; override them if needed.
*/
const CREDIT_VALUE_USD = 0.5; // 1 credit sells for $0.50 face value
const BILLING_MARKUP = 10; // 20 credits per $1 cost; 60% margin on the cheapest pack
const CREDITS_PER_USD = 1 / CREDIT_VALUE_USD; // 2

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
// These prices are the approved local catalog. They do not cover the
// $15/M all-image-output case; see docs/token-economics-2026-09-23.md.
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

/* One friend can redeem a code once; each account receives 10M raw tokens. */
const REFERRAL_TOKENS_EACH = 10_000_000;

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
// Real USD cost → credits deducted (markup included, our profit built in).
function creditsForCost(costUsd) {
  const cost = Number(costUsd || 0);
  if (!Number.isFinite(cost) || cost < 0) throw new Error('Invalid provider cost.');
  return cost * BILLING_MARKUP * CREDITS_PER_USD;
}
// Gift face USD → credits granted (face value, no markup on gifts).
function creditsForGiftUsd(amountUsd) {
  return Number(amountUsd || 0) * CREDITS_PER_USD;
}

module.exports = {
  PLANS, PRELANDER_OFFERS, CREDIT_PACKS, GIFT_AMOUNTS, creditPackFor,
  TOKEN_PACKS, TOKENS_PER_MILLION, tokenPackFor,
  CREDIT_VALUE_USD, BILLING_MARKUP, CREDITS_PER_USD, costOf, creditsForCost, creditsForGiftUsd,
  REFERRAL_TOKENS_EACH,
};
