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
// A saved login goes only into its own kind of field: a password into a password field, a
// username never into one. fieldLine is the page element, e.g. [3] input:password "Password".
function loginFieldProblem(secretName, fieldLine) {
  const kind = /\bpassword$/i.test(String(secretName || '')) ? 'password' : /\busername$/i.test(String(secretName || '')) ? 'username' : '';
  if (!kind || !fieldLine) return '';
  const password = /^\[\d+\] input:password\b/.test(fieldLine);
  if (kind === 'password' && !password) return 'That is the saved password; fill it into the password field. Nothing was typed.';
  if (kind === 'username' && password) return 'That is the saved username or email; fill it into the username or email field. Nothing was typed.';
  return '';
}
module.exports = { cardNumberIn, forbiddenPaymentSecret, loginFieldProblem };
