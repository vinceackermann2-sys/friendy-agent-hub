const crypto = require('crypto');

// Return a canonical same-origin path. Check again after URL normalization:
// /one/..//other.example must not become a protocol-relative redirect.
function safeNext(value) {
  const raw = String(value || '/');
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(raw)) return '/';
  try {
    const base = 'https://oauth.invalid';
    const url = new URL(raw, base);
    if (url.origin !== base || url.pathname.startsWith('//')) return '/';
    return url.pathname + url.search + url.hash;
  } catch { return '/'; }
}

function bindOAuthBrowser(res, state, redirectUri) {
  const secure = new URL(redirectUri).protocol === 'https:';
  const nonce = crypto.randomBytes(32).toString('hex');
  // Host-prefixed cookies cannot be planted by sibling subdomains. A separate
  // cookie for each attempt lets two tabs finish their own sign-in flows.
  const cookieName = `${secure ? '__Host-' : ''}belna_oauth_${state}`;
  const binding = { nonce, cookieName, secure };
  res.setHeader('Set-Cookie', oauthCookie(binding, nonce, 600));
  res.setHeader('Cache-Control', 'no-store');
  return binding;
}

function oauthCookie(binding, value, maxAge) {
  return `${binding.cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${binding.secure ? '; Secure' : ''}`;
}

function matchesOAuthBrowser(req, binding) {
  if (!binding?.nonce || !binding.cookieName) return false;
  const values = String(req.headers.cookie || '').split(';').map(part => part.trim())
    .filter(part => part.startsWith(binding.cookieName + '='))
    .map(part => part.slice(binding.cookieName.length + 1));
  if (values.length !== 1 || !/^[a-f0-9]{64}$/.test(values[0])) return false;
  return crypto.timingSafeEqual(Buffer.from(values[0]), Buffer.from(binding.nonce));
}

function clearOAuthBrowser(res, binding) {
  res.setHeader('Set-Cookie', oauthCookie(binding, '', 0));
  res.setHeader('Cache-Control', 'no-store');
}

module.exports = { safeNext, bindOAuthBrowser, matchesOAuthBrowser, clearOAuthBrowser };
