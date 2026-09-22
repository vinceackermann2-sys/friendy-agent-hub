/* Belna <-> Composio bridge (server-side only).
   The Composio project API key never leaves the server. The browser only ever
   sees Belna URLs + Composio's hosted Connect Link (redirect_url).
   user_id mapping: Belna Supabase user id -> Composio user id (`belna:<supabase-id>`),
   so every Belna account gets isolated connected accounts.
*/
const BASE = 'https://backend.composio.dev/api/v3.1';
const crypto = require('crypto');
const store = require('./store');

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
  if (webhookSecretCache.value && Date.now() - webhookSecretCache.at < 5 * 60 * 1000) {
    return webhookSecretCache.value;
  }
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

// ---- hidden connectors (removed from the in-app Connectors list) ----
// These toolkits stay enabled in Composio but are never offered in the app.
const HIDDEN_TOOLKITS = new Set([
  'airtable',
  'amplitude',
  'anthropic_administrator',
  'asana',
  'canva',
  'cloudflare',
  'discord',
  'elevenlabs',
  'figma',
  'firecrawl',
  'heygen',
  'jira',
  'klaviyo',
  'mailchimp',
  'miro',
  'openai',
  'posthog',
  'reddit',
  'replicate',
  'resend',
  'sanity',
  'semrush',
  'sentry',
  'sevdesk',
  'slackbot',
  'supabase',
  'wix',
]);
function isHiddenToolkit(slug) {
  const s = String(slug || '').toLowerCase();
  if (!s) return false;
  if (HIDDEN_TOOLKITS.has(s)) return true;
  try {
    const extra = String(process.env.COMPOSIO_HIDDEN_TOOLKITS || '')
      .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (extra.includes(s)) return true;
  } catch {}
  return false;
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
  const items = [...byToolkit.values()].filter((c) => !isHiddenToolkit(c.toolkit)).sort((a, b) => a.toolkit.localeCompare(b.toolkit));
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

function walkIdentity(obj, pred, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return '';
  if (Array.isArray(obj)) {
    for (const it of obj) {
      const hit = walkIdentity(it, pred, depth + 1);
      if (hit) return hit;
    }
    return '';
  }
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && pred(k, v)) return v.trim();
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const hit = walkIdentity(v, pred, depth + 1);
      if (hit) return hit;
    }
  }
  return '';
}
function accountIdentity(it) {
  const bags = [it && it.data, it && it.params, it && it.state && it.state.val, it].filter(Boolean);
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emailKey = /^(email|email_address|emailaddress|user_email|useremail|mail|login)$/i;
  const nameKey = /^(name|display_name|displayname|full_name|fullname|username|user_name|login)$/i;
  const picKey = /^(picture|avatar|avatar_url|photo|photo_url|image|image_url|profile_picture|profilepicture|picture_url)$/i;
  let email = '', name = '', picture = '';
  for (const bag of bags) {
    if (!email) email = walkIdentity(bag, (k, v) => emailKey.test(k) && emailRe.test(v));
    if (!email) email = walkIdentity(bag, (_k, v) => emailRe.test(v) && v.length < 120);
    if (!name) name = walkIdentity(bag, (k, v) => nameKey.test(k) && v.length < 80 && !emailRe.test(v));
    if (!picture) picture = walkIdentity(bag, (k, v) => picKey.test(k) && /^https?:\/\//i.test(v));
  }
  return {
    email: email || '',
    name: name || String((it && it.alias) || ''),
    picture: picture || '',
    alias: (it && it.alias) || '',
    wordId: (it && (it.word_id || it.wordId)) || '',
  };
}
function mapConnected(it) {
  const idn = accountIdentity(it);
  return {
    id: it.id,
    toolkit: String((it.toolkit && it.toolkit.slug) || '').toLowerCase(),
    authConfigId: (it.auth_config && it.auth_config.id) || null,
    status: it.status || 'ACTIVE',
    updatedAt: it.updated_at || it.created_at || null,
    email: idn.email,
    name: idn.name,
    picture: idn.picture,
    alias: idn.alias,
    wordId: idn.wordId,
  };
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
    .map(mapConnected);
}

async function appsForUser(belnaUserId) {
  const [configs, connected] = await Promise.all([
    listAuthConfigs(),
    listConnected(belnaUserId).catch(() => []),
  ]);
  const accountsByToolkit = new Map();
  for (const c of connected) {
    if (String(c.status).toUpperCase() !== 'ACTIVE') continue;
    if (!accountsByToolkit.has(c.toolkit)) accountsByToolkit.set(c.toolkit, []);
    accountsByToolkit.get(c.toolkit).push(c);
  }
  const apps = [];
  for (const cfg of configs) {
    const meta = await toolkitMeta(cfg.toolkit);
    const accounts = accountsByToolkit.get(cfg.toolkit) || [];
    const conn = accounts[0] || null;
    apps.push({
      toolkit: cfg.toolkit,
      name: (meta && meta.name) || cfg.toolkit,
      logo: (meta && meta.logo) || cfg.toolkitLogo,
      description: (meta && meta.description) || '',
      categories: (meta && meta.categories) || [],
      authConfigId: cfg.id,
      authScheme: cfg.authScheme,
      connected: accounts.length > 0,
      connectedAccountId: conn ? conn.id : null,
      accounts,
      accountCount: accounts.length,
      status: conn ? conn.status : 'NOT_CONNECTED',
    });
  }
  return apps;
}

async function createLink(belnaUserId, { authConfigId, toolkit, callbackUrl }) {
  if (toolkit && isHiddenToolkit(toolkit)) {
    throw Object.assign(new Error('That app is not available for connection.'), { code: 'BAD_INPUT' });
  }
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
  const existing = (await listConnected(belnaUserId).catch(() => []))
    .filter((c) => c.toolkit === allowed.toolkit && String(c.status).toUpperCase() === 'ACTIVE');
  const body = {
    auth_config_id: authId,
    user_id: composioUserId(belnaUserId),
    callback_url: callbackUrl || undefined,
  };
  if (existing.length) {
    body.alias = `${allowed.toolkit}-${Date.now().toString(36)}`;
    body.allow_multiple = true;
  }
  const j = await cfetch('/connected_accounts/link', {
    method: 'POST',
    body,
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
  if (!(await verifyWebhook(raw, headers))) {
    throw Object.assign(new Error('Bad webhook signature.'), { code: 'BAD_SIGNATURE' });
  }
  let body;
  try { body = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '')); }
  catch { throw Object.assign(new Error('Invalid webhook JSON.'), { code: 'BAD_INPUT' }); }
  const metadata = body.metadata || {};
  const connectedId = metadata.connected_account_id || body.connected_account_id || body.connectedAccountId || body.connected_account?.id;
  if (!connectedId) throw Object.assign(new Error('Connected account id required.'), { code: 'BAD_INPUT' });
  const account = await getConnectedAccount(connectedId).catch(() => null);
  const accountUser = String(account?.user_id || '');
  if (!account || !accountUser.startsWith('belna:')) {
    throw Object.assign(new Error('Unknown connected account.'), { code: 'BAD_INPUT' });
  }
  const eventUser = String(metadata.user_id || body.user_id || body.userId || '');
  if (eventUser && eventUser !== accountUser) {
    throw Object.assign(new Error('Webhook account owner mismatch.'), { code: 'BAD_SIGNATURE' });
  }
  const toolkit = String(account.toolkit?.slug || body.toolkit_slug || body.toolkit || body.app || '').toLowerCase();
  const trigger = String(metadata.trigger_slug || body.trigger_slug || body.trigger || body.event || '').toUpperCase();
  return {
    ownerId: accountUser.slice('belna:'.length),
    connectedAccountId: connectedId,
    toolkit,
    trigger,
    payload: body.data || body.payload || {},
    type: String(body.type || ''),
  };
}

// ---- tools ----
function toolKind(tool) {
  const tags = ((tool && tool.tags) || []).map((t) => String(t).toLowerCase());
  if (tags.some((t) => /write|create|update|delete|mutate|send/.test(t))) return 'write';
  if (tags.some((t) => /read|list|get|fetch|search/.test(t))) return 'read';
  const scopes = ((tool && tool.scopes) || []).join(' ').toLowerCase();
  if (/\.readonly\b|read_only|readonly/.test(scopes) && !/write|modify|send/.test(scopes)) return 'read';
  const s = `${(tool && tool.slug) || ''} ${(tool && tool.name) || ''} ${(tool && tool.description) || ''}`.toLowerCase();
  if (/\b(send|create|update|delete|post|write|insert|remove|trash|archive|modify|reply|forward|upload|publish|invite|edit|patch|move|rename|share|merge|approve|cancel|schedule|book|pay|charge|transfer)\b/.test(s)) return 'write';
  return 'read';
}
function mapTool(t, toolkit) {
  return {
    slug: t.slug,
    name: t.name,
    description: t.description || t.human_description || '',
    version: t.version || (t.available_versions && t.available_versions[0]) || 'latest',
    toolkit: (t.toolkit && t.toolkit.slug) || toolkit || '',
    logo: (t.toolkit && t.toolkit.logo) || '',
    kind: toolKind(t),
    scopes: t.scopes || [],
  };
}
async function listTools(toolkit, { limit = 30, query = '' } = {}) {
  const params = new URLSearchParams();
  if (toolkit) params.set('toolkit_slug', String(toolkit).toLowerCase());
  if (query) params.set('query', String(query).slice(0, 120));
  params.set('limit', String(Math.min(100, Math.max(1, Number(limit) || 30))));
  const j = await cfetch(`/tools?${params.toString()}`);
  return (j.items || []).map((t) => mapTool(t, toolkit));
}
async function listToolkitTools(toolkit, cap = 200) {
  const slug = String(toolkit || '').toLowerCase();
  const all = [];
  let cursor = null;
  for (let i = 0; i < 5 && all.length < cap; i++) {
    const params = new URLSearchParams();
    if (slug) params.set('toolkit_slug', slug);
    params.set('limit', String(Math.min(100, cap - all.length)));
    if (cursor) params.set('cursor', cursor);
    const j = await cfetch(`/tools?${params.toString()}`);
    for (const t of j.items || []) all.push(mapTool(t, slug));
    cursor = j.next_cursor || j.nextCursor || null;
    if (!cursor) break;
  }
  return all;
}

async function getTool(toolSlug) {
  return cfetch(`/tools/${encodeURIComponent(String(toolSlug).toUpperCase())}`);
}

async function executeTool(belnaUserId, { tool, toolSlug, args, arguments: args2, connectedAccountId, version }) {
  const slug = String(tool || toolSlug || '').toUpperCase().trim();
  if (!/^[A-Z0-9_]+$/.test(slug)) throw Object.assign(new Error('Pick a valid tool.'), { code: 'BAD_INPUT' });
  let ConnectedAccountId = connectedAccountId || undefined;
  let connectedToolkit = '';
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
    connectedToolkit = String((acct.toolkit && acct.toolkit.slug) || '').toLowerCase();
  }
  const toolMeta = await getTool(slug);
  const toolkitSlug = String((toolMeta && toolMeta.toolkit && toolMeta.toolkit.slug) || '').toLowerCase();
  if (!toolkitSlug) throw Object.assign(new Error('Could not determine the connector for this tool.'), { code: 'BAD_INPUT' });
  if (ConnectedAccountId && connectedToolkit !== toolkitSlug) {
    throw Object.assign(new Error('That connection cannot run this tool.'), { code: 'BAD_INPUT' });
  }
  const disabled = await store.getConnectorPermissions(belnaUserId, toolkitSlug);
  if (disabled.includes(slug)) {
    throw Object.assign(new Error('That permission is turned off for this connector.'), { code: 'PERMISSION_OFF' });
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

async function toolkitForUser(belnaUserId, toolkit) {
  const slug = String(toolkit || '').toLowerCase();
  if (!slug) throw Object.assign(new Error('toolkit required.'), { code: 'BAD_INPUT' });
  if (isHiddenToolkit(slug)) throw Object.assign(new Error('That connector is not available.'), { code: 'BAD_INPUT' });
  const [apps, tools, disabled] = await Promise.all([
    appsForUser(belnaUserId),
    listToolkitTools(slug, 200).catch(() => []),
    store.getConnectorPermissions(belnaUserId, slug),
  ]);
  const app = apps.find((a) => a.toolkit === slug);
  if (!app) throw Object.assign(new Error('That connector is not available.'), { code: 'BAD_INPUT' });
  const accounts = [];
  for (const acc of app.accounts || []) {
    let next = acc;
    if (!acc.email || !acc.picture) {
      try {
        const raw = await getConnectedAccount(acc.id);
        if (raw && String(raw.user_id || '') === composioUserId(belnaUserId)) next = { ...acc, ...mapConnected(raw), toolkit: slug };
      } catch {}
    }
    accounts.push(next);
  }
  const off = new Set(disabled);
  return {
    ...app,
    accounts,
    accountCount: accounts.length,
    permissions: tools.map((t) => ({ ...t, enabled: !off.has(String(t.slug || '').toUpperCase()) })),
  };
}

async function setToolkitPermissions(belnaUserId, toolkit, disabled) {
  const slug = String(toolkit || '').toLowerCase();
  if (!slug) throw Object.assign(new Error('toolkit required.'), { code: 'BAD_INPUT' });
  if (isHiddenToolkit(slug)) throw Object.assign(new Error('That connector is not available.'), { code: 'BAD_INPUT' });
  const configs = await listAuthConfigs();
  if (!configs.some((c) => c.toolkit === slug)) {
    throw Object.assign(new Error('That connector is not available.'), { code: 'BAD_INPUT' });
  }
  return store.setConnectorPermissions(belnaUserId, slug, disabled);
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

module.exports = {
  configured,
  composioUserId,
  siteOrigin,
  isHiddenToolkit,
  HIDDEN_TOOLKITS,
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
  toolkitForUser,
  setToolkitPermissions,
};
