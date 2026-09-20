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
   Costs (internal only, never shown): Gemini 2.5 Flash ~$0.30/1M in + $2.50/1M out.
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

const PLANS = {
  free: { id: 'free', name: 'Free', price: 0, was: null, credits: 20, giftUsd: 0, interval: null, blurb: '20 credits to start. No card.' },
  pro: { id: 'pro', name: 'Pro', price: 50, was: null, credits: 60, giftUsd: 0, interval: 'month', blurb: '60 credits monthly.' },
  max: { id: 'max', name: 'Max', price: 100, was: null, credits: 100, giftUsd: 0, interval: 'month', blurb: '100 credits monthly.' },
};

function creditPackFor(credits) {
  const n = Number(credits || 0);
  return CREDIT_PACKS.find((p) => p.credits === n) || null;
}

const RATE_IN = 0.30 / 1e6;
const RATE_OUT = 2.50 / 1e6;
function costOf(usage) {
  if (!usage) return 0;
  const pin = usage.promptTokenCount || usage.promptTokens || 0;
  const pout = usage.candidatesTokenCount || usage.candidatesTokens || 0;
  return pin * RATE_IN + pout * RATE_OUT;
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
};
