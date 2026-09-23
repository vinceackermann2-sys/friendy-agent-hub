/* Plans + credit ledger (Stripe-backed, monthly subscriptions).
   1 credit = $0.50 face value. Real model cost is marked up 2.5x when
   deducting credits (~60% margin). Users only see credits — never $ costs.
   Free: 20 credits. Pro $50/mo: 60 credits/mo. Max $100/mo: 100 credits/mo.
   Gift / discount copy lives in PRELANDER_OFFERS for a later pre-lander.
*/
const CREDIT_VALUE_USD = 0.5;
const BILLING_MARKUP = 2.5;
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
const REFERRAL_TOTAL_USD = 50;
const REFERRAL_GIFT_USD_EACH = 25;
const REFERRAL_CREDITS_EACH = 50;

const PLANS = {
  free: { id: 'free', name: 'Free', price: 0, was: null, credits: 20, giftUsd: 0, interval: null, blurb: '20 credits to start. No card.' },
  pro: { id: 'pro', name: 'Pro', price: 50, was: null, credits: 60, giftUsd: 0, interval: 'month', blurb: '60 credits monthly.' },
  max: { id: 'max', name: 'Max', price: 100, was: null, credits: 100, giftUsd: 0, interval: 'month', blurb: '100 credits monthly.' },
};

function creditPackFor(credits) {
  const n = Number(credits || 0);
  return CREDIT_PACKS.find((p) => p.credits === n) || null;
}

const RATE_IN = (Number(process.env.MODEL_RATE_IN_USD_PER_MILLION) || 0.10) / 1e6;
const RATE_CACHED_IN = (Number(process.env.MODEL_RATE_CACHED_IN_USD_PER_MILLION) || 0.01) / 1e6;
const RATE_CACHE_WRITE = (Number(process.env.MODEL_RATE_CACHE_WRITE_USD_PER_MILLION) || 0.125) / 1e6;
const RATE_OUT = (Number(process.env.MODEL_RATE_OUT_USD_PER_MILLION) || 0.50) / 1e6;
function costOf(usage) {
  if (!usage) return 0;
  const pin = Number(usage.promptTokenCount ?? usage.promptTokens ?? usage.input_tokens ?? 0) || 0;
  const pout = Number(usage.candidatesTokenCount ?? usage.candidatesTokens ?? usage.output_tokens ?? 0) || 0;
  const details = usage.input_tokens_details || {};
  const cached = Math.max(0, Math.min(pin, Number(details.cached_tokens ?? usage.cachedInputTokens ?? 0) || 0));
  const cacheWrite = Math.max(0, Math.min(pin - cached, Number(details.cache_write_tokens ?? usage.cacheWriteTokens ?? 0) || 0));
  const regular = Math.max(0, pin - cached - cacheWrite);
  return regular * RATE_IN + cached * RATE_CACHED_IN + cacheWrite * RATE_CACHE_WRITE + pout * RATE_OUT;
}
function creditsForCost(costUsd) {
  return Number(costUsd || 0) * BILLING_MARKUP * CREDITS_PER_USD;
}
function creditsForGiftUsd(amountUsd) {
  return Number(amountUsd || 0) * CREDITS_PER_USD;
}

export {
  PLANS, PRELANDER_OFFERS, CREDIT_PACKS, GIFT_AMOUNTS, creditPackFor,
  CREDIT_VALUE_USD, BILLING_MARKUP, CREDITS_PER_USD, costOf, creditsForCost, creditsForGiftUsd,
  REFERRAL_TOTAL_USD, REFERRAL_GIFT_USD_EACH, REFERRAL_CREDITS_EACH,
};
