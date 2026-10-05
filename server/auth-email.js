/* Belna sign-in and sign-up codes. Supabase Auth creates the one-time code
   with admin generateLink, which sends nothing; Belna delivers it through
   Resend from its own domain and template, so no auth email carries
   Supabase's sender, links or branding. */
const RESEND_COOLDOWN_MS = 60_000;

function env(name, fallback = '') {
  return String(process.env[name] || process.env['LINGON_' + name] || fallback).trim();
}
function resendKey() { return env('RESEND_API_KEY'); }
function configured() { return resendKey().length > 8; }
// hej@ is a reserved agent local part, so no agent mailbox can send as it.
function sender() { return env('AUTH_EMAIL_FROM') || 'Belna <hej@mail.belna.se>'; }

function fail(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}

const COPY = {
  signin: {
    subject: 'Your Belna sign-in code',
    eyebrow: 'Secure sign-in',
    title: 'Your Belna code',
    lead: 'Enter this one-time code in the Belna sign-in window:',
    preheader: 'Use this one-time code to sign in to Belna.',
  },
  signup: {
    subject: 'Confirm your Belna account',
    eyebrow: 'Welcome to Belna',
    title: 'Confirm your email',
    lead: 'Enter this code in Belna to finish creating your account:',
    preheader: 'Use this code to confirm your email and finish signing up.',
  },
};

function codeEmailHtml({ code, purpose = 'signin' }) {
  const c = COPY[purpose] || COPY.signin;
  const safeCode = String(code || '').replace(/[^0-9A-Za-z]/g, '');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${c.subject}</title>
</head>
<body style="margin:0;padding:0;background:#F6F6F7;color:#17181A;font-family:'Segoe UI',Arial,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${c.preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#F6F6F7;">
    <tr>
      <td align="center" style="padding:34px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;">
          <tr>
            <td style="padding:0 4px 18px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:10px;"><img src="https://belna.se/email-logo.png" width="30" height="20" alt="" style="display:block;border:0;width:30px;height:20px;"></td>
                  <td style="vertical-align:middle;font-size:19px;line-height:24px;font-weight:800;letter-spacing:-0.5px;color:#17181A;">belna</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#FFFFFF;border:1px solid #E7E7EA;border-radius:18px;padding:38px 40px;box-shadow:0 10px 28px rgba(20,20,26,0.06);">
              <div style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#9A9CA3;">${c.eyebrow}</div>
              <h1 style="margin:8px 0 14px;font-size:28px;line-height:35px;font-weight:750;letter-spacing:-0.6px;color:#17181A;">${c.title}</h1>
              <p style="margin:0;font-size:16px;line-height:1.65;color:#17181A;">${c.lead}</p>
              <div style="margin:28px 0;padding:20px 16px;border:1px solid #E7E7EA;border-radius:12px;background:#F6F6F7;text-align:center;font-size:30px;line-height:40px;font-weight:700;letter-spacing:8px;color:#17181A;">${safeCode}</div>
              <p style="margin:0;font-size:14px;line-height:1.6;color:#6E7076;">The code expires shortly. If you didn’t request it, you can safely ignore this email. Never share this code with anyone.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 4px 0;font-size:12px;line-height:18px;color:#9A9CA3;">
              Sent by Belna because this address was entered at belna.se.<br>
              <a href="https://belna.se" style="color:#6E7076;text-decoration:none;">belna.se</a> · Swedish safe AI agents
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function codeEmailText({ code, purpose = 'signin' }) {
  const c = COPY[purpose] || COPY.signin;
  return `${c.title}\n\n${c.lead}\n\n${code}\n\nThe code expires shortly. If you didn’t request it, you can safely ignore this email. Never share this code with anyone.\n\nBelna · belna.se`;
}

function supabaseUrl() { return env('SUPABASE_URL').replace(/\/$/, ''); }
function secretKey() { return env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY'); }

// The admin API's filter is a substring search, so match the address exactly.
async function findUser(email) {
  if (!supabaseUrl() || !secretKey()) return null;
  try {
    const r = await fetch(supabaseUrl() + '/auth/v1/admin/users?per_page=50&filter=' + encodeURIComponent(email), {
      headers: { apikey: secretKey(), Authorization: 'Bearer ' + secretKey() },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.users || []).find((u) => String(u.email || '').toLowerCase() === email) || null;
  } catch {
    return null;
  }
}

// Supabase allows one auth email per address a minute; generateLink does not
// enforce that, so keep the same limit before minting a new code.
function sentRecently(user, now = Date.now()) {
  const last = Math.max(...['recovery_sent_at', 'confirmation_sent_at', 'email_change_sent_at']
    .map((k) => Date.parse(user?.[k] || '') || 0));
  return now - last < RESEND_COOLDOWN_MS;
}

async function deliver({ email, code, purpose }) {
  const c = COPY[purpose] || COPY.signin;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + resendKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: sender(),
      to: [email],
      reply_to: 'hej@belna.se',
      subject: c.subject,
      html: codeEmailHtml({ code, purpose }),
      text: codeEmailText({ code, purpose }),
    }),
  });
  if (!r.ok) {
    console.error('Auth email failed:', r.status, (await r.text().catch(() => '')).slice(0, 300));
    throw fail('We couldn’t send the email. Please try again in a minute.', 'SEND_FAILED', 503);
  }
}

/* kind 'signin': a code for an existing or new account (new accounts are
   created unconfirmed, like signInWithOtp). kind 'signup': creates a password
   account; an address that already has a confirmed account gets a sign-in
   code instead, so the response never reveals whether the account exists.
   Either code is verified with verifyOtp({ type: 'email' }). */
async function sendAuthCode(admin, { email, kind = 'signin', data } = {}) {
  const address = String(email || '').trim().toLowerCase();
  const user = await findUser(address);
  if (user && sentRecently(user)) throw fail('Please wait a minute before asking for another code.', 'COOLDOWN', 429);
  let type = 'magiclink';
  let params = { type, email: address, options: { data } };
  if (kind === 'signup' && !user?.email_confirmed_at) {
    // The chosen password is set only when the code is verified (secureFirstSignIn),
    // by whoever proves they own the address; until then the account has a random one.
    type = 'signup';
    params = { type, email: address, password: randomPassword(), options: { data } };
  }
  let link = await admin.auth.admin.generateLink(params);
  if (type === 'signup' && /already|exists/i.test(link.error?.message || '')) {
    type = 'magiclink';
    link = await admin.auth.admin.generateLink({ type, email: address, options: { data } });
  }
  const code = link.data?.properties?.email_otp;
  if (link.error || !code) throw fail(link.error?.message || 'Could not create a code.', 'AUTH', 400);
  await deliver({ email: address, code, purpose: type === 'signup' ? 'signup' : 'signin' });
  return { purpose: type === 'signup' ? 'signup' : 'signin' };
}

function randomPassword() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Supabase's public sign-up endpoint accepts a password for any address, and the
// account stays unconfirmed until someone proves they own it. A password set
// before that proof belongs to whoever chose it, not to the owner, so when a code,
// Google or Apple sign-in confirms the address, any existing password is replaced:
// with the one the owner chose at sign-up, or a random one (Belna signs in without).
const FIRST_CONFIRMATION_MS = 10 * 60_000;
async function wasUnconfirmed(email) {
  const address = String(email || '').trim().toLowerCase();
  if (!address.includes('@')) return false;
  const user = await findUser(address);
  return !!user && !user.email_confirmed_at;
}
function firstConfirmation(user, { wasUnconfirmed = false, now = Date.now() } = {}) {
  const identities = Array.isArray(user?.identities) ? user.identities : null;
  // An account with no email identity (Apple only) never had a password to inherit.
  if (!wasUnconfirmed && identities && !identities.some((i) => i?.provider === 'email')) return false;
  const confirmedAt = Date.parse(user?.email_confirmed_at || user?.confirmed_at || '');
  return wasUnconfirmed || !Number.isFinite(confirmedAt) || now - confirmedAt < FIRST_CONFIRMATION_MS;
}
async function secureFirstSignIn(admin, user, { wasUnconfirmed = false, password, now } = {}) {
  if (!user?.id || !firstConfirmation(user, { wasUnconfirmed, now })) return false;
  if (!admin) throw fail('Account authentication is unavailable.', 'AUTH', 503);
  const chosen = typeof password === 'string' && password.length >= 8 ? password : randomPassword();
  const { error } = await admin.auth.admin.updateUserById(user.id, { password: chosen });
  if (error) throw fail('We couldn’t finish securing your account. Please try again.', 'AUTH', 503);
  return true;
}

module.exports = {
  configured,
  sendAuthCode,
  wasUnconfirmed,
  firstConfirmation,
  secureFirstSignIn,
  randomPassword,
  codeEmailHtml,
  codeEmailText,
  sentRecently,
  RESEND_COOLDOWN_MS,
};
