/* Belna <-> Composio bridge (server-side only).
   The Composio project API key never leaves the server. The browser only ever
   sees Belna URLs + Composio's hosted Connect Link (redirect_url).
   user_id mapping: Belna Supabase user id -> Composio user id (`belna:<supabase-id>`),
   so every Belna account gets isolated connected accounts.
*/
const BASE = 'https://backend.composio.dev/api/v3.1';
import crypto from 'node:crypto';

function apiKey() {
  return String(
    process.env.COMPOSIO_API_KEY ||
      process.env.LINGON_COMPOSIO_API_KEY ||
      ''
  ).trim();
}
function configured() {
  return apiKey().length > 5;
}
function composioUserId(belnaUserId) {
  return `belna:${String(belnaUserId || 'anon').trim()}`;
}
function siteOrigin(req) {
  const env = String(
    process.env.SITE_URL || process.env.LINGON_SITE_URL || ''
  ).replace(/\/$/, '');
  if (env) return env;
  try {
    const host = (req.get && req.get('host')) || req.headers.host || '';
    const fallback = host ? ((req.protocol || 'https') + '://' + host).replace(/\/$/, '') : '';
    if (req.headers.origin && host) {
      const origin = new URL(String(req.headers.origin));
      if (origin.host === host) return origin.origin.replace(/\/$/, '');
    }
    return fallback;
  } catch {}
  return '';
}

function supabaseServerConfig() {
  return {
    url: String(process.env.SUPABASE_URL || process.env.LINGON_SUPABASE_URL || '').replace(/\/$/, ''),
    key: String(
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.LINGON_SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY || process.env.LINGON_SUPABASE_SECRET_KEY || ''
    ).trim(),
  };
}

let webhookSecretCache = { value: '', at: 0 };
async function webhookSecret() {
  const configured = String(process.env.COMPOSIO_WEBHOOK_SECRET || '').trim();
  if (configured) return configured;
  if (webhookSecretCache.value && Date.now() - webhookSecretCache.at < 5 * 60 * 1000) return webhookSecretCache.value;
  const sb = supabaseServerConfig();
  if (!sb.url || !sb.key) return '';
  const response = await fetch(`${sb.url}/rest/v1/rpc/get_server_secret`, {
    method: 'POST',
    headers: { apikey: sb.key, Authorization: `Bearer ${sb.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_name: 'composio_webhook_secret' }),
  });
  if (!response.ok) return '';
  const value = String(await response.json().catch(() => '') || '').trim();
  if (value) webhookSecretCache = { value, at: Date.now() };
  return value;
}

async function verifyWebhook(raw, headers = {}) {
  const secret = await webhookSecret();
  if (!secret) return false;
  const id = String(headers['webhook-id'] || '').trim();
  const timestamp = String(headers['webhook-timestamp'] || '').trim();
  const signature = String(headers['webhook-signature'] || '').trim();
  if (!id || !timestamp || !signature) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  const payload = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  const expected = crypto.createHmac('sha256', secret).update(`${id}.${timestamp}.${payload}`).digest('base64');
  return signature.split(' ').some((part) => {
    const supplied = part.includes(',') ? part.slice(part.indexOf(',') + 1) : part;
    try {
      const a = Buffer.from(expected);
      const b = Buffer.from(supplied);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch { return false; }
  });
}

async function cfetch(path, { method = 'GET', body } = {}) {
  const key = apiKey();
  if (!key) {
    const e = new Error('Composio is not configured on the server (COMPOSIO_API_KEY).');
    e.code = 'NO_COMPOSIO';
    throw e;
  }
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'x-api-key': key,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!r.ok) {
    const msg =
      (json && json.error && (json.error.message || json.error.slug)) ||
      (json && json.message) ||
      `Composio HTTP ${r.status}`;
    const e = new Error(String(msg).slice(0, 500));
    e.code = 'COMPOSIO_HTTP';
    e.status = r.status;
    e.detail = text.slice(0, 2000);
    throw e;
  }
  return json;
}

// ---- auth configs (the "apps ready for users to connect") ----
let authCache = { at: 0, items: [] };
async function listAuthConfigs(force = false) {
  if (!force && Date.now() - authCache.at < 10 * 60 * 1000 && authCache.items.length) {
    return authCache.items;
  }
  const all = [];
  let cursor = null;
  for (let i = 0; i < 10; i++) {
    const j = await cfetch(
      '/auth_configs?limit=50' + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')
    );
    for (const it of j.items || []) {
      if (String(it.status || '').toUpperCase() !== 'ENABLED') continue;
      all.push({
        id: it.id,
        name: it.name,
        toolkit: String((it.toolkit && it.toolkit.slug) || '').toLowerCase(),
        toolkitLogo: (it.toolkit && it.toolkit.logo) || '',
        authScheme: it.auth_scheme || 'OAUTH2',
        managed: !!it.is_composio_managed,
      });
    }
    cursor = j.next_cursor || j.nextCursor || null;
    if (!cursor) break;
  }
  // Dedupe by toolkit: keep the config with most connections (or first).
  // The project has 61 configs, mostly 1:1 with toolkit — keep all but prefer
  // one default per toolkit for the UI, while remembering alternates.
  const byToolkit = new Map();
  for (const c of all) {
    if (!c.toolkit) continue;
    if (!byToolkit.has(c.toolkit)) byToolkit.set(c.toolkit, c);
  }
  const items = [...byToolkit.values()].sort((a, b) => a.toolkit.localeCompare(b.toolkit));
  authCache = { at: Date.now(), items };
  return items;
}

// ---- toolkit metadata (name, logo, description) ----
const toolkitCache = new Map();
async function toolkitMeta(slug) {
  const s = String(slug || '').toLowerCase();
  if (!s) return null;
  if (toolkitCache.has(s)) return toolkitCache.get(s);
  try {
    const t = await cfetch(`/toolkits/${encodeURIComponent(s)}`);
    const meta = {
      slug: s,
      name: t.name || s,
      logo: (t.meta && t.meta.logo) || `https://logos.composio.dev/api/${s}`,
      description: (t.meta && t.meta.description) || '',
      appUrl: (t.meta && t.meta.app_url) || t.app_url || '',
      toolsCount: (t.meta && t.meta.triggers_count) || 0,
      categories: ((t.meta && t.meta.categories) || []).map((c) => c.name || c.slug).filter(Boolean),
    };
    toolkitCache.set(s, meta);
    return meta;
  } catch {
    const fallback = {
      slug: s,
      name: s.charAt(0).toUpperCase() + s.slice(1),
      logo: `https://logos.composio.dev/api/${s}`,
      description: '',
      appUrl: '',
      toolsCount: 0,
      categories: [],
    };
    toolkitCache.set(s, fallback);
    return fallback;
  }
}

// ---- connected accounts per Belna user ----
// NOTE: the Composio list endpoint ignores the user_id filter and returns the
// whole project's accounts, so we MUST filter client-side on exact user_id.
// Without this, one Belna user would see another user's connections.
async function listConnected(belnaUserId) {
  const uid = composioUserId(belnaUserId);
  const j = await cfetch(`/connected_accounts?user_id=${encodeURIComponent(uid)}&limit=100`);
  return (j.items || [])
    .filter((it) => String(it.user_id || '') === uid)
    .map((it) => ({
      id: it.id,
      toolkit: String((it.toolkit && it.toolkit.slug) || '').toLowerCase(),
      authConfigId: (it.auth_config && it.auth_config.id) || null,
      status: it.status || 'ACTIVE',
      updatedAt: it.updated_at || it.created_at || null,
    }));
}

async function appsForUser(belnaUserId) {
  const [configs, connected] = await Promise.all([
    listAuthConfigs(),
    listConnected(belnaUserId).catch(() => []),
  ]);
  const activeByToolkit = new Map();
  for (const c of connected) {
    if (String(c.status).toUpperCase() === 'ACTIVE') {
      if (!activeByToolkit.has(c.toolkit)) activeByToolkit.set(c.toolkit, c);
    }
  }
  const apps = [];
  for (const cfg of configs) {
    const meta = await toolkitMeta(cfg.toolkit);
    const conn = activeByToolkit.get(cfg.toolkit) || null;
    apps.push({
      toolkit: cfg.toolkit,
      name: (meta && meta.name) || cfg.toolkit,
      logo: (meta && meta.logo) || cfg.toolkitLogo,
      description: (meta && meta.description) || '',
      categories: (meta && meta.categories) || [],
      authConfigId: cfg.id,
      authScheme: cfg.authScheme,
      connected: !!conn,
      connectedAccountId: conn ? conn.id : null,
      status: conn ? conn.status : 'NOT_CONNECTED',
    });
  }
  return apps;
}

async function createLink(belnaUserId, { authConfigId, toolkit, callbackUrl }) {
  let authId = String(authConfigId || '').trim();
  const configs = await listAuthConfigs();
  if (!authId && toolkit) {
    const hit = configs.find((c) => c.toolkit === String(toolkit).toLowerCase());
    if (!hit) throw Object.assign(new Error('That app is not available for connection.'), { code: 'BAD_INPUT' });
    authId = hit.id;
  }
  if (!authId) throw Object.assign(new Error('authConfigId required.'), { code: 'BAD_INPUT' });
  const allowed = configs.find((c) => c.id === authId);
  if (!allowed || (toolkit && allowed.toolkit !== String(toolkit).toLowerCase())) {
    throw Object.assign(new Error('That app connection configuration is not enabled.'), { code: 'BAD_INPUT' });
  }
  const j = await cfetch('/connected_accounts/link', {
    method: 'POST',
    body: {
      auth_config_id: authId,
      user_id: composioUserId(belnaUserId),
      callback_url: callbackUrl || undefined,
    },
  });
  return {
    redirectUrl: j.redirect_url || j.redirectUrl,
    linkToken: j.link_token,
    connectedAccountId: j.connected_account_id || j.connectedAccountId || null,
    expiresAt: j.expires_at || null,
  };
}

async function getConnectedAccount(nanoid) {
  if (!/^ca_[A-Za-z0-9_-]+$/.test(String(nanoid || ''))) {
    throw Object.assign(new Error('Invalid connection id.'), { code: 'BAD_INPUT' });
  }
  return cfetch(`/connected_accounts/${encodeURIComponent(nanoid)}`);
}

async function deleteConnected(belnaUserId, nanoid) {
  const account = await getConnectedAccount(nanoid).catch(() => null);
  if (!account || String(account.user_id || '') !== composioUserId(belnaUserId)) {
    throw Object.assign(new Error('That connection was not found on your account.'), { code: 'BAD_INPUT' });
  }
  await cfetch(`/connected_accounts/${encodeURIComponent(nanoid)}`, { method: 'DELETE' });
  return { ok: true };
}

async function parseWebhook(raw, headers = {}) {
  if (!(await verifyWebhook(raw, headers))) throw Object.assign(new Error('Bad webhook signature.'), { code: 'BAD_SIGNATURE' });
  let body;
  try { body = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '')); }
  catch { throw Object.assign(new Error('Invalid webhook JSON.'), { code: 'BAD_INPUT' }); }
  const metadata = body.metadata || {};
  const connectedId = metadata.connected_account_id || body.connected_account_id || body.connectedAccountId || body.connected_account?.id;
  if (!connectedId) throw Object.assign(new Error('Connected account id required.'), { code: 'BAD_INPUT' });
  const account = await getConnectedAccount(connectedId).catch(() => null);
  const accountUser = String(account?.user_id || '');
  if (!account || !accountUser.startsWith('belna:')) throw Object.assign(new Error('Unknown connected account.'), { code: 'BAD_INPUT' });
  const eventUser = String(metadata.user_id || body.user_id || body.userId || '');
  if (eventUser && eventUser !== accountUser) throw Object.assign(new Error('Webhook account owner mismatch.'), { code: 'BAD_SIGNATURE' });
  return {
    ownerId: accountUser.slice('belna:'.length),
    connectedAccountId: connectedId,
    toolkit: String(account.toolkit?.slug || body.toolkit_slug || body.toolkit || body.app || '').toLowerCase(),
    trigger: String(metadata.trigger_slug || body.trigger_slug || body.trigger || body.event || '').toUpperCase(),
    payload: body.data || body.payload || {},
    type: String(body.type || ''),
  };
}

// ---- tools ----
async function listTools(toolkit, { limit = 30, query = '' } = {}) {
  const params = new URLSearchParams();
  if (toolkit) params.set('toolkit_slug', String(toolkit).toLowerCase());
  if (query) params.set('query', String(query).slice(0, 120));
  params.set('limit', String(Math.min(100, Math.max(1, Number(limit) || 30))));
  const j = await cfetch(`/tools?${params.toString()}`);
  return (j.items || []).map((t) => ({
    slug: t.slug,
    name: t.name,
    description: t.description,
    version: t.version || (t.available_versions && t.available_versions[0]) || 'latest',
    toolkit: (t.toolkit && t.toolkit.slug) || toolkit || '',
    logo: (t.toolkit && t.toolkit.logo) || '',
  }));
}

async function getTool(toolSlug) {
  return cfetch(`/tools/${encodeURIComponent(String(toolSlug).toUpperCase())}`);
}

async function executeTool(belnaUserId, { tool, toolSlug, args, arguments: args2, connectedAccountId, version }) {
  const slug = String(tool || toolSlug || '').toUpperCase().trim();
  if (!/^[A-Z0-9_]+$/.test(slug)) throw Object.assign(new Error('Pick a valid tool.'), { code: 'BAD_INPUT' });
  let ConnectedAccountId = connectedAccountId || undefined;
  if (ConnectedAccountId) {
    // Never let a user borrow another account: the connection must belong to
    // their own Composio user id.
    if (!/^ca_[A-Za-z0-9_-]+$/.test(String(ConnectedAccountId))) {
      throw Object.assign(new Error('Invalid connection.'), { code: 'BAD_INPUT' });
    }
    const acct = await cfetch(`/connected_accounts/${encodeURIComponent(ConnectedAccountId)}`).catch(() => null);
    if (!acct || String(acct.user_id || '') !== composioUserId(belnaUserId)) {
      throw Object.assign(new Error('That connection was not found on your account.'), { code: 'BAD_INPUT' });
    }
    if (String(acct.status || '').toUpperCase() !== 'ACTIVE') {
      throw Object.assign(new Error('That connection is no longer active. Reconnect it under Apps.'), { code: 'BAD_INPUT' });
    }
  }
  // If no explicit account, Composio picks the first ACTIVE account for the
  // user+toolkit — which is exactly the per-user isolation we want.
  const body = {
    user_id: composioUserId(belnaUserId),
    arguments: args || args2 || {},
  };
  if (ConnectedAccountId) body.connected_account_id = ConnectedAccountId;
  if (version) body.version = version;
  const j = await cfetch(`/tools/execute/${encodeURIComponent(slug)}`, {
    method: 'POST',
    body,
  });
  return j;
}

// ---- triggers ----
const triggerCache = new Map();
async function listTriggerTypes(toolkit) {
  const s = String(toolkit || '').toLowerCase();
  const key = s || '__all__';
  if (triggerCache.has(key)) return triggerCache.get(key);
  const params = new URLSearchParams();
  if (s) params.set('toolkit_slugs', s);
  params.set('limit', '100');
  const j = await cfetch(`/triggers_types?${params.toString()}`);
  const items = (j.items || [])
    .filter((t) => !s || String((t.toolkit && t.toolkit.slug) || '').toLowerCase() === s)
    .map((t) => ({
      slug: t.slug,
      name: t.name,
      description: t.description,
      toolkit: String((t.toolkit && t.toolkit.slug) || s || '').toLowerCase(),
      logo: (t.toolkit && t.toolkit.logo) || '',
    }));
  triggerCache.set(key, items);
  setTimeout(() => triggerCache.delete(key), 10 * 60 * 1000).unref?.();
  return items;
}

async function triggerOptionsForUser(belnaUserId) {
  const schedules = [5, 15, 30, 60, 360, 1440, 10080];
  try {
    const connected = (await listConnected(belnaUserId)).filter(
      (c) => String(c.status).toUpperCase() === 'ACTIVE'
    );
    const apps = [];
    for (const c of connected) {
      const meta = await toolkitMeta(c.toolkit);
      let events = [];
      try {
        events = (await listTriggerTypes(c.toolkit)).map((t) => t.slug);
      } catch {}
      if (!events.length) events = ['new_activity'];
      apps.push({
        id: c.toolkit,
        name: (meta && meta.name) || c.toolkit,
        logo: (meta && meta.logo) || '',
        events,
        connectedAccountId: c.id,
      });
    }
    return { schedules, apps };
  } catch {
    return { schedules, apps: [] };
  }
}

async function isToolkitConnected(belnaUserId, toolkit) {
  const s = String(toolkit || '').toLowerCase();
  if (!s) return false;
  try {
    const connected = await listConnected(belnaUserId);
    return connected.some(
      (c) => c.toolkit === s && String(c.status).toUpperCase() === 'ACTIVE'
    );
  } catch {
    return false;
  }
}

export {
  configured,
  composioUserId,
  siteOrigin,
  listAuthConfigs,
  toolkitMeta,
  listConnected,
  appsForUser,
  createLink,
  deleteConnected,
  getConnectedAccount,
  verifyWebhook,
  parseWebhook,
  listTools,
  getTool,
  executeTool,
  listTriggerTypes,
  triggerOptionsForUser,
  isToolkitConnected,
};
