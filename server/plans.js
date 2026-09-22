/* Plans + credit ledger (Stripe-backed, monthly subscriptions).
   Credits hide raw API costs and include our margin:
   - 1 credit = $0.50 face value. Real model cost is marked up 2.5x when
     deducting credits, so ~60% gross margin stays with us (covers infra,
     support, gift breakage). Users only ever see credits — never $ costs.
   - Free: $0, 20 starter credits (covers onboarding + real trial usage).
   - Pro: $50/mo → 60 credits every month.
   - Max: $100/mo → 100 credits every month.
   Gift cards / discounted "was" prices stay in PRELANDER_OFFERS (pre-lander).
   Extra credit packs and $50/$100 gift cards are real Stripe one-time prices.
   Redeem is fully real: codes add credits at 2 credits per $1.
   Default internal model rates match GPT-6 Luna's published API prices.
   Azure prices can vary by deployment and region; override them if needed.
*/
const CREDIT_VALUE_USD = 0.5; // 1 credit sells for $0.50 face value
const BILLING_MARKUP = 2.5; // we deduct 2.5x real API cost in face value → ~60% margin
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

/* Referral gift — the in-app "FREE $50 gift card" (same $50 face value as the
   Stripe $50 gift card). Split dual-sided:
   - inviter gets $25 face (50 credits) ONLY after the friend redeems
   - friend gets $25 face (50 credits) on redeem
   - one reward per unique friend (no double-claim, no self-redeem)
   Credits hide raw model API costs: real cost deducts at
   BILLING_MARKUP x CREDITS_PER_USD = 5 credits per $1 of model cost,
   while gifts grant at face value (2 credits per $1). */
const REFERRAL_TOTAL_USD = 50;
const REFERRAL_GIFT_USD_EACH = 25;
const REFERRAL_CREDITS_EACH = 25 * CREDITS_PER_USD; // 50 credits each side

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
// Real USD cost → credits deducted (markup included, our profit built in).
function creditsForCost(costUsd) {
  return Number(costUsd || 0) * BILLING_MARKUP * CREDITS_PER_USD;
}
// Gift face USD → credits granted (face value, no markup on gifts).
function creditsForGiftUsd(amountUsd) {
  return Number(amountUsd || 0) * CREDITS_PER_USD;
}

module.exports = {
  PLANS, PRELANDER_OFFERS, CREDIT_PACKS, GIFT_AMOUNTS, creditPackFor,
  CREDIT_VALUE_USD, BILLING_MARKUP, CREDITS_PER_USD, costOf, creditsForCost, creditsForGiftUsd,
  REFERRAL_TOTAL_USD, REFERRAL_GIFT_USD_EACH, REFERRAL_CREDITS_EACH,
};
