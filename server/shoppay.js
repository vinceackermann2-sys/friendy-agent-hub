/* Shop Pay via Universal Commerce Protocol.
   User links Shop (accounts.shop.app). Tokens stay encrypted on the server.
   The agent never sees tokens, card numbers, or payment credentials.
   complete_checkout only runs after owner approval of a live quote. */
const crypto = require('crypto');
const store = require('./store');

const UCP_VERSION = '2026-08-25';
const SHOP_SCOPES = 'openid email dev.ucp.shopping.catalog.search:read';
function requestedScopes() {
  return SHOP_SCOPES + (env('SHOP_PAY_NATIVE_CHECKOUT') === '1' ? ' dev.ucp.shopping.checkout:manage' : '');
}
const CATALOG_HOST = 'catalog.shopify.com';
const DEFAULT_DAILY = 200;
const MAX_USD = 2000;
const DISCOVERY_TTL = 50 * 60e3;
const discoveryCache = new Map();

function env(name) {
  return String(process.env[name] || process.env['LINGON_' + name] || '').trim();
}
let credentialCache = { clientId: '', clientSecret: '', expiresAt: 0 };
function pair(id, secret) { return id && secret ? { id, secret } : null; }
function catalogCredentials() {
  return pair(env('SHOPIFY_CLIENT_ID'), env('SHOPIFY_CLIENT_SECRET'))
    || pair(credentialCache.clientId, credentialCache.clientSecret);
}
function shopCredentials() {
  return pair(env('SHOP_PAY_CLIENT_ID'), env('SHOP_PAY_CLIENT_SECRET'))
    || pair(credentialCache.clientId, credentialCache.clientSecret)
    || pair(env('SHOPIFY_CLIENT_ID'), env('SHOPIFY_CLIENT_SECRET'));
}
function configured() { return !!shopCredentials(); }
async function loadCredentials() {
  if (credentialCache.expiresAt > Date.now()) return;
  const url = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY');
  if (!url || !key) { credentialCache.expiresAt = Date.now() + 30e3; return; }
  const readSecret = async (name) => {
    const response = await fetch(`${url}/rest/v1/rpc/get_server_secret`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_name: name }),
    });
    if (!response.ok) return '';
    return String(await response.json().catch(() => '') || '').trim();
  };
  try {
    const [id, secret] = await Promise.all([
      readSecret('shopify_client_id'),
      readSecret('shopify_client_secret'),
    ]);
    credentialCache = { clientId: id, clientSecret: secret, expiresAt: Date.now() + (id && secret ? 5 : 0.5) * 60e3 };
  } catch {
    credentialCache.expiresAt = Date.now() + 30e3;
  }
}
function siteUrl() { return env('SITE_URL').replace(/\/$/, ''); }
function profileUrl(origin) {
  const base = String(origin || siteUrl() || '').replace(/\/$/, '');
  return base ? base + '/.well-known/ucp' : 'https://shopify.dev/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json';
}
function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}
function requireUser(userId) {
  if (!String(userId || '').trim()) fail('BAD_INPUT', 'Signed-in user required for Shop Pay.');
  return String(userId);
}

function platformProfile(origin) {
  const v = UCP_VERSION;
  return {
    ucp: {
      version: v,
      services: {
        'dev.ucp.shopping': [
          { version: v, spec: 'https://ucp.dev/2026-08-25/specification/overview', transport: 'mcp', schema: 'https://ucp.dev/2026-08-25/services/shopping/mcp.openrpc.json' },
          { version: v, spec: 'https://ucp.dev/2026-08-25/specification/overview', transport: 'rest', schema: 'https://ucp.dev/2026-08-25/services/shopping/rest.openapi.json' },
        ],
      },
      capabilities: {
        'dev.ucp.shopping.checkout': [{ version: v, spec: 'https://ucp.dev/2026-08-25/specification/shopping/checkout', schema: 'https://ucp.dev/2026-08-25/schemas/shopping/checkout.json' }],
        'dev.ucp.shopping.cart': [{ version: v, spec: 'https://ucp.dev/2026-08-25/specification/shopping/cart', schema: 'https://ucp.dev/2026-08-25/schemas/shopping/cart.json' }],
        'dev.ucp.shopping.fulfillment': [{ version: v, extends: ['dev.ucp.shopping.checkout', 'dev.ucp.shopping.cart'] }],
        'dev.ucp.shopping.discount': [{ version: v, extends: ['dev.ucp.shopping.checkout', 'dev.ucp.shopping.cart'] }],
        'dev.ucp.shopping.buyer_consent': [{ version: v, extends: 'dev.ucp.shopping.checkout' }],
        'dev.ucp.shopping.order': [{ version: v }],
        'dev.ucp.shopping.catalog.search': [{ version: v }],
        'dev.ucp.shopping.catalog.lookup': [{ version: v }],
        'dev.ucp.common.identity_linking': [{ version: v }],
        'dev.shopify.catalog': [{ version: v, extends: ['dev.ucp.shopping.catalog.lookup', 'dev.ucp.shopping.catalog.search'] }],
        'dev.shopify.catalog.global': [{ version: v, extends: ['dev.ucp.shopping.catalog.lookup', 'dev.ucp.shopping.catalog.search'] }],
      },
      payment_handlers: {
        'dev.shopify.shop_pay': [{
          id: 'shop_pay',
          version: '2026-04-08',
          spec: 'https://shopify.dev/ucp/shop-pay-handler/2026-04-08/spec.md',
          schema: 'https://shopify.dev/ucp/shop-pay-handler/2026-04-08/schema.json',
        }],
      },
    },
    name: 'Lingon',
    url: origin || siteUrl() || undefined,
  };
}

function pkceVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}
function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}
function decodeJwt(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return {};
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch { return {}; }
}

function merchantHost(raw) {
  let host = String(raw || '').trim();
  if (!host) fail('BAD_INPUT', 'Merchant domain is required.');
  if (host.startsWith('gid://')) fail('BAD_INPUT', 'Pass the merchant store domain, not a Shopify GID.');
  try {
    const u = new URL(host.includes('://') ? host : 'https://' + host);
    if (u.protocol !== 'https:') fail('BAD_INPUT', 'Merchant must be https.');
    if (u.username || u.password) fail('BAD_INPUT', 'Invalid merchant.');
    host = u.hostname.toLowerCase();
  } catch (e) {
    if (e && e.code) throw e;
    fail('BAD_INPUT', 'Invalid merchant domain.');
  }
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)) fail('BAD_INPUT', 'Invalid merchant domain.');
  if (host === 'localhost' || host.endsWith('.local') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) fail('BAD_INPUT', 'Invalid merchant domain.');
  return host;
}

async function getJson(url, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': 'Lingon/1.0 (+ucp)' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  } finally { clearTimeout(t); }
}

async function cached(key, fn) {
  const hit = discoveryCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = await fn();
  discoveryCache.set(key, { value, exp: Date.now() + DISCOVERY_TTL });
  return value;
}

async function shopAuthServer() {
  return cached('shop-as', async () => {
    try {
      const meta = await getJson('https://accounts.shop.app/.well-known/oauth-authorization-server');
      if (meta.authorization_endpoint && meta.token_endpoint) return meta;
    } catch {}
    return {
      issuer: 'https://accounts.shop.app',
      authorization_endpoint: 'https://accounts.shop.app/oauth/authorize',
      token_endpoint: 'https://accounts.shop.app/oauth/token',
      revocation_endpoint: 'https://accounts.shop.app/oauth/revoke',
    };
  });
}

// A Catalog API key can mint app tokens yet still be unknown to Shop's sign-in
// service. Check the OAuth client before redirecting the buyer to that error.
const shopClientChecks = new Map();
async function checkShopClient(shop, credentials, redirectUri) {
  const cacheKey = crypto.createHash('sha256').update(credentials.id + '\0' + credentials.secret + '\0' + redirectUri).digest('hex');
  if (shopClientChecks.get(cacheKey) > Date.now()) return;
  const response = await fetch(shop.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: 'lingon-client-check', redirect_uri: redirectUri,
      client_id: credentials.id, client_secret: credentials.secret, code_verifier: 'lingon-client-check',
    }),
  });
  const result = await response.json().catch(() => ({}));
  const error = String(result.error || result.error_description || '').toLowerCase();
  if (error === 'invalid_client' || /unknown[ _-]client/.test(error)) {
    fail('SHOP_CONFIG', 'Shop does not recognize the configured OAuth client. Add the Shop sign-in client ID and secret and register ' + redirectUri + ' as its redirect URI.');
  }
  if (error !== 'invalid_grant') fail('SHOP_HTTP', 'Could not verify the Shop Pay sign-in configuration. Try again shortly.');
  shopClientChecks.set(cacheKey, Date.now() + 10 * 60e3);
}

async function shopifyTokenEndpoint(resourceHost) {
  const host = resourceHost || CATALOG_HOST;
  return cached('shopify-as:' + host, async () => {
    try {
      const pr = await getJson('https://' + host + '/.well-known/oauth-protected-resource');
      const issuer = new URL((pr.authorization_servers || [])[0] || 'https://api.shopify.com');
      const path = issuer.pathname === '/' ? '' : issuer.pathname;
      const meta = await getJson(issuer.origin + '/.well-known/oauth-authorization-server' + path);
      const audience = path ? host : issuer.host;
      return { audience, tokenEndpoint: meta.token_endpoint, issuer: issuer.href };
    } catch {
      return { audience: 'api.shopify.com', tokenEndpoint: 'https://api.shopify.com/auth/access_token', issuer: 'https://api.shopify.com' };
    }
  });
}

async function formPost(url, fields, extraHeaders) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Lingon/1.0 (+ucp)', ...(extraHeaders || {}) },
    body: new URLSearchParams(fields),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json.error) {
    const msg = String(json.error_description || json.error || json.message || ('HTTP ' + r.status)).slice(0, 240);
    fail('SHOP_HTTP', msg);
  }
  return json;
}

let appTokenCache = { token: '', exp: 0 };
async function appAccessToken() {
  await loadCredentials();
  const credentials = catalogCredentials();
  if (!credentials) fail('NO_SHOP', 'Shopify Catalog is not configured (SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET).');
  if (appTokenCache.token && appTokenCache.exp > Date.now() + 30e3) return appTokenCache.token;
  const r = await fetch('https://api.shopify.com/auth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Lingon/1.0 (+ucp)' },
    body: JSON.stringify({ client_id: credentials.id, client_secret: credentials.secret, grant_type: 'client_credentials' }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || !json.access_token) fail('SHOP_HTTP', String(json.error_description || json.error || 'Could not mint Shopify token.').slice(0, 240));
  appTokenCache = { token: json.access_token, exp: Date.now() + Math.max(60, Number(json.expires_in || 3600) - 90) * 1000 };
  return json.access_token;
}

function shopTokenFromRow(row) {
  if (!row || !row.encryptedShopToken) return '';
  return store.openSecret(row.encryptedShopToken) || '';
}

async function buyerLinkedToken(userId, { resourceHost, scope } = {}) {
  await loadCredentials();
  const credentials = shopCredentials();
  if (!credentials) fail('NO_SHOP', 'Shop Pay sign-in is not configured.');
  const row = await store.getShopPayAccount(userId);
  let shopToken = shopTokenFromRow(row);
  if (!shopToken) fail('NO_SHOP_LINK', 'Connect Shop Pay in Payments first.');
  const shop = await shopAuthServer();
  if (row.shopTokenExpiresAt && row.shopTokenExpiresAt < Date.now() + 15e3) {
    const refreshToken = row.encryptedRefreshToken && store.openSecret(row.encryptedRefreshToken);
    if (!refreshToken) fail('NO_SHOP_LINK', 'Shop Pay session expired — reconnect Shop Pay.');
    const refreshed = await formPost(shop.token_endpoint, {
      grant_type: 'refresh_token', refresh_token: refreshToken,
      client_id: credentials.id, client_secret: credentials.secret,
    });
    shopToken = refreshed.access_token;
    if (!shopToken) fail('NO_SHOP_LINK', 'Shop Pay session expired — reconnect Shop Pay.');
    await store.upsertShopPayAccount(userId, {
      encryptedShopToken: store.sealSecret(shopToken),
      encryptedRefreshToken: refreshed.refresh_token ? store.sealSecret(refreshed.refresh_token) : row.encryptedRefreshToken,
      shopTokenExpiresAt: Date.now() + Math.max(60, Number(refreshed.expires_in || 3600) - 30) * 1000,
      scopes: refreshed.scope || row.scopes,
    });
  }
  const shopify = await shopifyTokenEndpoint(resourceHost || CATALOG_HOST);
  const grant = await formPost(shop.token_endpoint, {
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: shopToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    requested_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    audience: shopify.audience,
    client_id: credentials.id,
    client_secret: credentials.secret,
  });
  const redeemed = await formPost(shopify.tokenEndpoint, {
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: grant.access_token,
    scope: scope || 'dev.ucp.shopping.catalog.search:read dev.ucp.shopping.checkout:manage openid',
    client_id: credentials.id,
    client_secret: credentials.secret,
  });
  return redeemed.access_token;
}

async function bearerFor(userId, { resourceHost, scope, allowApp = true } = {}) {
  const row = userId ? await store.getShopPayAccount(userId) : null;
  if (shopTokenFromRow(row)) {
    try { return await buyerLinkedToken(userId, { resourceHost, scope }); }
    catch (e) { if (!allowApp || e.code === 'NO_SHOP') throw e; }
  }
  if (!allowApp) fail('NO_SHOP_LINK', 'Connect Shop Pay in Payments first.');
  return appAccessToken();
}

function mcpMeta(origin) {
  return { 'ucp-agent': { profile: profileUrl(origin) } };
}

async function mcpCall(url, name, args, token) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Lingon/1.0 (+ucp)',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const json = await r.json().catch(() => ({}));
  if (json.error) fail('SHOP_HTTP', String(json.error.message || json.error.code || 'UCP call failed').slice(0, 240));
  const content = json.result && (json.result.structuredContent || json.result);
  if (!content) fail('SHOP_HTTP', 'Empty UCP response.');
  return content;
}

function money(amount, currency) {
  const n = Number(amount);
  if (!Number.isSafeInteger(n)) return null;
  const code = String(currency || 'USD').toUpperCase();
  let digits;
  try {
    digits = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
  } catch {
    return null;
  }
  return { amount: n / (10 ** digits), currency: code, minor: n };
}

function publicProduct(p) {
  const variants = (p.variants || []).slice(0, 8).map((v) => ({
    id: v.id,
    title: v.title || v.sku || null,
    price: v.price && v.price.amount != null ? money(v.price.amount, v.price.currency) : null,
    available: !!(v.availability && v.availability.available !== false),
    seller: v.seller ? { name: v.seller.name, domain: v.seller.domain } : null,
    checkoutUrl: v.checkout_url || null,
  }));
  const range = p.price_range || {};
  return {
    id: p.id,
    title: p.title,
    url: p.url || null,
    price: range.min ? money(range.min.amount, range.min.currency) : (variants[0] && variants[0].price) || null,
    image: (p.media && p.media[0] && p.media[0].url) || null,
    variants,
    seller: (variants[0] && variants[0].seller) || null,
  };
}

function publicCheckout(chk, merchant) {
  if (!chk || typeof chk !== 'object') return { merchant };
  const items = (chk.line_items || []).map((li) => ({
    id: li.id,
    title: (li.item && li.item.title) || null,
    quantity: li.quantity,
    price: li.item && li.item.price != null ? money(li.item.price, chk.currency) : null,
  }));
  const messages = (chk.messages || []).map((m) => ({
    type: m.type, code: m.code, severity: m.severity, content: String(m.content || '').slice(0, 240),
  }));
  return {
    id: chk.id,
    merchant,
    status: chk.status,
    currency: chk.currency || 'USD',
    totals: (chk.totals || []).map((t) => ({ type: t.type, amount: money(t.amount, chk.currency), label: t.display_text || t.type })),
    lineItems: items,
    messages,
    continueUrl: chk.continue_url || null,
    orderId: chk.order && chk.order.id ? chk.order.id : null,
    orderUrl: chk.order && chk.order.permalink_url ? chk.order.permalink_url : null,
    expiresAt: chk.expires_at || null,
  };
}

function publicAccount(row, extras) {
  const connected = !!(row && shopTokenFromRow(row) && row.connectedAt &&
    (!row.shopTokenExpiresAt || row.shopTokenExpiresAt > Date.now() || row.encryptedRefreshToken));
  return {
    configured: configured(),
    connected,
    email: connected ? (row.email || null) : null,
    displayName: connected ? (row.displayName || null) : null,
    dailyLimitUsd: row && row.dailyLimitUsd != null ? Number(row.dailyLimitUsd) : DEFAULT_DAILY,
    remainingUsd: extras && extras.remainingUsd != null ? extras.remainingUsd : null,
    connectedAt: connected ? row.connectedAt : null,
    handler: 'dev.shopify.shop_pay',
    nativeCheckout: connected && String(row.scopes || '').split(/\s+/).includes('dev.ucp.shopping.checkout:manage'),
    protocol: 'ucp',
  };
}

async function remainingUsd(userId, limit) {
  const cap = Number(limit != null ? limit : DEFAULT_DAILY);
  const start = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const orders = await store.listShopPayOrders(userId, 80);
  const spent = orders
    .filter((o) => o.at >= start && ['pending', 'authorized', 'escalated', 'completed'].includes(o.status))
    .reduce((n, o) => n + Number(o.amount || 0), 0);
  return Math.max(0, Math.round((cap - spent) * 100) / 100);
}

async function snapshot(userId) {
  await loadCredentials();
  const row = userId ? await store.getShopPayAccount(userId) : null;
  const orders = userId ? await store.listShopPayOrders(userId, 12) : [];
  const remaining = userId ? await remainingUsd(userId, row && row.dailyLimitUsd) : null;
  return {
    shopPay: publicAccount(row, { remainingUsd: remaining }),
    orders: orders.map((o) => ({
      id: o.id, merchant: o.merchant, status: o.status, amount: o.amount, currency: o.currency,
      title: o.title, continueUrl: o.continueUrl, orderId: o.orderId, at: o.at,
    })),
  };
}

async function agentStatus(userId) {
  const snap = await snapshot(userId);
  return {
    connected: snap.shopPay.connected,
    email: snap.shopPay.email,
    dailyLimitUsd: snap.shopPay.dailyLimitUsd,
    remainingUsd: snap.shopPay.remainingUsd,
    configured: snap.shopPay.configured,
    nativeCheckout: snap.shopPay.nativeCheckout,
    recent: snap.orders.slice(0, 5),
  };
}

async function startConnect(userId, { origin } = {}) {
  requireUser(userId);
  await loadCredentials();
  const credentials = shopCredentials();
  if (!credentials) fail('NO_SHOP', 'Shop Pay sign-in is not configured on this server yet.');
  const shop = await shopAuthServer();
  const state = crypto.randomBytes(24).toString('hex');
  const verifier = pkceVerifier();
  const nonce = crypto.randomBytes(16).toString('hex');
  const base = String(origin || siteUrl() || '').replace(/\/$/, '');
  if (!base) fail('BAD_INPUT', 'Site origin is required to connect Shop Pay.');
  const redirectUri = env('SHOP_PAY_REDIRECT_URI') || base + '/api/shop-pay/callback';
  await checkShopClient(shop, credentials, redirectUri);
  await store.upsertShopPayAccount(userId, {
    oauthState: state,
    oauthVerifier: verifier,
    oauthRedirect: redirectUri,
    oauthNonce: nonce,
    oauthExp: Date.now() + 10 * 60e3,
  });
  const url = new URL(shop.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', credentials.id);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', requestedScopes());
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', pkceChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return { url: url.toString() };
}

async function finishConnect({ code, state, error, error_description }) {
  await loadCredentials();
  const credentials = shopCredentials();
  if (!credentials) fail('NO_SHOP', 'Shop Pay sign-in is not configured on this server yet.');
  if (error) fail('BAD_INPUT', String(error_description || error || 'Shop Pay connect cancelled.').slice(0, 200));
  const row = await store.findShopPayByOAuthState(state);
  if (!row || !row.oauthExp || row.oauthExp < Date.now()) fail('BAD_INPUT', 'Shop Pay connect expired — try again.');
  if (!code) fail('BAD_INPUT', 'Shop Pay did not return an authorization code.');
  const shop = await shopAuthServer();
  const tok = await formPost(shop.token_endpoint, {
    grant_type: 'authorization_code',
    code: String(code),
    redirect_uri: row.oauthRedirect,
    client_id: credentials.id,
    client_secret: credentials.secret,
    code_verifier: row.oauthVerifier,
  });
  const claims = decodeJwt(tok.id_token);
  if (row.oauthNonce && claims.nonce && claims.nonce !== row.oauthNonce) fail('BAD_INPUT', 'Shop Pay nonce mismatch.');
  const expires = Date.now() + Math.max(60, Number(tok.expires_in || 3600) - 30) * 1000;
  await store.upsertShopPayAccount(row.userId, {
    shopSubject: claims.sub || null,
    email: claims.email || null,
    displayName: claims.name || claims.email || null,
    scopes: tok.scope || SHOP_SCOPES,
    encryptedShopToken: store.sealSecret(tok.access_token),
    encryptedRefreshToken: tok.refresh_token ? store.sealSecret(tok.refresh_token) : null,
    shopTokenExpiresAt: expires,
    connectedAt: Date.now(),
    oauthState: null,
    oauthVerifier: null,
    oauthRedirect: null,
    oauthNonce: null,
    oauthExp: null,
  });
  return { userId: row.userId, email: claims.email || null };
}

async function disconnect(userId) {
  requireUser(userId);
  await loadCredentials();
  const row = await store.getShopPayAccount(userId);
  const token = shopTokenFromRow(row);
  const credentials = shopCredentials();
  if (token) {
    try {
      const shop = await shopAuthServer();
      if (shop.revocation_endpoint && credentials) {
        await formPost(shop.revocation_endpoint, {
          token, token_type_hint: 'access_token', client_id: credentials.id, client_secret: credentials.secret,
        });
      }
    } catch {}
  }
  await store.deleteShopPayAccount(userId);
  return snapshot(userId);
}

async function setDailyLimit(userId, usd) {
  requireUser(userId);
  const n = Number(usd);
  if (!(n >= 1) || n > MAX_USD || !Number.isFinite(n)) fail('BAD_INPUT', 'Daily Shop Pay limit must be between $1 and $' + MAX_USD + '.');
  await store.upsertShopPayAccount(userId, { dailyLimitUsd: Math.round(n * 100) / 100 });
  return snapshot(userId);
}

function normalizeItems(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) fail('BAD_INPUT', 'At least one item is required.');
  return list.slice(0, 20).map((it) => {
    const id = String((it && (it.id || it.variantId || it.item_id)) || '').trim();
    const qty = Math.max(1, Math.min(20, Number(it && it.quantity) || 1));
    if (!id || id.length > 200) fail('BAD_INPUT', 'Each item needs a catalog variant id.');
    return { quantity: qty, item: { id } };
  });
}

async function searchCatalog(userId, { query, country, limit } = {}) {
  const q = String(query || '').trim().slice(0, 200);
  if (q.length < 2) fail('BAD_INPUT', 'Search query is required.');
  const token = await bearerFor(userId, { resourceHost: CATALOG_HOST, scope: 'dev.ucp.shopping.catalog.search:read', allowApp: true });
  const out = await mcpCall('https://' + CATALOG_HOST + '/api/ucp/mcp', 'search_catalog', {
    meta: mcpMeta(),
    catalog: {
      query: q,
      context: { address_country: String(country || 'US').slice(0, 2).toUpperCase() },
      pagination: { limit: Math.max(1, Math.min(10, Number(limit) || 6)) },
    },
  }, token);
  return { products: (out.products || []).slice(0, 10).map(publicProduct) };
}

async function getProduct(userId, { id } = {}) {
  const pid = String(id || '').trim();
  if (!pid) fail('BAD_INPUT', 'Product id is required.');
  const token = await bearerFor(userId, { resourceHost: CATALOG_HOST, allowApp: true });
  const out = await mcpCall('https://' + CATALOG_HOST + '/api/ucp/mcp', 'get_product', {
    meta: mcpMeta(),
    catalog: { id: pid },
  }, token);
  return { product: publicProduct(out.product || out) };
}

async function createCheckout(userId, { merchant, items, cartId, email, firstName, lastName, address, country, currency } = {}) {
  requireUser(userId);
  const host = merchantHost(merchant);
  const lineItems = cartId ? [] : normalizeItems(items);
  const token = await bearerFor(userId, {
    resourceHost: host,
    scope: 'openid dev.ucp.shopping.checkout:manage',
    allowApp: true,
  });
  const buyer = {};
  if (email) buyer.email = String(email).slice(0, 120);
  if (firstName) buyer.first_name = String(firstName).slice(0, 60);
  if (lastName) buyer.last_name = String(lastName).slice(0, 60);
  const dest = address && typeof address === 'object' ? {
    first_name: String(address.firstName || firstName || '').slice(0, 60) || undefined,
    last_name: String(address.lastName || lastName || '').slice(0, 60) || undefined,
    street_address: String(address.street || address.street_address || '').slice(0, 120) || undefined,
    address_locality: String(address.city || address.address_locality || '').slice(0, 80) || undefined,
    address_region: String(address.region || address.address_region || '').slice(0, 40) || undefined,
    postal_code: String(address.postal || address.postal_code || '').slice(0, 20) || undefined,
    address_country: String(address.country || country || 'US').slice(0, 2).toUpperCase(),
  } : null;
  const checkout = {
    currency: String(currency || 'USD').slice(0, 3).toUpperCase(),
    line_items: lineItems,
    buyer: Object.keys(buyer).length ? buyer : undefined,
    context: { address_country: String((dest && dest.address_country) || country || 'US').slice(0, 2).toUpperCase() },
  };
  if (dest && dest.street_address) {
    checkout.fulfillment = { methods: [{ type: 'shipping', destinations: [dest] }] };
  }
  const args = { meta: mcpMeta(), checkout };
  if (cartId) args.cart_id = String(cartId);
  const out = await mcpCall('https://' + host + '/api/ucp/mcp', 'create_checkout', args, token);
  return publicCheckout(out, host);
}

async function updateCheckout(userId, { merchant, checkoutId, items, email, firstName, lastName, address, country } = {}) {
  requireUser(userId);
  const host = merchantHost(merchant);
  const id = String(checkoutId || '').trim();
  if (!id) fail('BAD_INPUT', 'Checkout id is required.');
  const token = await bearerFor(userId, { resourceHost: host, scope: 'openid dev.ucp.shopping.checkout:manage', allowApp: true });
  const checkout = {
    line_items: items ? normalizeItems(items) : undefined,
    buyer: email || firstName || lastName ? {
      email: email ? String(email).slice(0, 120) : undefined,
      first_name: firstName ? String(firstName).slice(0, 60) : undefined,
      last_name: lastName ? String(lastName).slice(0, 60) : undefined,
    } : undefined,
  };
  if (address && address.street) {
    checkout.fulfillment = {
      methods: [{
        type: 'shipping',
        destinations: [{
          first_name: String(address.firstName || firstName || '').slice(0, 60) || undefined,
          last_name: String(address.lastName || lastName || '').slice(0, 60) || undefined,
          street_address: String(address.street || '').slice(0, 120),
          address_locality: String(address.city || '').slice(0, 80),
          address_region: String(address.region || '').slice(0, 40),
          postal_code: String(address.postal || '').slice(0, 20),
          address_country: String(address.country || country || 'US').slice(0, 2).toUpperCase(),
        }],
      }],
    };
  }
  const out = await mcpCall('https://' + host + '/api/ucp/mcp', 'update_checkout', {
    meta: mcpMeta(), id, checkout,
  }, token);
  return publicCheckout(out, host);
}

async function getCheckout(userId, { merchant, checkoutId } = {}) {
  const host = merchantHost(merchant);
  return publicCheckout(await getCheckoutRaw(userId, { merchant: host, checkoutId }), host);
}

async function getCheckoutRaw(userId, { merchant, checkoutId, buyerOnly = false } = {}) {
  requireUser(userId);
  const host = merchantHost(merchant);
  const id = String(checkoutId || '').trim();
  if (!id) fail('BAD_INPUT', 'Checkout id is required.');
  const token = await bearerFor(userId, { resourceHost: host, scope: 'openid dev.ucp.shopping.checkout:manage', allowApp: !buyerOnly });
  return mcpCall('https://' + host + '/api/ucp/mcp', 'get_checkout', {
    meta: mcpMeta(), id,
  }, token);
}

function quoteFromCheckout(checkout, merchant) {
  const current = publicCheckout(checkout, merchant);
  const total = current.totals.find((t) => t.type === 'total');
  const amount = total && total.amount ? Number(total.amount.amount) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) fail('BAD_INPUT', 'Checkout total is missing.');
  const destinations = (checkout.fulfillment?.methods || []).flatMap((method) => method.destinations || []);
  const quote = {
    merchant, checkoutId: current.id, status: current.status,
    amount, currency: current.currency,
    items: current.lineItems.map((item) => ({ id: item.id, title: item.title, quantity: item.quantity, price: item.price?.amount ?? null })),
    buyerEmail: String(checkout.buyer?.email || '').slice(0, 120),
    delivery: destinations.map((d) => [d.street_address, d.address_locality, d.address_region, d.postal_code, d.address_country].filter(Boolean).join(', ')).slice(0, 2),
  };
  quote.fingerprint = crypto.createHash('sha256').update(JSON.stringify(quote)).digest('hex');
  return quote;
}

async function purchaseQuote(userId, { merchant, checkoutId } = {}) {
  const host = merchantHost(merchant);
  const checkout = await getCheckoutRaw(userId, { merchant: host, checkoutId });
  if (checkout.status === 'completed' || checkout.status === 'canceled') fail('BAD_INPUT', 'This checkout is already closed.');
  return quoteFromCheckout(checkout, host);
}

function approvedQuoteMatches(approved, current) {
  let parsed;
  try { parsed = typeof approved === 'string' ? JSON.parse(approved) : approved; } catch { return false; }
  return parsed && parsed.merchant === current.merchant && parsed.checkoutId === current.checkoutId
    && parsed.fingerprint === current.fingerprint;
}

function shopPayInstrument(checkout) {
  const handlers = checkout.ucp?.payment_handlers?.['dev.shopify.shop_pay'] || checkout.payment_handlers?.['dev.shopify.shop_pay'] || [];
  const ids = new Set(handlers.map((handler) => handler.id));
  const instruments = checkout.payment?.instruments || [];
  const found = instruments.find((instrument) => instrument.type === 'shop_pay'
    && (ids.size ? ids.has(instrument.handler_id) : instrument.handler_id === 'shop_pay')
    && instrument.credential?.type === 'shop_token' && typeof instrument.credential.token === 'string' && instrument.credential.token.length > 0);
  if (!found) return null;
  return { id: found.id, handler_id: found.handler_id, type: 'shop_pay', selected: true,
    credential: { type: 'shop_token', token: found.credential.token } };
}

function buyerHandoff(current, quote, note) {
  return {
    status: 'needs_buyer', method: 'shop_pay', merchant: quote.merchant, amount: quote.amount,
    currency: quote.currency, checkoutId: quote.checkoutId, continueUrl: current.continueUrl || null,
    messages: current.messages || [], note,
  };
}

function completionKey(userId, host, checkoutId) {
  const hex = crypto.createHash('sha256').update(JSON.stringify([userId, host, checkoutId])).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function completePurchase(userId, { merchant, checkoutId, confirm, approvedQuote } = {}) {
  requireUser(userId);
  if (!confirm) fail('NEED_CONFIRM', 'Owner confirmation is required before any Shop Pay purchase.');
  const host = merchantHost(merchant);
  const id = String(checkoutId || '').trim();
  if (!id) fail('BAD_INPUT', 'Checkout id is required.');
  if (!approvedQuote) fail('NEED_CONFIRM', 'A checkout approval card is required.');
  const row = await store.getShopPayAccount(userId);
  const checkout = await getCheckoutRaw(userId, { merchant: host, checkoutId: id });
  if (checkout.status === 'completed' && checkout.order?.id) return {
    status: 'completed', method: 'shop_pay', merchant: host, checkoutId: id,
    orderId: checkout.order.id, orderUrl: checkout.order.permalink_url || null,
  };
  const current = publicCheckout(checkout, host);
  const quote = quoteFromCheckout(checkout, host);
  if (!approvedQuoteMatches(approvedQuote, quote)) fail('NEED_CONFIRM', 'Checkout details changed. Review and approve the new total before purchasing.');
  if (current.status !== 'ready_for_complete') return buyerHandoff(current, quote, 'Finish this checkout in Shop Pay on the merchant site.');
  if (quote.currency !== 'USD') return buyerHandoff(current, quote, 'This currency needs buyer checkout in Shop Pay.');
  if (!row || !shopTokenFromRow(row) || !String(row.scopes || '').split(/\s+/).includes('dev.ucp.shopping.checkout:manage')) {
    return buyerHandoff(current, quote, 'Shop Pay is not enabled for native completion. Finish on the merchant site.');
  }
  const instrument = shopPayInstrument(checkout);
  if (!instrument) return buyerHandoff(current, quote, 'Shop Pay needs buyer payment review on the merchant site.');
  if (quote.amount > MAX_USD) fail('LIMIT', 'Checkout exceeds the Shop Pay purchase limit.');
  const token = await bearerFor(userId, { resourceHost: host, scope: 'openid dev.ucp.shopping.checkout:manage', allowApp: false });
  const limit = row && row.dailyLimitUsd != null ? row.dailyLimitUsd : DEFAULT_DAILY;
  const title = (current.lineItems || []).map((i) => i.title).filter(Boolean).slice(0, 3).join(', ') || host;
  const reserved = await store.reserveShopPaySpend(userId, {
    merchant: host, checkoutId: id, amount: quote.amount, currency: quote.currency,
    title, status: 'authorized',
  }, limit);
  if (reserved.status === 'completed') return { status: 'completed', merchant: host, amount: quote.amount,
    currency: quote.currency, checkoutId: id, orderId: reserved.orderId || reserved.id, orderUrl: reserved.orderUrl || null };
  let out;
  try {
    out = await mcpCall('https://' + host + '/api/ucp/mcp', 'complete_checkout', {
      meta: { ...mcpMeta(), 'idempotency-key': completionKey(userId, host, id) },
      id, checkout: { payment: { instruments: [instrument], selected_instrument_id: instrument.id } },
    }, token);
  } catch (e) {
    if (!/checkout_completion_ineligible|redirect_to_checkout_required/.test(String(e.message || ''))) throw e;
    await store.updateShopPayOrder(userId, reserved.id, { status: 'escalated', continueUrl: current.continueUrl || null });
    return buyerHandoff(current, quote, 'Shop Pay requires buyer checkout on the merchant site.');
  }
  const result = publicCheckout(out, host);
  const completed = result.status === 'completed' && !!result.orderId;
  await store.updateShopPayOrder(userId, reserved.id, {
    status: completed ? 'completed' : 'escalated', orderId: result.orderId || null,
    continueUrl: result.continueUrl || current.continueUrl || null,
  });
  return {
    status: completed ? 'completed' : 'needs_buyer',
    method: 'shop_pay',
    merchant: host,
    amount: quote.amount,
    currency: quote.currency,
    checkoutId: id,
    continueUrl: completed ? null : (result.continueUrl || current.continueUrl || null),
    messages: result.messages || [],
    orderId: result.orderId || reserved.id,
    orderUrl: result.orderUrl || null,
    note: completed ? 'Order placed with Shop Pay.' : 'Finish this checkout in Shop Pay on the merchant site.',
  };
}

async function getOrder(userId, { merchant, orderId } = {}) {
  requireUser(userId);
  const host = merchantHost(merchant);
  const id = String(orderId || '').trim();
  if (!id) fail('BAD_INPUT', 'Order id is required.');
  const token = await bearerFor(userId, { resourceHost: host, allowApp: true });
  const out = await mcpCall('https://' + host + '/api/ucp/mcp', 'get_order', {
    meta: mcpMeta(), id,
  }, token);
  return {
    id: out.id,
    merchant: host,
    status: out.financial_status || out.status || null,
    fulfillment: out.fulfillment_status || null,
    permalink: out.permalink_url || null,
    totals: out.totals || [],
    lineItems: (out.line_items || []).map((li) => ({ title: li.title, quantity: li.quantity })),
  };
}

module.exports = {
  UCP_VERSION, configured, platformProfile, profileUrl, merchantHost, pkceChallenge, pkceVerifier,
  publicAccount, publicProduct, publicCheckout, decodeJwt,
  snapshot, agentStatus, startConnect, finishConnect, disconnect, setDailyLimit,
  searchCatalog, getProduct, createCheckout, updateCheckout, getCheckout, purchaseQuote, completePurchase, getOrder,
};
