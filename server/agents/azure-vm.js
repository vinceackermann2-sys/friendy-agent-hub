/* Lingon per-user sandbox — Azure VM (Microsoft) with secure local fallback.
   Each user gets ONE VM: lingon-sb-<sha256(userId)[0:24]>.
   Untrusted code is dispatched via Azure Run Command into a hardened worker
   container on that VM. This process never executes user code (node:vm is not
   a security boundary).
   No public SSH, no public IP, no secrets copied into the VM.
   Missing AZURE_* → isolated local workspace; code_run stays DISABLED.
*/
const crypto = require('crypto');

const SANDBOX_ROOT = '/tmp/lingon-sandboxes';
const ARM = 'https://management.azure.com';
const COMPUTE_API = '2024-07-01';
const NET_API = '2023-09-01';
const STORAGE_API = '2023-05-01';
const BLOB_API = '2023-11-03';
const SCREEN_CONTAINER = 'browser-shots';
const STATE_CONTAINER = 'agent-state';
const LANGS = { js: 'node', javascript: 'node', node: 'node', py: 'python3', python: 'python3', sh: 'bash', bash: 'bash' };
const LEASE_TTL_MS = 90000;
const DEFAULT_WORKER_IMAGE = 'localhost/lingon-worker:20260921';
const leases = new Map(); // userId -> Map(leaseId, { kind, expiresAt })
const stopping = new Map(); // userId -> Promise, prevents duplicate deallocate calls
const restoredState = new Map(); // userId -> Azure VM incarnation; replacement must restore again
const workerReadyState = new Map(); // userId -> VM incarnation whose worker image is ready
let sweepTokenCache = { value: '', at: 0 };
let durableStorageCache = { accountId: '', accountKey: '', storage: null, exp: 0 };

function env(name, fallback = '') {
  return String(process.env[name] || process.env['LINGON_' + name] || fallback).trim();
}

function azureConfig() {
  return {
    tenantId: env('AZURE_TENANT_ID'),
    clientId: env('AZURE_CLIENT_ID'),
    clientSecret: env('AZURE_CLIENT_SECRET'),
    subscriptionId: env('AZURE_SUBSCRIPTION_ID'),
    resourceGroup: env('AZURE_RESOURCE_GROUP'),
    location: env('AZURE_LOCATION', 'swedencentral'),
    vmSize: env('AZURE_VM_SIZE', 'Standard_B2als_v2'),
    workerImage: env('AZURE_WORKER_IMAGE', DEFAULT_WORKER_IMAGE),
    adminUsername: env('AZURE_ADMIN_USERNAME', 'lingon'),
    vnet: env('AZURE_VNET', 'lingon-sandbox-vnet'),
    subnet: env('AZURE_SUBNET', 'sandbox'),
    nsg: env('AZURE_NSG', 'lingon-sandbox-nsg'),
    storageAccount: env('AZURE_STORAGE_ACCOUNT'),
    image: env('AZURE_VM_IMAGE', 'Canonical:0001-com-ubuntu-server-jammy:22_04-lts:latest'),
    idleMinutes: Number(env('AZURE_VM_IDLE_MINUTES', '5')) || 5,
    perUserVM: env('AZURE_PER_USER_VM', 'true').toLowerCase() !== 'false',
    autoProvision: env('AZURE_AUTO_PROVISION', 'true').toLowerCase() === 'true',
    durableState: env('AZURE_DURABLE_STATE', 'true').toLowerCase() !== 'false',
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function workerImage(cfg = azureConfig()) {
  const image = String(cfg.workerImage || DEFAULT_WORKER_IMAGE).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._/@:-]{0,200}$/.test(image)) {
    throw Object.assign(new Error('AZURE_WORKER_IMAGE contains unsupported characters.'), { code: 'BAD_INPUT' });
  }
  return image;
}

function missingAzureFields(cfg) {
  const required = ['tenantId', 'clientId', 'clientSecret', 'subscriptionId', 'resourceGroup'];
  return required.filter((k) => !cfg[k]);
}

function isAzureConfigured() {
  return missingAzureFields(azureConfig()).length === 0;
}

function supabaseLeaseConfig() {
  return {
    url: env('SUPABASE_URL').replace(/\/$/, ''),
    key: env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY'),
  };
}

function isLeaseStoreConfigured() {
  const cfg = supabaseLeaseConfig();
  return !!(cfg.url && cfg.key);
}

async function supabaseRpc(name, body) {
  const cfg = supabaseLeaseConfig();
  if (!cfg.url || !cfg.key) {
    throw Object.assign(new Error('Durable VM leases require the Supabase server key.'), { code: 'SUPABASE_NOT_CONFIGURED' });
  }
  const response = await fetch(`${cfg.url}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  if (!response.ok) {
    const error = new Error(`Supabase VM lease operation ${name} failed (HTTP ${response.status}).`);
    error.code = response.status === 404 ? 'VM_LEASE_SCHEMA_MISSING' : 'VM_LEASE_STORE';
    throw error;
  }
  return response.status === 204 ? null : response.json().catch(() => null);
}

async function supabaseLeaseRows(userId) {
  if (!isLeaseStoreConfigured()) return null;
  const cfg = supabaseLeaseConfig();
  const query = new URLSearchParams({
    select: 'kind,expires_at',
    user_id: `eq.${String(userId)}`,
    expires_at: `gt.${new Date().toISOString()}`,
    order: 'expires_at.asc',
  });
  const response = await fetch(`${cfg.url}/rest/v1/agent_vm_leases?${query}`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
  });
  if (!response.ok) throw Object.assign(new Error('Could not read durable VM leases.'), { code: 'VM_LEASE_STORE' });
  return response.json();
}

async function serverSecret(name) {
  const value = env(name);
  if (value) return value;
  if (name === 'VM_SWEEP_TOKEN' && sweepTokenCache.value && Date.now() - sweepTokenCache.at < 5 * 60 * 1000) {
    return sweepTokenCache.value;
  }
  if (!isLeaseStoreConfigured()) return '';
  const result = await supabaseRpc('get_server_secret', { p_name: String(name).toLowerCase() });
  const secret = String(result || '').trim();
  if (name === 'VM_SWEEP_TOKEN' && secret) sweepTokenCache = { value: secret, at: Date.now() };
  return secret;
}

async function verifySweepToken(value) {
  const expected = await serverSecret('VM_SWEEP_TOKEN');
  const supplied = String(value || '').replace(/^Bearer\s+/i, '').trim();
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function userHash(userId) {
  return crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 24);
}

function vmNameForUser(userId) {
  return `lingon-sb-${userHash(userId)}`;
}

function localWorkspaceForUser(userId) {
  return `${SANDBOX_ROOT}/${userHash(userId)}`;
}

function assertLocalPath(userId, rel) {
  const root = localWorkspaceForUser(userId);
  const cleaned = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (/^[A-Za-z]:/.test(cleaned) || cleaned.split('/').includes('..')) {
    throw Object.assign(new Error('Path escapes user sandbox.'), { code: 'BAD_INPUT' });
  }
  return cleaned ? `${root}/${cleaned}` : root;
}

function taskWorkspace(taskId) {
  return '/home/lingon/workspace' + (taskId ? '/tasks/' + crypto.createHash('sha256').update(String(taskId)).digest('hex').slice(0,24) : '');
}

function buildRunScript(language, code, taskId) {
  const bin = LANGS[String(language || '').toLowerCase()];
  if (!bin) throw Object.assign(new Error('Unsupported language. Use js, python, or bash.'), { code: 'BAD_INPUT' });
  const src = String(code || '');
  if (!src.trim()) throw Object.assign(new Error('Code is required.'), { code: 'BAD_INPUT' });
  if (src.length > 20000) throw Object.assign(new Error('Code exceeds 20KB sandbox limit.'), { code: 'BAD_INPUT' });
  const b64 = Buffer.from(src, 'utf8').toString('base64');
  if (/[^A-Za-z0-9+/=]/.test(b64)) throw Object.assign(new Error('Sandbox encode failed.'), { code: 'BAD_INPUT' });
  const ext = bin === 'node' ? 'js' : bin === 'python3' ? 'py' : 'sh';
  const image = shellQuote(workerImage());
  return [
    'set +e',
    `WORKDIR=${taskWorkspace(taskId)}`,
    'mkdir -p "$WORKDIR"',
    'chown -R lingon:lingon "$WORKDIR"',
    'cd "$WORKDIR"',
    'command -v podman >/dev/null 2>&1 || { echo "Worker container runtime is not ready." >&2; exit 125; }',
    `podman image exists ${image} || { echo "Worker container image is not ready." >&2; exit 125; }`,
    `JOB=$(mktemp "/tmp/lingon-job.XXXXXX.${ext}")`,
    'trap \'rm -f "$JOB"\' EXIT',
    `echo '${b64}' | base64 -d > "$JOB"`,
    'chown lingon:lingon "$JOB" && chmod 600 "$JOB"',
    `timeout 20s podman run --rm --name "lingon-job-$$" --user "$(id -u lingon):$(id -g lingon)" --network=none --cap-drop=ALL --security-opt=no-new-privileges --read-only --pids-limit=128 --memory=512m --cpus=1 --tmpfs /tmp:rw,nosuid,nodev,size=64m --volume "$WORKDIR:/workspace:rw" --volume "$JOB:/run/lingon/job.${ext}:ro" --workdir /workspace --env HOME=/home/lingon ${image} ${bin} "/run/lingon/job.${ext}"; EC=$?`,
    'exit $EC',
  ].join('\n');
}

function buildShellScript(command, taskId) {
  const cmd = String(command || '');
  if (!cmd.trim()) throw Object.assign(new Error('Command is required.'), { code: 'BAD_INPUT' });
  if (cmd.length > 8000) throw Object.assign(new Error('Command exceeds 8KB sandbox limit.'), { code: 'BAD_INPUT' });
  const b64 = Buffer.from(cmd, 'utf8').toString('base64');
  if (/[^A-Za-z0-9+/=]/.test(b64)) throw Object.assign(new Error('Sandbox encode failed.'), { code: 'BAD_INPUT' });
  const image = shellQuote(workerImage());
  return [
    'set +e',
    `WORKDIR=${taskWorkspace(taskId)}`,
    'mkdir -p "$WORKDIR"',
    'chown -R lingon:lingon "$WORKDIR"',
    'cd "$WORKDIR"',
    'command -v podman >/dev/null 2>&1 || { echo "Worker container runtime is not ready." >&2; exit 125; }',
    `podman image exists ${image} || { echo "Worker container image is not ready." >&2; exit 125; }`,
    'JOB=$(mktemp "/tmp/lingon-cmd.XXXXXX.sh")',
    'trap \'rm -f "$JOB"\' EXIT',
    `echo '${b64}' | base64 -d > "$JOB"`,
    'chown lingon:lingon "$JOB" && chmod 600 "$JOB"',
    `timeout 30s podman run --rm --name "lingon-job-$$" --user "$(id -u lingon):$(id -g lingon)" --network=none --cap-drop=ALL --security-opt=no-new-privileges --read-only --pids-limit=128 --memory=512m --cpus=1 --tmpfs /tmp:rw,nosuid,nodev,size=64m --volume "$WORKDIR:/workspace:rw" --volume "$JOB:/run/lingon/job.sh:ro" --workdir /workspace --env HOME=/home/lingon ${image} bash /run/lingon/job.sh`,
    'EC=$?',
    'exit $EC',
  ].join('\n');
}

function browserSessionId(value) {
  const id = String(value || '');
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) {
    throw Object.assign(new Error('Invalid browser session id.'), { code: 'BAD_INPUT' });
  }
  return id;
}

function toolBrowserSessionId(userId, sessionId) {
  return `tool_${userHash(`${userId}:${sessionId || 'default'}`)}`;
}

function buildBrowserSessionScript(action, args = {}) {
  const sessionId = browserSessionId(args.sessionId);
  const kind = String(action || 'inspect');
  if (!['navigate', 'inspect', 'input'].includes(kind)) {
    throw Object.assign(new Error('Unsupported browser session action.'), { code: 'BAD_INPUT' });
  }
  const payload = {
    action: kind,
    sessionId,
    url: String(args.url || ''),
    uploadUrl: String(args.uploadUrl || ''),
    event: args.event && typeof args.event === 'object' ? args.event : null,
    allowedHosts: ['hn.algolia.com','api.duckduckgo.com','en.wikipedia.org','api.github.com','generativelanguage.googleapis.com'],
  };
  if (payload.url && !/^https:\/\//i.test(payload.url)) {
    throw Object.assign(new Error('HTTPS URL required.'), { code: 'BAD_INPUT' });
  }
  if (!/^https:\/\/[a-z0-9]{3,24}\.blob\.core\.windows\.net\//.test(payload.uploadUrl)) {
    throw Object.assign(new Error('Valid Azure Blob upload URL required.'), { code: 'BAD_INPUT' });
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const runner = [
    "const fs = require('fs');",
    "const path = require('path');",
    "const payload = JSON.parse(Buffer.from(process.env.LINGON_BROWSER_PAYLOAD, 'base64').toString('utf8'));",
    "const root = '/var/lib/lingon-browser/sessions';",
    "const profile = path.join(root, payload.sessionId);",
    "const stateFile = path.join(profile, 'state.json');",
    "fs.mkdirSync(profile, { recursive: true });",
    "const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { url: 'about:blank' };",
    "const findBrowser = () => ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));",
    "const executablePath = findBrowser();",
    "if (!executablePath) throw new Error('Chromium is not installed yet (first boot is still running).');",
    "let puppeteer;",
    "try { puppeteer = require('/opt/lingon/node_modules/puppeteer-core'); } catch { throw new Error('VM browser runtime is not installed yet (first boot is still running).'); }",
    "const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
    "const pageText = () => ({ title: '', text: '', links: [] });",
    "(async () => {",
    "  const port = 9300 + [...payload.sessionId].reduce((n, ch) => (n + ch.charCodeAt(0)) % 500, 0);",
    "  let browser; let reused = false;",
    "  try { const probe = await fetch('http://127.0.0.1:' + port + '/json/version'); if (!probe.ok) throw new Error('not ready'); browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + port }); reused = true; }",
    "  catch { browser = await puppeteer.launch({ headless: true, executablePath, userDataDir: profile, args: ['--disable-dev-shm-usage', '--window-size=1280,900', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port] }); browser.process()?.unref?.(); }",
    "  try {",
    "    const pages = await browser.pages();",
    "    const page = pages[0] || await browser.newPage();",
    "    await page.setViewport({ width: 1280, height: 900 });",
    "    await page.setRequestInterception(true);",
    "    page.on('request', (request) => { try { const u = new URL(request.url()); if (['about:','data:','blob:'].includes(u.protocol) || (u.protocol === 'https:' && payload.allowedHosts.includes(u.hostname))) request.continue(); else request.abort('blockedbyclient'); } catch { request.abort('blockedbyclient'); } });",
    "    if (payload.action === 'navigate') { await page.goto(payload.url, { waitUntil: 'domcontentloaded', timeout: 20000 }); await sleep(700); }",
    "    else if (payload.action === 'input') {",
    "      if (!reused && state.url && state.url !== 'about:blank') { await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: 20000 }); if (Number.isFinite(state.scrollY)) await page.evaluate((y) => window.scrollTo(0, y), state.scrollY); }",
    "      const ev = payload.event || {};",
    "      if (ev.type === 'click') await page.mouse.click(Number(ev.x) || 0, Number(ev.y) || 0, { button: ev.button === 2 ? 'right' : 'left' });",
    "      else if (ev.type === 'click_text') { const pos = await page.evaluate((text) => { const el = [...document.querySelectorAll('a,button,[role=button]')].find((node) => (node.innerText || '').trim() === text); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, String(ev.text || '')); if (!pos) throw new Error('Visible link or button text not found.'); await page.mouse.click(pos.x, pos.y); }",
    "      else if (ev.type === 'move') await page.mouse.move(Number(ev.x) || 0, Number(ev.y) || 0);",
    "      else if (ev.type === 'scroll') await page.mouse.wheel({ deltaY: Number(ev.dy) || 0 });",
    "      else if (ev.type === 'key') await page.keyboard.press(String(ev.key || 'Escape'));",
    "      else if (ev.type === 'type') await page.keyboard.type(String(ev.text || '').slice(0, 200));",
    "      await sleep(250);",
    "    } else if (!reused && state.url && state.url !== 'about:blank') { await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: 20000 }); await sleep(250); }",
    "    const url = page.url();",
    "    const title = await page.title().catch(() => '');",
    "    const text = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 1800) : '').catch(() => '');",
    "    const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].slice(0, 5).map((a) => ({ t: (a.innerText || '').slice(0, 60), h: a.href.slice(0, 160) }))).catch(() => []);",
    "    const screenshot = await page.screenshot({ type: 'jpeg', quality: 55 });",
    "    const upload = await fetch(payload.uploadUrl, { method: 'PUT', headers: { 'content-type': 'image/jpeg', 'x-ms-blob-type': 'BlockBlob' }, body: screenshot });",
    "    if (!upload.ok) throw new Error('Screenshot upload failed: HTTP ' + upload.status + ' ' + (await upload.text()).slice(0, 300));",
    "    const scrollY = await page.evaluate(() => window.scrollY).catch(() => 0);",
    "    fs.writeFileSync(stateFile, JSON.stringify({ url, title, scrollY }));",
    "    process.stdout.write(JSON.stringify({ ok: true, url, title, text, links, screenshotBytes: screenshot.length }));",
    "  } finally { browser.disconnect(); }",
    "})().catch((error) => { process.stdout.write(JSON.stringify({ ok: false, error: String(error.message || error) })); process.exitCode = 1; });",
  ].join('\n');
  const codeB64 = Buffer.from(runner, 'utf8').toString('base64');
  return [
    'set +e',
    'id -u lingon-browser >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/lingon-browser --shell /usr/sbin/nologin lingon-browser',
    'install -d -m 700 -o lingon-browser -g lingon-browser /var/lib/lingon-browser /var/lib/lingon-browser/sessions',
    `echo '${codeB64}' | base64 -d > /tmp/lingon-browser-session.js`,
    'chown lingon-browser:lingon-browser /tmp/lingon-browser-session.js && chmod 600 /tmp/lingon-browser-session.js',
    `runuser -u lingon-browser -- env LINGON_BROWSER_PAYLOAD='${payloadB64}' node /tmp/lingon-browser-session.js`,
    'EC=$?',
    'rm -f /tmp/lingon-browser-session.js',
    'exit $EC',
  ].join('\n');
}

let tokenCache = { accessToken: '', exp: 0 };

async function azureToken(cfg) {
  if (tokenCache.accessToken && Date.now() < tokenCache.exp - 60000) return tokenCache.accessToken;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'https://management.azure.com/.default',
  });
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    throw Object.assign(new Error('Azure login failed.'), { code: 'AZURE_AUTH', status: r.status });
  }
  tokenCache = { accessToken: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return tokenCache.accessToken;
}

async function pollAsync(cfg, url, timeoutMs = 240000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const token = await azureToken(cfg);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json().catch(() => ({}));
    const st = String(data.status || data.properties?.provisioningState || '').toLowerCase();
    if (['succeeded', 'success', 'complete'].includes(st)) return data;
    if (['failed', 'canceled', 'cancelled'].includes(st)) {
      throw Object.assign(new Error(data.error?.message || 'Azure operation failed.'), { code: 'AZURE_ARM' });
    }
    await new Promise((ok) => setTimeout(ok, 3000));
  }
  throw Object.assign(new Error('Azure operation timed out.'), { code: 'AZURE_TIMEOUT' });
}

async function arm(cfg, method, urlPath, body, apiVersion) {
  const token = await azureToken(cfg);
  const url = urlPath.startsWith('http')
    ? urlPath
    : `${ARM}${urlPath}${urlPath.includes('?') ? '&' : '?'}api-version=${apiVersion}`;
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 204) return { status: 204 };
  const loc = r.headers.get('azure-asyncoperation') || r.headers.get('location');
  if ((r.status === 201 || r.status === 202) && loc) return pollAsync(cfg, loc);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data?.error?.message || `Azure ARM HTTP ${r.status}`);
    e.code = r.status === 404 ? 'AZURE_NOT_FOUND' : 'AZURE_ARM';
    e.status = r.status;
    throw e;
  }
  return data;
}

function rgPath(cfg) {
  return `/subscriptions/${cfg.subscriptionId}/resourceGroups/${cfg.resourceGroup}`;
}

function storageAccountName(cfg) {
  if (cfg.storageAccount) return cfg.storageAccount.toLowerCase();
  const suffix = crypto.createHash('sha256')
    .update(`${cfg.subscriptionId}:${cfg.resourceGroup}`)
    .digest('hex')
    .slice(0, 19);
  return `belna${suffix}`;
}

async function ensureScreenshotStorage(cfg = azureConfig()) {
  const account = storageAccountName(cfg);
  const accountId = `${rgPath(cfg)}/providers/Microsoft.Storage/storageAccounts/${account}`;
  await putIfMissing(cfg, accountId, {
    location: cfg.location,
    kind: 'StorageV2',
    sku: { name: 'Standard_LRS' },
    properties: {
      allowBlobPublicAccess: false,
      minimumTlsVersion: 'TLS1_2',
      supportsHttpsTrafficOnly: true,
    },
  }, STORAGE_API);
  const containerId = `${accountId}/blobServices/default/containers/${SCREEN_CONTAINER}`;
  await putIfMissing(cfg, containerId, { properties: { publicAccess: 'None' } }, STORAGE_API);
  return { account, accountId, container: SCREEN_CONTAINER };
}

/*
 * Start a persistent browser-side relay.  BrowserSessionScript is deliberately
 * kept as the compatibility/fallback path for tool calls, but it is not a
 * live viewer: it has to boot a Run Command for every action and upload one
 * image.  The relay keeps Chromium and its CDP connection open and forwards
 * Page.startScreencast frames over an outbound, authenticated WebSocket.  The
 * VM never accepts an inbound connection.
 */
function buildBrowserRelayScript(args = {}) {
  const sessionId = browserSessionId(args.sessionId);
  const relayUrl = String(args.relayUrl || '');
  const token = String(args.token || '');
  if (!/^wss?:\/\//i.test(relayUrl)) throw Object.assign(new Error('Browser relay URL must be ws:// or wss://.'), { code: 'BAD_INPUT' });
  if (!/^[A-Za-z0-9._~-]{32,256}$/.test(token)) throw Object.assign(new Error('Browser relay token is invalid.'), { code: 'BAD_INPUT' });
  const payload = {
    sessionId,
    relayUrl,
    token,
    allowedHosts: ['hn.algolia.com','api.duckduckgo.com','en.wikipedia.org','api.github.com','generativelanguage.googleapis.com'],
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const runner = [
    "const fs = require('fs');",
    "const path = require('path');",
    "const WebSocket = require('/opt/lingon/node_modules/ws');",
    "const payload = JSON.parse(Buffer.from(process.env.LINGON_BROWSER_RELAY_PAYLOAD, 'base64').toString('utf8'));",
    "const root = '/var/lib/lingon-browser/sessions';",
    "const profile = path.join(root, payload.sessionId);",
    "const stateFile = path.join(profile, 'state.json');",
    "const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
    "const findBrowser = () => ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));",
    "const allowed = (value) => { try { const u = new URL(value); return u.protocol === 'https:' && payload.allowedHosts.includes(u.hostname); } catch { return false; } };",
    "const send = (socket, value) => { try { if (socket && socket.readyState === 1) socket.send(JSON.stringify(value)); } catch {} };",
    "const pageState = async (page) => ({ url: page.url(), title: await page.title().catch(() => ''), text: await page.evaluate(() => document.body ? document.body.innerText.slice(0, 1800) : '').catch(() => ''), links: await page.evaluate(() => [...document.querySelectorAll('a[href]')].slice(0, 5).map((a) => ({ t: (a.innerText || '').slice(0, 60), h: a.href.slice(0, 160) }))).catch(() => []) });",
    "const connect = () => new Promise((resolve, reject) => { const socket = new WebSocket(payload.relayUrl); const timer = setTimeout(() => { try { socket.terminate(); } catch {} reject(new Error('relay connection timed out')); }, 15000); socket.once('open', () => { clearTimeout(timer); resolve(socket); }); socket.once('error', (error) => { clearTimeout(timer); reject(error); }); });",
    "(async () => {",
    "  fs.mkdirSync(profile, { recursive: true });",
    "  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { url: 'about:blank' };",
    "  const executablePath = findBrowser();",
    "  if (!executablePath) throw new Error('Chromium is not installed yet (first boot is still running).');",
    "  let puppeteer; try { puppeteer = require('/opt/lingon/node_modules/puppeteer-core'); } catch { throw new Error('VM browser runtime is not installed yet (first boot is still running).'); }",
    "  const port = 9300 + [...payload.sessionId].reduce((n, ch) => (n + ch.charCodeAt(0)) % 500, 0);",
    "  let browser;",
    "  try { const probe = await fetch('http://127.0.0.1:' + port + '/json/version'); if (!probe.ok) throw new Error('not ready'); browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + port }); }",
    "  catch { browser = await puppeteer.launch({ headless: true, executablePath, userDataDir: profile, args: ['--disable-dev-shm-usage', '--window-size=1280,900', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port] }); browser.process()?.unref?.(); }",
    "  let socket = null; let stopping = false; let page;",
    "  try {",
    "    const pages = await browser.pages(); page = pages[0] || await browser.newPage();",
    "    await page.setViewport({ width: 1280, height: 900 });",
    "    await page.setRequestInterception(true);",
    "    page.on('request', (request) => { try { const u = new URL(request.url()); if (['about:','data:','blob:'].includes(u.protocol) || (u.protocol === 'https:' && payload.allowedHosts.includes(u.hostname))) request.continue(); else request.abort('blockedbyclient'); } catch { request.abort('blockedbyclient'); } });",
    "    if (!state.url || state.url === 'about:blank') { await page.goto('about:blank').catch(() => {}); } else if (allowed(state.url)) { await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}); if (Number.isFinite(state.scrollY)) await page.evaluate((y) => window.scrollTo(0, y), state.scrollY).catch(() => {}); }",
    "    const cdp = await page.target().createCDPSession(); await cdp.send('Page.enable');",
    "    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 72, maxWidth: 1280, maxHeight: 900, everyNthFrame: 1 });",
    "    cdp.on('Page.screencastFrame', ({ data, sessionId: frameId }) => { try { if (socket && socket.readyState === 1 && socket.bufferedAmount < 4000000) socket.send(Buffer.from(data, 'base64')); } catch {} cdp.send('Page.screencastFrameAck', { sessionId: frameId }).catch(() => {}); });",
    "    const metadata = async () => { const s = await pageState(page); const scrollY = await page.evaluate(() => window.scrollY).catch(() => 0); fs.writeFileSync(stateFile, JSON.stringify({ url: s.url, title: s.title, scrollY })); return s; };",
    "    const dispatch = async (command) => { const action = String(command.action || 'inspect'); const ev = command.event || {}; if (action === 'navigate') { if (!allowed(command.url)) throw new Error('host blocked by sandbox allowlist'); await page.goto(command.url, { waitUntil: 'domcontentloaded', timeout: 20000 }); await sleep(250); } else if (action === 'input') { if (ev.type === 'click') await page.mouse.click(Number(ev.x) || 0, Number(ev.y) || 0, { button: ev.button === 2 ? 'right' : 'left' }); else if (ev.type === 'click_text') { const pos = await page.evaluate((text) => { const el = [...document.querySelectorAll('a,button,[role=button]')].find((node) => (node.innerText || '').trim() === text); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, String(ev.text || '')); if (!pos) throw new Error('Visible link or button text not found.'); await page.mouse.click(pos.x, pos.y); } else if (ev.type === 'move') await page.mouse.move(Number(ev.x) || 0, Number(ev.y) || 0); else if (ev.type === 'scroll') await page.mouse.wheel({ deltaY: Number(ev.dy) || 0 }); else if (ev.type === 'key') await page.keyboard.press(String(ev.key || 'Escape')); else if (ev.type === 'type') await page.keyboard.type(String(ev.text || '').slice(0, 200)); await sleep(ev.type === 'move' ? 0 : 35); } else if (action === 'stop') { stopping = true; } else if (action !== 'inspect') throw new Error('Unsupported browser relay action.'); return metadata(); };",
    "    while (!stopping) {",
    "      try { socket = await connect(); send(socket, { type: 'ready', sessionId: payload.sessionId }); send(socket, { type: 'meta', ...(await metadata()), state: 'idle' });",
    "        await new Promise((resolve) => { let commandQueue = Promise.resolve(); socket.on('message', (raw) => { commandQueue = commandQueue.then(async () => { let command; try { command = JSON.parse(String(raw)); } catch { return; } if (command.type !== 'command') return; try { const result = await dispatch(command); send(socket, { type: 'result', id: command.id, ...result, state: 'idle' }); } catch (error) { send(socket, { type: 'result', id: command.id, ok: false, error: String(error.message || error) }); } }).catch(() => {}); }); socket.once('close', resolve); socket.once('error', resolve); });",
    "      } catch (error) { if (!stopping) await sleep(1000); } finally { try { socket?.close(); } catch {} socket = null; }",
    "    }",
    "    await cdp.send('Page.stopScreencast').catch(() => {});",
    "    await browser.close().catch(() => {});",
    "  } finally { try { browser.disconnect(); } catch {} }",
    "})().catch((error) => { process.stderr.write(String(error.message || error)); process.exitCode = 1; });",
  ].join('\n');
  const codeB64 = Buffer.from(runner, 'utf8').toString('base64');
  const root = `/var/lib/lingon-browser/sessions/${sessionId}`;
  return [
    'set -eu',
    'id -u lingon-browser >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/lingon-browser --shell /usr/sbin/nologin lingon-browser',
    'if [ ! -d /opt/lingon/node_modules/ws ]; then npm install --prefix /opt/lingon ws@8.21.3; fi',
    `install -d -m 700 -o lingon-browser -g lingon-browser '${root}'`,
    `echo '${codeB64}' | base64 -d > '${root}/relay.js'`,
    `chown lingon-browser:lingon-browser '${root}/relay.js' && chmod 600 '${root}/relay.js'`,
    `if [ -f '${root}/relay.pid' ] && kill -0 "$(cat '${root}/relay.pid')" 2>/dev/null; then echo READY; exit 0; fi`,
    `runuser -u lingon-browser -- env LINGON_BROWSER_RELAY_PAYLOAD='${payloadB64}' nohup node '${root}/relay.js' >> '${root}/relay.log' 2>&1 & echo $! > '${root}/relay.pid'`,
    `chown lingon-browser:lingon-browser '${root}/relay.pid' '${root}/relay.log' 2>/dev/null || true`,
    'sleep 1',
    `kill -0 "$(cat '${root}/relay.pid')" 2>/dev/null`,
    'echo READY',
  ].join('\n');
}

function buildBrowserRelayStopScript(sessionId) {
  const id = browserSessionId(sessionId);
  const root = `/var/lib/lingon-browser/sessions/${id}`;
  return [
    'set +e',
    `if [ -f '${root}/relay.pid' ]; then kill "$(cat '${root}/relay.pid')" 2>/dev/null || true; fi`,
    `rm -f '${root}/relay.pid' '${root}/relay.js'`,
    'exit 0',
  ].join('\n');
}

async function ensureDurableStateStorage(cfg = azureConfig()) {
  const account = storageAccountName(cfg);
  const accountId = `${rgPath(cfg)}/providers/Microsoft.Storage/storageAccounts/${account}`;
  await putIfMissing(cfg, accountId, {
    location: cfg.location,
    kind: 'StorageV2',
    sku: { name: 'Standard_LRS' },
    properties: {
      allowBlobPublicAccess: false,
      minimumTlsVersion: 'TLS1_2',
      supportsHttpsTrafficOnly: true,
    },
  }, STORAGE_API);
  const containerId = `${accountId}/blobServices/default/containers/${STATE_CONTAINER}`;
  await putIfMissing(cfg, containerId, { properties: { publicAccess: 'None' } }, STORAGE_API);
  return { account, accountId, container: STATE_CONTAINER };
}

function blobServiceSas({ account, accountKey, container, blob, permissions = 'rcwd', minutes = 5 }) {
  const signedStart = new Date(Date.now() - 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const signedExpiry = new Date(Date.now() + minutes * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const canonicalizedResource = `/blob/${account}/${container}/${blob}`;
  const stringToSign = [
    permissions,
    signedStart,
    signedExpiry,
    canonicalizedResource,
    '',
    '',
    'https',
    BLOB_API,
    'b',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ].join('\n');
  const signature = crypto.createHmac('sha256', Buffer.from(accountKey, 'base64'))
    .update(stringToSign, 'utf8')
    .digest('base64');
  const query = new URLSearchParams({
    sp: permissions,
    st: signedStart,
    se: signedExpiry,
    spr: 'https',
    sv: BLOB_API,
    sr: 'b',
    sig: signature,
  });
  const encodedBlob = blob.split('/').map(encodeURIComponent).join('/');
  return `https://${account}.blob.core.windows.net/${container}/${encodedBlob}?${query}`;
}

async function createScreenshotTransfer(userId, sessionId) {
  const cfg = azureConfig();
  const storage = await ensureScreenshotStorage(cfg);
  const keys = await arm(cfg, 'POST', `${storage.accountId}/listKeys`, {}, STORAGE_API);
  const accountKey = (keys.keys || []).find((key) => key.value)?.value;
  if (!accountKey) throw Object.assign(new Error('Azure Storage account key was not returned.'), { code: 'AZURE_STORAGE' });
  const blob = `${userHash(userId)}/${browserSessionId(sessionId)}-${crypto.randomUUID()}.jpg`;
  const url = blobServiceSas({ ...storage, accountKey, blob });
  return { ...storage, blob, url };
}

async function createDurableStateTransfer(userId) {
  const cfg = azureConfig();
  const accountId = `${rgPath(cfg)}/providers/Microsoft.Storage/storageAccounts/${storageAccountName(cfg)}`;
  if (durableStorageCache.accountId !== accountId || Date.now() >= durableStorageCache.exp) {
    const storage = await ensureDurableStateStorage(cfg);
    const keys = await arm(cfg, 'POST', `${storage.accountId}/listKeys`, {}, STORAGE_API);
    const accountKey = (keys.keys || []).find((key) => key.value)?.value;
    if (!accountKey) throw Object.assign(new Error('Azure Storage account key was not returned.'), { code: 'AZURE_STORAGE' });
    durableStorageCache = { accountId, accountKey, storage, exp: Date.now() + 10 * 60000 };
  }
  const blob = `${userHash(userId)}/workspace-v1.tar.gz`;
  const url = blobServiceSas({ ...durableStorageCache.storage, accountKey: durableStorageCache.accountKey, blob, permissions: 'rcw', minutes: 15 });
  return { ...durableStorageCache.storage, blob, url };
}

function assertStateTransferUrl(value) {
  if (!/^https:\/\/[a-z0-9]{3,24}\.blob\.core\.windows\.net\/agent-state\/[A-Za-z0-9%/_-]+\.tar\.gz\?/.test(String(value || ''))) {
    throw Object.assign(new Error('Valid private workspace transfer URL required.'), { code: 'BAD_INPUT' });
  }
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function buildRestoreStateScript(url) {
  const encoded = assertStateTransferUrl(url);
  return [
    'set -eu',
    'MARKER=/var/lib/lingon-state/restored-v1',
    '[ -f "$MARKER" ] && exit 0',
    'install -d -m 700 /var/lib/lingon-state',
    'ARCHIVE=$(mktemp /tmp/lingon-state.XXXXXX.tar.gz)',
    'trap \'rm -f "$ARCHIVE"\' EXIT',
    `URL=$(echo '${encoded}' | base64 -d)`,
    `CODE=$(curl -sS --retry 2 -w '%{http_code}' -o "$ARCHIVE" -H 'x-ms-version: ${BLOB_API}' "$URL")`,
    'if [ "$CODE" = 200 ]; then',
    '  tar -xzf "$ARCHIVE" -C /',
    'elif [ "$CODE" != 404 ]; then',
    '  echo "Workspace restore failed with HTTP $CODE" >&2; exit 1',
    'fi',
    'id -u lingon-browser >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/lingon-browser --shell /usr/sbin/nologin lingon-browser',
    'install -d -m 700 -o lingon -g lingon /home/lingon/workspace',
    'install -d -m 700 -o lingon-browser -g lingon-browser /var/lib/lingon-browser/sessions',
    'chown -R lingon:lingon /home/lingon/workspace',
    'chown -R lingon-browser:lingon-browser /var/lib/lingon-browser/sessions',
    'date -u +%FT%TZ > "$MARKER"',
  ].join('\n');
}

function buildSnapshotStateScript(url) {
  const encoded = assertStateTransferUrl(url);
  return [
    'set -eu',
    'install -d -m 700 /var/lib/lingon-state',
    'install -d -m 700 -o lingon -g lingon /home/lingon/workspace',
    'install -d -m 700 -o lingon-browser -g lingon-browser /var/lib/lingon-browser/sessions',
    'pkill -u lingon-browser chromium 2>/dev/null || true',
    'sleep 1',
    'ARCHIVE=$(mktemp /tmp/lingon-state.XXXXXX.tar.gz)',
    'trap \'rm -f "$ARCHIVE"\' EXIT',
    "tar --exclude='*/Cache/*' --exclude='*/Code Cache/*' --exclude='*/GPUCache/*' -czf \"$ARCHIVE\" -C / home/lingon/workspace var/lib/lingon-browser/sessions",
    `URL=$(echo '${encoded}' | base64 -d)`,
    `curl -fsS --retry 2 -X PUT -H 'x-ms-version: ${BLOB_API}' -H 'x-ms-blob-type: BlockBlob' -H 'content-type: application/gzip' --data-binary @"$ARCHIVE" "$URL"`,
    'date -u +%FT%TZ > /var/lib/lingon-state/restored-v1',
  ].join('\n');
}

async function readAndDeleteScreenshot(transfer) {
  const response = await fetch(transfer.url, { headers: { 'x-ms-version': BLOB_API } });
  if (!response.ok) {
    throw Object.assign(new Error(`VM screenshot upload was not readable (HTTP ${response.status}).`), { code: 'AZURE_BROWSER' });
  }
  const image = Buffer.from(await response.arrayBuffer());
  if (!image.length || image.length > 2000000) {
    throw Object.assign(new Error('VM screenshot had an invalid size.'), { code: 'AZURE_BROWSER' });
  }
  const deleted = await fetch(transfer.url, { method: 'DELETE', headers: { 'x-ms-version': BLOB_API } });
  if (!deleted.ok && deleted.status !== 404) {
    throw Object.assign(new Error(`VM screenshot cleanup failed (HTTP ${deleted.status}).`), { code: 'AZURE_BROWSER' });
  }
  return `data:image/jpeg;base64,${image.toString('base64')}`;
}

function parseImage(image) {
  const [publisher, offer, sku, version] = String(image).split(':');
  if (!publisher || !offer || !sku) throw Object.assign(new Error('AZURE_VM_IMAGE must be publisher:offer:sku:version'), { code: 'BAD_INPUT' });
  return { publisher, offer, sku, version: version || 'latest' };
}

function sshEncodeRsa(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  const e = Buffer.from(jwk.e, 'base64url');
  const n = Buffer.from(jwk.n, 'base64url');
  const pack = (buf) => {
    let b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(b.length);
    return Buffer.concat([len, b]);
  };
  const str = (s) => pack(Buffer.from(s, 'utf8'));
  return 'ssh-rsa ' + Buffer.concat([str('ssh-rsa'), pack(e), pack(n)]).toString('base64') + ' lingon-sandbox';
}

function sshPublicKey() {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return sshEncodeRsa(pair.publicKey);
}

function nsgBody(cfg) {
  const rule = (name, priority, direction, access, protocol, dest, ports) => ({
    name,
    properties: {
      protocol,
      sourceAddressPrefix: '*',
      destinationAddressPrefix: dest,
      access,
      direction,
      priority,
      sourcePortRange: '*',
      ...(Array.isArray(ports) ? { destinationPortRanges: ports } : { destinationPortRange: ports }),
    },
  });
  return {
    location: cfg.location,
    properties: {
      securityRules: [
        rule('allow-out-web', 100, 'Outbound', 'Allow', 'Tcp', 'Internet', ['80', '443']),
        rule('allow-out-dns', 110, 'Outbound', 'Allow', 'Udp', '*', '53'),
        rule('allow-out-azure', 120, 'Outbound', 'Allow', '*', 'AzureCloud', '*'),
        rule('deny-in-all', 4096, 'Inbound', 'Deny', '*', '*', '*'),
        rule('deny-out-rest', 4095, 'Outbound', 'Deny', '*', '*', '*'),
      ],
    },
  };
}

async function putIfMissing(cfg, methodPath, body, apiVersion) {
  try {
    return await arm(cfg, 'GET', methodPath, undefined, apiVersion);
  } catch (e) {
    if (e.code !== 'AZURE_NOT_FOUND') throw e;
    return arm(cfg, 'PUT', methodPath, body, apiVersion);
  }
}

async function ensureInfrastructure(cfg = azureConfig()) {
  if (missingAzureFields(cfg).length) {
    throw Object.assign(new Error('Azure is not configured.'), { code: 'AZURE_NOT_CONFIGURED' });
  }
  const nsgId = `${rgPath(cfg)}/providers/Microsoft.Network/networkSecurityGroups/${cfg.nsg}`;
  const vnetId = `${rgPath(cfg)}/providers/Microsoft.Network/virtualNetworks/${cfg.vnet}`;
  await putIfMissing(cfg, nsgId, nsgBody(cfg), NET_API);
  await putIfMissing(cfg, vnetId, {
    location: cfg.location,
    properties: {
      addressSpace: { addressPrefixes: ['10.42.0.0/16'] },
      subnets: [{
        name: cfg.subnet,
        properties: {
          addressPrefix: '10.42.0.0/24',
          networkSecurityGroup: { id: nsgId },
        },
      }],
    },
  }, NET_API);
  return { nsgId, vnetId, subnetId: `${vnetId}/subnets/${cfg.subnet}` };
}

async function ensureVm(userId, { create = false } = {}) {
  const cfg = azureConfig();
  if (missingAzureFields(cfg).length) {
    throw Object.assign(new Error('Azure is not configured.'), { code: 'AZURE_NOT_CONFIGURED' });
  }
  const name = vmNameForUser(userId);
  const vmPath = `${rgPath(cfg)}/providers/Microsoft.Compute/virtualMachines/${name}`;
  try {
    const vm = await arm(cfg, 'GET', vmPath, undefined, COMPUTE_API);
    const key = String(userId);
    if (workerReadyState.get(key) && vm.properties?.vmId && workerReadyState.get(key) !== vm.properties.vmId) workerReadyState.delete(key);
    return { vmName: name, id: vm.id, vmId: vm.properties?.vmId || null, provisioningState: vm.properties?.provisioningState || 'Unknown' };
  } catch (e) {
    if (e.code !== 'AZURE_NOT_FOUND') throw e;
  }
  // A read-only status check must never allocate a VM. Callers that are
  // actually starting work pass create:true (or the on-demand policy below).
  // Keeping provisioning out of GET/status paths is what makes app presence
  // and ordinary chat free of VM side effects.
  if (!create) {
    throw Object.assign(new Error(`Azure VM ${name} is not provisioned. Run npm run azure:provision -- --create --user <id> or allow on-demand provisioning.`), { code: 'AZURE_VM_MISSING' });
  }
  restoredState.delete(String(userId));
  workerReadyState.delete(String(userId));
  const infra = await ensureInfrastructure(cfg);
  const nicPath = `${rgPath(cfg)}/providers/Microsoft.Network/networkInterfaces/${name}-nic`;
  const nic = await putIfMissing(cfg, nicPath, {
    location: cfg.location,
    properties: {
      ipConfigurations: [{
        name: 'ipconfig1',
        properties: {
          subnet: { id: infra.subnetId },
          privateIPAllocationMethod: 'Dynamic',
        },
      }],
    },
  }, NET_API);
  const publicKey = sshPublicKey();
  const image = parseImage(cfg.image);
  const vm = await arm(cfg, 'PUT', vmPath, {
    location: cfg.location,
    tags: { lingon: 'sandbox', user: userHash(userId) },
    properties: {
      hardwareProfile: { vmSize: cfg.vmSize },
      storageProfile: {
        imageReference: image,
        osDisk: { createOption: 'FromImage', managedDisk: { storageAccountType: 'Standard_LRS' } },
      },
      osProfile: {
        computerName: name.slice(0, 64),
        adminUsername: cfg.adminUsername,
        customData: cloudInit(cfg),
        linuxConfiguration: {
          disablePasswordAuthentication: true,
          ssh: { publicKeys: [{ path: `/home/${cfg.adminUsername}/.ssh/authorized_keys`, keyData: publicKey }] },
        },
      },
      networkProfile: { networkInterfaces: [{ id: nic.id || nicPath, properties: { primary: true } }] },
    },
  }, COMPUTE_API);
  return { vmName: name, id: vm.id, vmId: vm.properties?.vmId || null, provisioningState: vm.properties?.provisioningState || 'Creating' };
}

function parseRunOutput(data, { maxStdout = 12000, maxStderr = 4000 } = {}) {
  let output = data?.properties?.output;
  if (typeof output === 'string') {
    try { output = JSON.parse(output); } catch {}
  }
  const items = data?.value || data?.properties?.instanceView?.statuses || output?.value || [];
  let stdout = '';
  let stderr = '';
  for (const item of items) {
    const code = String(item.code || item.name || '');
    const msg = String(item.message || item.displayStatus || '');
    if (msg.includes('[stdout]')) {
      const marked = msg.slice(msg.indexOf('[stdout]') + '[stdout]'.length);
      const stderrAt = marked.indexOf('[stderr]');
      stdout += (stderrAt >= 0 ? marked.slice(0, stderrAt) : marked).replace(/^\r?\n|\r?\n$/g, '');
      if (stderrAt >= 0) stderr += marked.slice(stderrAt + '[stderr]'.length).replace(/^\r?\n|\r?\n$/g, '');
    } else if (/stdout/i.test(code)) stdout += msg;
    else if (/stderr/i.test(code)) stderr += msg;
  }
  if (!stdout && !stderr && output) stdout = typeof output === 'string' ? output : JSON.stringify(output).slice(0, 12000);
  return { stdout: stdout.slice(0, maxStdout), stderr: stderr.slice(0, maxStderr) };
}

function cloudInit(cfg) {
  const user = cfg.adminUsername || 'lingon';
  const image = workerImage(cfg);
  const workerContainerfile = Buffer.from([
    'FROM docker.io/library/node:22-bookworm-slim',
    'ENV DEBIAN_FRONTEND=noninteractive',
    'RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates coreutils python3 && rm -rf /var/lib/apt/lists/*',
    'WORKDIR /workspace',
  ].join('\n'), 'utf8').toString('base64');
  const yaml = [
    '#cloud-config',
    'package_update: true',
    'packages:',
    '  - python3',
    '  - ca-certificates',
    '  - curl',
    '  - xvfb',
    '  - fonts-liberation',
    '  - podman',
    '  - uidmap',
    '  - slirp4netns',
    '  - fuse-overlayfs',
    'runcmd:',
    '  - id -u lingon-browser >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/lingon-browser --shell /usr/sbin/nologin lingon-browser',
    '  - install -d -m 700 -o lingon-browser -g lingon-browser /var/lib/lingon-browser /var/lib/lingon-browser/sessions',
    `  - mkdir -p /home/${user}/workspace /opt/lingon`,
    `  - chown -R ${user}:${user} /home/${user}/workspace`,
    '  - curl -fsSL https://deb.nodesource.com/setup_22.x | bash -',
    '  - apt-get install -y nodejs',
    '  - snap install chromium || apt-get install -y chromium-browser || apt-get install -y chromium || true',
    '  - mkdir -p /opt/lingon && chown -R ' + user + ':' + user + ' /opt/lingon',
    '  - su - ' + user + ' -c "npm install --prefix /opt/lingon puppeteer-core@25.11.0 ws@8.21.3" || true',
    '  - install -d -m 700 /opt/lingon/worker /var/lib/lingon-worker',
    `  - echo '${workerContainerfile}' | base64 -d > /opt/lingon/worker/Containerfile`,
    `  - podman image exists ${shellQuote(image)} || (podman pull ${shellQuote(image)} || podman build --pull=missing -t ${shellQuote(image)} /opt/lingon/worker)`,
    `  - podman image exists ${shellQuote(image)} && touch /var/lib/lingon-worker/ready || true`,
  ].join('\n');
  return Buffer.from(yaml, 'utf8').toString('base64');
}

function touchActivity(userId) {
  void userId;
}

function readLastUsed(userId) {
  void userId;
  return 0;
}

function parsePower(data) {
  for (const s of data?.statuses || []) {
    const c = String(s.code || '');
    if (c.startsWith('PowerState/')) return c.slice('PowerState/'.length);
  }
  return 'unknown';
}

async function powerState(userId) {
  const cfg = azureConfig();
  const name = vmNameForUser(userId);
  const data = await arm(cfg, 'GET', `${rgPath(cfg)}/providers/Microsoft.Compute/virtualMachines/${name}/instanceView`, undefined, COMPUTE_API);
  return parsePower(data);
}

async function waitPower(userId, want, timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = await powerState(userId);
    if (st === want) return st;
    await new Promise((ok) => setTimeout(ok, 4000));
  }
  throw Object.assign(new Error(`Azure VM did not reach ${want} in time.`), { code: 'AZURE_TIMEOUT' });
}

async function startVm(userId) {
  const cfg = azureConfig();
  const name = vmNameForUser(userId);
  await arm(cfg, 'POST', `${rgPath(cfg)}/providers/Microsoft.Compute/virtualMachines/${name}/start`, undefined, COMPUTE_API);
  await waitPower(userId, 'running');
  touchActivity(userId);
  return { vmName: name, power: 'running' };
}

async function deallocateVm(userId) {
  const cfg = azureConfig();
  const name = vmNameForUser(userId);
  await arm(cfg, 'POST', `${rgPath(cfg)}/providers/Microsoft.Compute/virtualMachines/${name}/deallocate`, undefined, COMPUTE_API);
  return { vmName: name, power: 'deallocated' };
}

async function deallocateByName(name) {
  const cfg = azureConfig();
  await arm(cfg, 'POST', `${rgPath(cfg)}/providers/Microsoft.Compute/virtualMachines/${name}/deallocate`, undefined, COMPUTE_API);
}

function userLeases(userId) {
  let map = leases.get(String(userId));
  if (!map) { map = new Map(); leases.set(String(userId), map); }
  return map;
}

async function leaseSnapshot(userId) {
  const durable = await supabaseLeaseRows(userId);
  if (durable) {
    return durable.map((lease) => ({ kind: lease.kind, expiresAt: new Date(lease.expires_at).getTime() }));
  }
  const map = leases.get(String(userId));
  return [...(map || new Map()).values()].map((lease) => ({ kind: lease.kind, expiresAt: lease.expiresAt }));
}

async function deallocateIfUnused(userId) {
  const key = String(userId);
  if ((leases.get(key)?.size || 0) > 0 || stopping.has(key)) return;
  if (!isAzureConfigured()) return;
  const operation = snapshotDurableState(key).then(() => deallocateVm(key)).catch(() => {}).finally(() => stopping.delete(key));
  stopping.set(key, operation);
  await operation;
}

async function acquireLease(userId, { leaseId, kind = 'app' } = {}) {
  if (!userId) throw Object.assign(new Error('userId required'), { code: 'BAD_INPUT' });
  const id = String(leaseId || '').trim();
  if (!/^[A-Za-z0-9:_-]{6,120}$/.test(id)) throw Object.assign(new Error('Valid leaseId required.'), { code: 'BAD_INPUT' });
  if (!isAzureConfigured()) throw Object.assign(new Error('Azure is not configured.'), { code: 'AZURE_NOT_CONFIGURED' });
  if (!isLeaseStoreConfigured()) {
    throw Object.assign(new Error('Durable VM leases are not configured.'), { code: 'SUPABASE_NOT_CONFIGURED' });
  }
  const expiresAt = Date.now() + LEASE_TTL_MS;
  let acquired = false;
  for (let attempt = 0; attempt < 100 && !acquired; attempt++) {
    const result = await supabaseRpc('acquire_agent_vm_lease', {
      p_user_id: String(userId),
      p_lease_id: id,
      p_kind: String(kind || 'app').slice(0, 32),
      p_vm_name: vmNameForUser(userId),
      p_expires_at: new Date(expiresAt).toISOString(),
    });
    acquired = !!(Array.isArray(result) ? result[0]?.acquired : result?.acquired);
    if (!acquired) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (!acquired) throw Object.assign(new Error('VM is still stopping; retry shortly.'), { code: 'AZURE_BUSY' });
  try {
    const vm = await ensureRunning(userId, { create: azureConfig().autoProvision });
    const workerKey = String(userId);
    if (workerReadyState.get(workerKey) && vm.vmId && workerReadyState.get(workerKey) !== vm.vmId) workerReadyState.delete(workerKey);
    await restoreDurableState(userId, { vmId: vm.vmId });
    await supabaseRpc('mark_agent_vm_running', { p_user_id: String(userId) });
  } catch (error) {
    await releaseLease(userId, { leaseId: id, skipSnapshot: true }).catch(() => {});
    throw error;
  }
  touchActivity(userId);
  return { vmName: vmNameForUser(userId), power: 'running', leaseId: id, leases: await leaseSnapshot(userId), expiresAt };
}

async function renewLease(userId, { leaseId } = {}) {
  const id = String(leaseId || '').trim();
  if (!/^[A-Za-z0-9:_-]{6,120}$/.test(id)) throw Object.assign(new Error('Valid leaseId required.'), { code: 'BAD_INPUT' });
  if (!isLeaseStoreConfigured()) return acquireLease(userId, { leaseId: id, kind: 'app' });
  const expiresAt = Date.now() + LEASE_TTL_MS;
  const result = await supabaseRpc('acquire_agent_vm_lease', {
    p_user_id: String(userId), p_lease_id: id, p_kind: 'app', p_vm_name: vmNameForUser(userId),
    p_expires_at: new Date(expiresAt).toISOString(),
  });
  const row = Array.isArray(result) ? result[0] : result;
  if (!row?.acquired) return acquireLease(userId, { leaseId: id, kind: 'app' });
  if (row.power_state !== 'running') {
    await ensureRunning(userId, { create: azureConfig().autoProvision });
    await supabaseRpc('mark_agent_vm_running', { p_user_id: String(userId) });
  }
  touchActivity(userId);
  return { vmName: vmNameForUser(userId), power: 'running', leaseId: id, leases: await leaseSnapshot(userId), expiresAt };
}

async function releaseLease(userId, { leaseId, skipSnapshot = false } = {}) {
  const key = String(userId);
  const id = String(leaseId || '').trim();
  if (isLeaseStoreConfigured()) {
    const claim = crypto.randomUUID();
    let preSnapshotted = false;
    let result;
    try {
      result = await supabaseRpc('release_agent_vm_lease', {
        p_user_id: key,
        p_lease_id: id,
        p_claim_token: claim,
        p_idle_until: new Date(Date.now() + azureConfig().idleMinutes * 60000).toISOString(),
      });
    } catch (error) {
      if (error.code !== 'VM_LEASE_SCHEMA_MISSING') throw error;
      // Rolling deploys may briefly run against the previous three-argument
      // function, which stops immediately. Save state before asking it to stop.
      if (!skipSnapshot) { await snapshotDurableState(key); preSnapshotted = true; }
      result = await supabaseRpc('release_agent_vm_lease', {
        p_user_id: key, p_lease_id: id, p_claim_token: claim,
      });
    }
    const row = Array.isArray(result) ? result[0] : result;
    if (row?.should_stop) {
      let success = false;
      try {
        if (!skipSnapshot && !preSnapshotted) await snapshotDurableState(key);
        await deallocateVm(key);
        success = true;
      }
      finally {
        await supabaseRpc('finish_agent_vm_stop', { p_user_id: key, p_claim_token: claim, p_success: success }).catch(() => {});
      }
    }
    const active = await leaseSnapshot(key);
    if (!active.length && !row?.should_stop && !skipSnapshot && !preSnapshotted) await snapshotDurableState(key);
    return { vmName: vmNameForUser(key), power: active.length ? 'running' : (row?.idle_until ? 'idle' : 'deallocated'), idleUntil: row?.idle_until || null, leases: active };
  }
  const map = leases.get(key);
  if (map) { map.delete(id); if (!map.size) leases.delete(key); }
  await deallocateIfUnused(key);
  return { vmName: vmNameForUser(key), power: (leases.get(key)?.size || 0) ? 'running' : 'deallocated', leases: await leaseSnapshot(key) };
}

async function sweepLeases({ limit = 20 } = {}) {
  if (isLeaseStoreConfigured()) {
    const claim = crypto.randomUUID();
    const rows = await supabaseRpc('claim_idle_agent_vms', { p_claim_token: claim, p_limit: limit }) || [];
    const results = [];
    for (const row of rows) {
      let success = false;
      try { await snapshotDurableState(row.user_id); await deallocateVm(row.user_id); success = true; }
      catch (error) { results.push({ vmName: row.vm_name, stopped: false, error: error.code || 'AZURE_ARM' }); }
      finally {
        await supabaseRpc('finish_agent_vm_stop', {
          p_user_id: row.user_id, p_claim_token: row.claim_token || claim, p_success: success,
        }).catch(() => {});
      }
      if (success) results.push({ vmName: row.vm_name, stopped: true });
    }
    return { checked: rows.length, results };
  }
  const now = Date.now();
  for (const [userId, map] of leases) {
    for (const [leaseId, lease] of map) if (lease.expiresAt <= now) map.delete(leaseId);
    if (!map.size) { leases.delete(userId); await deallocateIfUnused(userId); }
  }
  return { checked: leases.size, results: [] };
}

async function ensureRunning(userId, { create = true } = {}) {
  const vm = await ensureVm(userId, { create });
  const key = String(userId);
  if (workerReadyState.get(key) && vm.vmId && workerReadyState.get(key) !== vm.vmId) workerReadyState.delete(key);
  const st = await powerState(userId);
  if (st !== 'running') await startVm(userId);
  else touchActivity(userId);
  return { vmName: vmNameForUser(userId), vmId: vm.vmId, power: 'running' };
}

let idleTimer = null;
async function sweepIdle() {
  return sweepLeases();
}

function startIdleWatcher() {
  if (idleTimer || !isAzureConfigured()) return;
  idleTimer = setInterval(() => { sweepLeases().catch(() => {}); }, 15000);
  if (idleTimer.unref) idleTimer.unref();
}

async function runCommand(userId, script, { maxStdout = 12000 } = {}) {
  const cfg = azureConfig();
  const name = vmNameForUser(userId);
  const path_ = `${rgPath(cfg)}/providers/Microsoft.Compute/virtualMachines/${name}/runCommand`;
  const data = await arm(cfg, 'POST', path_, { commandId: 'RunShellScript', script: [script] }, COMPUTE_API);
  return parseRunOutput(data, { maxStdout });
}

async function waitWorkerReady(userId) {
  const key = String(userId);
  if (workerReadyState.has(key)) return true;
  const out = await runCommand(userId, [
    'set +e',
    'for i in $(seq 1 90); do',
    '  if [ -f /var/lib/lingon-worker/ready ]; then echo READY; exit 0; fi',
    '  sleep 2',
    'done',
    'echo "Worker container did not become ready during VM bootstrap." >&2',
    'exit 125',
  ].join('\n'), { maxStdout: 1000, maxStderr: 2000 });
  if (!/\bREADY\b/.test(out.stdout)) {
    throw Object.assign(new Error(out.stderr || 'Worker container runtime/image is not ready.'), { code: 'WORKER_NOT_READY' });
  }
  const vm = await ensureVm(userId, { create: false }).catch(() => null);
  workerReadyState.set(key, vm?.vmId || 'ready');
  return true;
}

async function restoreDurableState(userId, { vmId } = {}) {
  const cfg = azureConfig();
  if (!cfg.durableState) return { restored: false, disabled: true };
  const key = String(userId);
  if (vmId && restoredState.get(key) === vmId) return { restored: true, cached: true };
  const transfer = await createDurableStateTransfer(userId);
  const out = await runCommand(userId, buildRestoreStateScript(transfer.url), { maxStdout: 2000 });
  if (out.stderr) throw Object.assign(new Error(out.stderr), { code: 'AZURE_STATE_RESTORE' });
  if (vmId) restoredState.set(key, vmId);
  return { restored: true };
}

async function snapshotDurableState(userId) {
  const cfg = azureConfig();
  if (!cfg.durableState) return { saved: false, disabled: true };
  const transfer = await createDurableStateTransfer(userId);
  const out = await runCommand(userId, buildSnapshotStateScript(transfer.url), { maxStdout: 2000 });
  if (out.stderr) throw Object.assign(new Error(out.stderr), { code: 'AZURE_STATE_SAVE' });
  return { saved: true };
}

async function getSandbox(userId) {
  if (!userId) throw Object.assign(new Error('userId required'), { code: 'BAD_INPUT' });
  const cfg = azureConfig();
  const missing = missingAzureFields(cfg);
  if (!missing.length) {
    return {
      mode: 'azure',
      provider: 'azure-vm',
      vmName: vmNameForUser(userId),
      resourceGroup: cfg.resourceGroup,
      location: cfg.location,
      vmSize: cfg.vmSize,
      worker: 'vm-container',
      workerImage: workerImage(cfg),
      idleMinutes: cfg.idleMinutes,
      autoProvision: cfg.autoProvision,
      durableState: cfg.durableState,
      network: 'egress-allowlist-only',
      persistence: cfg.durableState ? 'private-blob-snapshot' : 'vm-os-disk-only',
      note: cfg.durableState
        ? 'Dedicated Azure VM starts only for full-OS work. Shell and code run in a hardened worker container inside that VM; workspace files and browser profile restore from private durable storage and save before deallocation.'
        : 'Dedicated Azure VM starts only for full-OS work. Shell and code run in a hardened worker container inside that VM; files persist across stop/start on the VM OS disk only.',
    };
  }
  return {
    mode: 'local',
    provider: 'local-per-user-fallback',
    vmName: null,
    worker: 'unavailable',
    workspace: localWorkspaceForUser(userId),
    missingAzureFields: missing,
    note: 'Azure not configured — using isolated per-user workspace. code_run stays disabled until Azure VM boundary exists.',
  };
}

async function statusForUser(userId) {
  const sb = await getSandbox(userId);
  let vm = null;
  if (sb.mode === 'azure') {
    try {
      vm = await ensureVm(userId, { create: false });
      vm.power = await powerState(userId).catch(() => 'unknown');
      vm.lastUsed = readLastUsed(userId) || null;
    } catch (e) { vm = { error: e.code || 'AZURE_ARM' }; }
  }
  return {
    ...sb,
    vm,
    leases: await leaseSnapshot(userId),
    model: process.env.AZURE_FOUNDRY_MODEL || 'gpt-6-luna',
    harness: 'foundry-azure-vm-harness',
    foundryUsed: true,
  };
}

async function runBrowserSession(userId, sb, args) {
  const transfer = await createScreenshotTransfer(userId, args.sessionId);
  try {
    const out = await runCommand(userId, buildBrowserSessionScript(args.action, { ...args, uploadUrl: transfer.url }), { maxStdout: 12000, maxStderr: 12000 });
    let parsed = null;
    try { parsed = JSON.parse(String(out.stdout || '').trim().split('\n').pop()); } catch {}
    if (!parsed || parsed.ok === false) {
      throw Object.assign(new Error(parsed?.error || out.stderr || out.stdout || 'Browser session failed on the user VM.'), { code: 'AZURE_BROWSER' });
    }
    const screenshot = await readAndDeleteScreenshot(transfer);
    return { mode: 'azure', vmName: sb.vmName, ...parsed, screenshot };
  } finally {
    await fetch(transfer.url, { method: 'DELETE', headers: { 'x-ms-version': BLOB_API } }).catch(() => {});
  }
}

async function startBrowserRelay(userId, args = {}, { alreadyRunning = false } = {}) {
  const sb = await getSandbox(userId);
  if (sb.mode !== 'azure') {
    throw Object.assign(new Error('Live browser relay requires the user Azure VM.'), { code: 'DISABLED' });
  }
  if (!alreadyRunning) await ensureRunning(userId);
  const out = await runCommand(userId, buildBrowserRelayScript(args), { maxStdout: 2000, maxStderr: 4000 });
  if (!/\bREADY\b/.test(out.stdout || '')) {
    throw Object.assign(new Error(out.stderr || 'Browser live relay did not start.'), { code: 'AZURE_BROWSER_RELAY' });
  }
  return { mode: 'azure', vmName: sb.vmName, relay: 'cdp-screencast' };
}

async function stopBrowserRelay(userId, sessionId) {
  if (!isAzureConfigured()) return { stopped: false, disabled: true };
  try {
    await runCommand(userId, buildBrowserRelayStopScript(sessionId), { maxStdout: 1000, maxStderr: 1000 });
    return { stopped: true };
  } catch (error) {
    return { stopped: false, error: error.code || 'AZURE_BROWSER_RELAY' };
  }
}

async function execInSandbox(userId, tool, args = {}, { alreadyRunning = false, taskId } = {}) {
  const sb = await getSandbox(userId);
  const vmTools = new Set(['code_run', 'shell', 'browser_open', 'computer_screenshot', 'browser_action', 'browser_session', 'browser_relay']);
  if (!vmTools.has(tool)) return { mode: sb.mode, tool, note: 'executed by existing allowlisted tool path' };
  if (sb.mode !== 'azure') {
    throw Object.assign(new Error('This tool runs only inside the user Azure VM. Configure AZURE_* to enable it.'), { code: 'DISABLED' });
  }
  // A newly acquired agent lease already confirmed power state. Other callers
  // still verify it here before touching the VM.
  if (!alreadyRunning) await ensureRunning(userId);
  if (tool === 'code_run') {
    await waitWorkerReady(userId);
    const out = await runCommand(userId, buildRunScript(args.language, args.code, taskId));
    return { mode: 'azure', vmName: sb.vmName, language: String(args.language || 'js'), ...out };
  }
  if (tool === 'shell') {
    await waitWorkerReady(userId);
    const out = await runCommand(userId, buildShellScript(args.command, taskId));
    return { mode: 'azure', vmName: sb.vmName, tool: 'shell', ...out };
  }
  if (tool === 'browser_open' || tool === 'computer_screenshot') {
    return runBrowserSession(userId, sb, {
      sessionId: toolBrowserSessionId(userId, args.sessionId),
      action: 'navigate',
      url: args.url,
    });
  }
  if (tool === 'browser_action') {
    return runBrowserSession(userId, sb, {
      sessionId: toolBrowserSessionId(userId, args.sessionId),
      action: 'input',
      event: args.event,
    });
  }
  if (tool === 'browser_session') {
    return runBrowserSession(userId, sb, args);
  }
  if (tool === 'browser_relay') {
    return startBrowserRelay(userId, args, { alreadyRunning: true });
  }
  return { mode: 'azure', vmName: sb.vmName, tool };
}

async function provisionUserVm(userId) {
  return ensureVm(userId, { create: true });
}

module.exports = {
  azureConfig,
  isAzureConfigured,
  isLeaseStoreConfigured,
  verifySweepToken,
  missingAzureFields,
  vmNameForUser,
  userHash,
  localWorkspaceForUser,
  assertLocalPath,
  workerImage,
  buildRunScript,
  buildShellScript,
  buildBrowserSessionScript,
  buildBrowserRelayScript,
  buildBrowserRelayStopScript,
  cloudInit,
  buildRestoreStateScript,
  buildSnapshotStateScript,
  getSandbox,
  statusForUser,
  execInSandbox,
  startBrowserRelay,
  stopBrowserRelay,
  ensureInfrastructure,
  ensureVm,
  ensureRunning,
  waitWorkerReady,
  acquireLease,
  renewLease,
  releaseLease,
  sweepLeases,
  startVm,
  deallocateVm,
  powerState,
  startIdleWatcher,
  sweepIdle,
  provisionUserVm,
  restoreDurableState,
  snapshotDurableState,
  LANGS,
};
