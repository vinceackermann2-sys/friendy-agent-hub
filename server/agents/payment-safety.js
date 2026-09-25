// A payment card's PAN/CVC must not be treated as a reusable agent vault secret.
// Merchant account cards are represented only by non-sensitive display metadata.
function cardNumberIn(value) {
  const runs = String(value || '').match(/(?:\d[ -]?){13,19}/g) || [];
  return runs.some((run) => {
    const digits = run.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    for (let i = digits.length - 1, double = false; i >= 0; i--, double = !double) {
      let n = Number(digits[i]);
      if (double) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
    }
    return sum % 10 === 0;
  });
}
function forbiddenPaymentSecret(name, value) {
  return /\b(?:cvc2?|cvv2?|cid|card\s*(?:number|no\.?|security\s*code)|kortnummer|säkerhetskod|bank\s*id|one[ -]?time[ -]?code|otp|verification[ -]?code|pin)\b/i.test(String(name || ''))
    || cardNumberIn(value);
}
module.exports = { cardNumberIn, forbiddenPaymentSecret };
