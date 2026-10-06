import crypto from 'node:crypto';

// Return a canonical same-origin path. Check again after URL normalization:
// /one/..//other.example must not become a protocol-relative redirect.
function safeNext(value) {
  const raw = String(value || '/');
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000- \u007f]/.test(raw)) return '/';
  try {
    const base = 'https://oauth.invalid';
    const url = new URL(raw, base);
    if (url.origin !== base || url.pathname.startsWith('//')) return '/';
    const out = url.pathname + url.search + url.hash;
    return out.length > 512 ? '/' : out;
  } catch { return '/'; }
}

// A sign-in or connect flow is kept in a signed cookie in the browser that started it,
// not in server memory: the edge runtime answers the callback from any instance. The
// callback reads its state only from that cookie, so a link started in one browser
// (an attacker's) cannot be finished in another (the victim's).
function oauthSecret() {
  const env = (process && process.env) || {};
  const value = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'ENCRYPTION_KEY']
    .map((name) => String(env[name] || env['LINGON_' + name] || '').trim()).find(Boolean);
  if (!value) throw Object.assign(new Error('Sign-in is not configured on this server.'), { code: 'NO_SECRET' });
  return value;
}
const sign = (payload) => crypto.createHmac('sha256', oauthSecret()).update('belna-oauth-flow:' + payload).digest('base64url');
const STATE = /^[a-f0-9]{32,128}$/;
const KIND = /^[a-z]{2,12}$/;

function cookieName(kind, state, secure) {
  // Host-prefixed cookies cannot be planted by sibling subdomains. A separate
  // cookie for each attempt lets two tabs finish their own flows.
  return `${secure ? '__Host-' : ''}belna_${kind}_${state}`;
}
function cookie(name, value, maxAge, secure) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

// record: what the callback needs (next path, redirect URI, terms version...). It is
// readable by the browser that holds it, so it must not contain secrets.
function bindOAuthBrowser(res, { kind, state, secure, record = {}, ttlSeconds = 600 }) {
  if (!KIND.test(kind) || !STATE.test(state)) throw new Error('Invalid sign-in flow.');
  const payload = Buffer.from(JSON.stringify({ ...record, kind, state, exp: Date.now() + ttlSeconds * 1000 })).toString('base64url');
  res.setHeader('Set-Cookie', cookie(cookieName(kind, state, secure), payload + '.' + sign(payload), ttlSeconds, secure));
  res.setHeader('Cache-Control', 'no-store');
}

function readOAuthBrowser(req, { kind, state, secure }) {
  if (!KIND.test(kind) || !STATE.test(String(state || ''))) return null;
  const name = cookieName(kind, state, secure);
  const values = String(req.headers.cookie || '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(name + '=')).map((part) => part.slice(name.length + 1));
  if (values.length !== 1) return null;
  const [payload, mac, extra] = values[0].split('.');
  if (!payload || !mac || extra !== undefined) return null;
  let expected;
  try { expected = sign(payload); } catch { return null; }
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let record;
  try { record = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!record || record.kind !== kind || record.state !== state || !(Number(record.exp) > Date.now())) return null;
  return record;
}

function clearOAuthBrowser(res, { kind, state, secure }) {
  if (!KIND.test(kind) || !STATE.test(String(state || ''))) return;
  res.setHeader('Set-Cookie', cookie(cookieName(kind, state, secure), '', 0, secure));
  res.setHeader('Cache-Control', 'no-store');
}

// The edge runtime has no shared memory, so this only stops a replay within one
// instance; the provider's authorization code is single-use as well.
const USED = new Map();
function consumeOAuthState(state, exp) {
  const now = Date.now();
  if (USED.size > 2000) for (const [key, until] of USED) if (until < now) USED.delete(key);
  if (USED.has(state)) return false;
  USED.set(state, Number(exp) || now + 600e3);
  return true;
}

// The Apple app signs in with Google in the system browser sheet, which shares no
// cookies with the app's web view. Its flow is carried in a signed state value and
// bound to a secret (PKCE-style) that only the app page holds: the session comes
// back sealed, and only the page with the matching verifier can open it.
const NATIVE_PREFIX = 'n.';
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
function nativeChallenge(verifier) {
  return crypto.createHash('sha256').update(String(verifier || '')).digest('base64url');
}
function signNativeState(record = {}, ttlSeconds = 600) {
  if (!CHALLENGE.test(String(record.challenge || ''))) throw new Error('Invalid sign-in flow.');
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = Buffer.from(JSON.stringify({ ...record, kind: 'native', nonce, exp: Date.now() + ttlSeconds * 1000 })).toString('base64url');
  return NATIVE_PREFIX + payload + '.' + sign(payload);
}
const isNativeState = (state) => String(state || '').startsWith(NATIVE_PREFIX);
function readNativeState(state) {
  const value = String(state || '');
  if (!isNativeState(value) || value.length > 2048) return null;
  const [payload, mac, extra] = value.slice(NATIVE_PREFIX.length).split('.');
  if (!payload || !mac || extra !== undefined) return null;
  let expected;
  try { expected = sign(payload); } catch { return null; }
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let record;
  try { record = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!record || record.kind !== 'native' || !CHALLENGE.test(String(record.challenge || '')) || !(Number(record.exp) > Date.now())) return null;
  return record;
}
const sealKey = () => crypto.createHash('sha256').update('belna-native-session:' + oauthSecret()).digest();
function sealNativeSession(session, challenge, ttlSeconds = 120) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sealKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ ...session, challenge, exp: Date.now() + ttlSeconds * 1000 }), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}
function openNativeSession(code, verifier) {
  try {
    const raw = Buffer.from(String(code || ''), 'base64url');
    if (raw.length < 29 || raw.length > 8192) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', sealKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const record = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
    const a = Buffer.from(nativeChallenge(verifier)), b = Buffer.from(String(record.challenge || ''));
    if (!(Number(record.exp) > Date.now()) || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return record;
  } catch { return null; }
}

export { safeNext, bindOAuthBrowser, readOAuthBrowser, clearOAuthBrowser, consumeOAuthState, nativeChallenge, signNativeState, isNativeState, readNativeState, sealNativeSession, openNativeSession };
