/* Plans + credit ledger (Stripe-backed, monthly subscriptions).
   Credits hide raw API costs and include our margin:
   - 1 credit = $0.50 face value. Real model cost is marked up 2.5x when
     deducting credits, so ~60% gross margin stays with us (covers infra,
     support, gift breakage). Users only ever see credits — never $ costs.
   - Free: $0, 20 starter credits (covers onboarding + real trial usage).
   - Pro: $30/mo → 60 credits every month + one $50 gift card (100 credits)
     issued after the FIRST paid invoice (use it or gift it).
   - Max: $50/mo → 100 credits every month + one $100 gift card (200 credits)
     issued after the FIRST paid invoice.
   Gift cards keep their dollar face value ($50/$100) but redeem into
   credits at 2 credits per $1. Redeem is fully real: codes add credits.
   Costs (internal only, never shown): Gemini 2.5 Flash ~$0.30/1M in + $2.50/1M out.
*/
const CREDIT_VALUE_USD = 0.5; // 1 credit sells for $0.50 face value
const BILLING_MARKUP = 2.5; // we deduct 2.5x real API cost in face value → ~60% margin
const CREDITS_PER_USD = 1 / CREDIT_VALUE_USD; // 2

const PLANS = {
  free: { id: 'free', name: 'Free', price: 0, was: null, credits: 20, giftUsd: 0, interval: null, blurb: '20 credits to start. No card.' },
  pro: { id: 'pro', name: 'Pro', price: 30, was: 50, credits: 60, giftUsd: 50, interval: 'month', blurb: '60 credits monthly.' },
  max: { id: 'max', name: 'Max', price: 50, was: 100, credits: 100, giftUsd: 100, interval: 'month', blurb: '100 credits monthly.' },
};

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

module.exports = { PLANS, CREDIT_VALUE_USD, BILLING_MARKUP, CREDITS_PER_USD, costOf, creditsForCost, creditsForGiftUsd };
