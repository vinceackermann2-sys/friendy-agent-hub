/* Plans + credit ledger (Stripe-backed, monthly subscriptions).
   1 credit = $0.50 face value. Real model cost is marked up 2.5x when
   deducting credits (~60% margin). Users only see credits — never $ costs.
   Free: 20 credits. Pro $30/mo: 60 credits/mo + $50 gift (100 credits, first
   invoice only). Max $50/mo: 100 credits/mo + $100 gift (200 credits).
*/
const CREDIT_VALUE_USD = 0.5;
const BILLING_MARKUP = 2.5;
const CREDITS_PER_USD = 1 / CREDIT_VALUE_USD;

const PLANS = {
  free: { id: 'free', name: 'Free', price: 0, was: null, credits: 20, giftUsd: 0, interval: null, blurb: '20 credits to start. No card.' },
  pro: { id: 'pro', name: 'Pro', price: 30, was: 50, credits: 60, giftUsd: 50, interval: 'month', blurb: '60 credits monthly + $50 gift card (100 credits).' },
  max: { id: 'max', name: 'Max', price: 50, was: 100, credits: 100, giftUsd: 100, interval: 'month', blurb: '100 credits monthly + $100 gift card (200 credits).' },
};

const RATE_IN = 0.30 / 1e6;
const RATE_OUT = 2.50 / 1e6;
function costOf(usage) {
  if (!usage) return 0;
  const pin = usage.promptTokenCount || usage.promptTokens || 0;
  const pout = usage.candidatesTokenCount || usage.candidatesTokens || 0;
  return pin * RATE_IN + pout * RATE_OUT;
}
function creditsForCost(costUsd) {
  return Number(costUsd || 0) * BILLING_MARKUP * CREDITS_PER_USD;
}
function creditsForGiftUsd(amountUsd) {
  return Number(amountUsd || 0) * CREDITS_PER_USD;
}

export { PLANS, CREDIT_VALUE_USD, BILLING_MARKUP, CREDITS_PER_USD, costOf, creditsForCost, creditsForGiftUsd };
