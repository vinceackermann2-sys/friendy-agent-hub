/* Plans + credit ledger. Honest: no fake charges.
   - Free: $0, $10 API credit included, active immediately.
   - Pro: $30 (was $50) → $20 API credit + one $50 gift code (issued after real payment).
   - Max: $50 (was $100) → $50 API credit + one $100 gift code (issued after real payment).
   Until Stripe is connected, Pro/Max upgrades are RECORDED as requests (no charge,
   plan stays Free). Gift redeem is fully real: codes add credit to the redeemer.
   Costs: Gemini 2.5 Flash approx $0.30/1M input + $2.50/1M output tokens.
*/
const PLANS = {
  free: { id: 'free', name: 'Free', price: 0, was: null, credit: 10, gift: 0, blurb: '$10 of API costs included. No card.' },
  pro: { id: 'pro', name: 'Pro', price: 30, was: 50, credit: 20, gift: 50, blurb: '$20 API credit + $50 gift card (use or gift).' },
  max: { id: 'max', name: 'Max', price: 50, was: 100, credit: 50, gift: 100, blurb: '$50 API credit + $100 gift card (use or gift).' },
};

const RATE_IN = 0.30 / 1e6;
const RATE_OUT = 2.50 / 1e6;
function costOf(usage) {
  if (!usage) return 0;
  const pin = usage.promptTokenCount || usage.promptTokens || 0;
  const pout = usage.candidatesTokenCount || usage.candidatesTokens || 0;
  return pin * RATE_IN + pout * RATE_OUT;
}

module.exports = { PLANS, costOf };
