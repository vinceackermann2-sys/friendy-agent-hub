/* Account presence metadata.
   Ordinary chat is account-backed and does not need a cloud container. The
   production default is deliberately account-only; an external dynamic
   session may be enabled only with an explicit billing opt-in. Full-OS work
   uses the per-user Azure VM and its worker container in vm-harness.js.
*/
import crypto from 'node:crypto';

let tokenCache = { key: '', accessToken: '', exp: 0 };

function env(name, fallback = '') {
  return String(process.env[name] || process.env['LINGON_' + name] || fallback).trim();
}

function config() {
  const endpoint = env('AZURE_CONTAINER_SESSION_ENDPOINT').replace(/\/+$/, '');
  const touchPath = env('AZURE_CONTAINER_SESSION_TOUCH_PATH', '/health');
  const requestedMode = env('AZURE_CONTAINER_SESSION_PRESENCE', 'off').toLowerCase();
  const presenceMode = requestedMode === 'external' && env('AZURE_CONTAINER_SESSION_ALLOW_BILLING', 'false').toLowerCase() === 'true' ? 'external' : 'off';
  return {
    endpoint,
    touchPath: /^\/[A-Za-z0-9/_-]{1,100}$/.test(touchPath) ? touchPath : '/health',
    presenceMode,
    tenantId: env('AZURE_TENANT_ID'),
    clientId: env('AZURE_CLIENT_ID'),
    clientSecret: env('AZURE_CLIENT_SECRET'),
    identifierSecret: env('WORKSPACE_SESSION_SECRET') || env('ENCRYPTION_KEY') || env('AZURE_CLIENT_SECRET'),
    cooldownSeconds: Math.max(60, Math.min(3600, Number(env('CONTAINER_SESSION_COOLDOWN_SECONDS', '600')) || 600)),
  };
}

function endpointAllowed(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /\.azurecontainerapps\.io$/i.test(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

function missingFields(cfg = config()) {
  const missing = [];
  if (!endpointAllowed(cfg.endpoint)) missing.push('endpoint');
  for (const key of ['tenantId', 'clientId', 'clientSecret', 'identifierSecret']) if (!cfg[key]) missing.push(key);
  return missing;
}

function isConfigured() {
  return missingFields().length === 0;
}

function sessionIdForUser(userId, cfg = config()) {
  if (!String(userId || '').trim()) throw Object.assign(new Error('userId required'), { code: 'BAD_INPUT' });
  if (!cfg.identifierSecret) throw Object.assign(new Error('Workspace session identity is not configured.'), { code: 'WORKSPACE_NOT_CONFIGURED' });
  return 'ws-' + crypto.createHmac('sha256', cfg.identifierSecret).update(String(userId)).digest('hex').slice(0, 40);
}

async function accessToken(cfg = config()) {
  const key = `${cfg.tenantId}:${cfg.clientId}`;
  if (tokenCache.key === key && tokenCache.accessToken && Date.now() < tokenCache.exp - 60000) return tokenCache.accessToken;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'https://dynamicsessions.io/.default',
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw Object.assign(new Error('Workspace container authentication failed.'), { code: 'WORKSPACE_AUTH', status: response.status });
  }
  tokenCache = { key, accessToken: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return tokenCache.accessToken;
}

function descriptor(cfg = config()) {
  const configured = missingFields(cfg).length === 0;
  const container = configured && cfg.presenceMode === 'external';
  const vmAvailable = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_SUBSCRIPTION_ID', 'AZURE_RESOURCE_GROUP'].every((name) => env(name));
  const durableVmState = vmAvailable && env('AZURE_DURABLE_STATE', 'true').toLowerCase() !== 'false';
  return {
    mode: 'account-only',
    status: container ? 'external-optional' : 'ready',
    warmed: false,
    configured,
    container,
    containerPurpose: container ? 'optional-warm-presence' : 'none',
    containerLifecycle: container ? 'visible-tab-plus-cooldown' : 'none',
    containerTools: [],
    fullOs: vmAvailable ? 'on-demand-vm' : 'unavailable',
    vmPolicy: 'on-demand-full-os',
    worker: vmAvailable ? {
      kind: 'vm-worker-container',
      status: 'on-demand-with-vm',
      tools: ['shell', 'code_run'],
      requiresVm: true,
      filesystem: 'ephemeral-container-mounted-to-durable-workspace',
    } : { kind: 'vm-worker-container', status: 'unavailable', tools: [], requiresVm: true },
    cooldownSeconds: cfg.cooldownSeconds,
    persistence: {
      memory: 'account-storage',
      agentDocuments: 'account-storage',
      chats: 'account-storage',
      files: durableVmState ? 'private-workspace-backup' : (vmAvailable ? 'vm-os-disk-only' : 'unavailable'),
      browserProfile: durableVmState ? 'private-workspace-backup' : (vmAvailable ? 'vm-os-disk-only' : 'unavailable'),
      containerFilesystem: 'ephemeral-session',
    },
  };
}

async function touch(userId) {
  const cfg = config();
  const base = descriptor(cfg);
  if (!base.container) return base;
  const token = await accessToken(cfg);
  const url = new URL(cfg.endpoint + cfg.touchPath);
  url.searchParams.set('identifier', sessionIdForUser(userId, cfg));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  timeout.unref?.();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw Object.assign(new Error(`Workspace container returned HTTP ${response.status}${detail ? ': ' + detail.slice(0, 160) : ''}.`), { code: 'WORKSPACE_CONTAINER', status: response.status });
    }
    return { ...base, status: 'ready', warmed: true };
  } finally { clearTimeout(timeout); }
}

function release() {
  const state = descriptor();
  return { ...state, status: state.container ? 'cooling' : 'ready', warmed: false };
}

export { config, missingFields, isConfigured, endpointAllowed, sessionIdForUser, descriptor, touch, release };
