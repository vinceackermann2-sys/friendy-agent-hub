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
function creditsForCost(costUsd) {
  return Number(costUsd || 0) * BILLING_MARKUP * CREDITS_PER_USD;
}
function creditsForGiftUsd(amountUsd) {
  return Number(amountUsd || 0) * CREDITS_PER_USD;
}

export {
  PLANS, PRELANDER_OFFERS, CREDIT_PACKS, GIFT_AMOUNTS, creditPackFor,
  CREDIT_VALUE_USD, BILLING_MARKUP, CREDITS_PER_USD, costOf, creditsForCost, creditsForGiftUsd,
};
