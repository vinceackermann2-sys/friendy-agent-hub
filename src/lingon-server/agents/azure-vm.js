/* Lingon per-user sandbox — Azure VM (Microsoft) with secure local fallback.
   Each user gets ONE VM: lingon-sb-<sha256(userId)[0:24]>.
   Untrusted code runs only via Azure Run Command on that VM. This process
   never executes user code (node:vm is not a security boundary).
   No public SSH, no public IP, no secrets copied into the VM.
   Missing AZURE_* → isolated local workspace; code_run stays DISABLED.
*/
import crypto from 'node:crypto';

const SANDBOX_ROOT = '/tmp/lingon-sandboxes';
const ARM = 'https://management.azure.com';
const COMPUTE_API = '2024-07-01';
const NET_API = '2023-09-01';
const STORAGE_API = '2023-05-01';
const BLOB_API = '2023-11-03';
const SCREEN_CONTAINER = 'browser-shots';
const LANGS = { js: 'node', javascript: 'node', node: 'node', py: 'python3', python: 'python3', sh: 'bash', bash: 'bash' };
const LEASE_TTL_MS = 90000;
const leases = new Map(); // userId -> Map(leaseId, { kind, expiresAt })
const stopping = new Map(); // userId -> Promise, prevents duplicate deallocate calls
let sweepTokenCache = { value: '', at: 0 };

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
    adminUsername: env('AZURE_ADMIN_USERNAME', 'lingon'),
    vnet: env('AZURE_VNET', 'lingon-sandbox-vnet'),
    subnet: env('AZURE_SUBNET', 'sandbox'),
    nsg: env('AZURE_NSG', 'lingon-sandbox-nsg'),
    storageAccount: env('AZURE_STORAGE_ACCOUNT'),
    image: env('AZURE_VM_IMAGE', 'Canonical:0001-com-ubuntu-server-jammy:22_04-lts:latest'),
    idleMinutes: Number(env('AZURE_VM_IDLE_MINUTES', '30')) || 30,
    perUserVM: env('AZURE_PER_USER_VM', 'true').toLowerCase() !== 'false',
    autoProvision: env('AZURE_AUTO_PROVISION', 'true').toLowerCase() === 'true',
  };
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

function buildRunScript(language, code) {
  const bin = LANGS[String(language || '').toLowerCase()];
  if (!bin) throw Object.assign(new Error('Unsupported language. Use js, python, or bash.'), { code: 'BAD_INPUT' });
  const src = String(code || '');
  if (!src.trim()) throw Object.assign(new Error('Code is required.'), { code: 'BAD_INPUT' });
  if (src.length > 20000) throw Object.assign(new Error('Code exceeds 20KB sandbox limit.'), { code: 'BAD_INPUT' });
  const b64 = Buffer.from(src, 'utf8').toString('base64');
  if (/[^A-Za-z0-9+/=]/.test(b64)) throw Object.assign(new Error('Sandbox encode failed.'), { code: 'BAD_INPUT' });
  const ext = bin === 'node' ? 'js' : bin === 'python3' ? 'py' : 'sh';
  return [
    'set -eu',
    'WORKDIR=/home/lingon/workspace',
    'mkdir -p "$WORKDIR"',
    'cd "$WORKDIR"',
    `echo '${b64}' | base64 -d > "$WORKDIR/.job.${ext}"`,
    `timeout 20s ${bin} "$WORKDIR/.job.${ext}"; EC=$?`,
    `rm -f "$WORKDIR/.job.${ext}"`,
    'exit $EC',
  ].join('\n');
}

function buildShellScript(command) {
  const cmd = String(command || '');
  if (!cmd.trim()) throw Object.assign(new Error('Command is required.'), { code: 'BAD_INPUT' });
  if (cmd.length > 8000) throw Object.assign(new Error('Command exceeds 8KB sandbox limit.'), { code: 'BAD_INPUT' });
  const b64 = Buffer.from(cmd, 'utf8').toString('base64');
  if (/[^A-Za-z0-9+/=]/.test(b64)) throw Object.assign(new Error('Sandbox encode failed.'), { code: 'BAD_INPUT' });
  return [
    'set +e',
    'WORKDIR=/home/lingon/workspace',
    'mkdir -p "$WORKDIR"',
    'cd "$WORKDIR"',
    `echo '${b64}' | base64 -d > /tmp/lingon-cmd.sh`,
    'timeout 30s bash /tmp/lingon-cmd.sh',
    'EC=$?',
    'rm -f /tmp/lingon-cmd.sh',
    'exit $EC',
  ].join('\n');
}

function buildBrowserScript(url) {
  const u = String(url || '');
  if (!/^https:\/\//i.test(u)) throw Object.assign(new Error('HTTPS URL required.'), { code: 'BAD_INPUT' });
  const b64 = Buffer.from(u, 'utf8').toString('base64');
  return [
    'set +e',
    `URL=$(echo '${b64}' | base64 -d)`,
    'BIN=$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)',
    'if [ -z "$BIN" ]; then echo \'{"ok":false,"error":"chromium not installed yet (first-boot still running)"}\'; exit 1; fi',
    'mkdir -p /tmp/lingon-browser /home/lingon/workspace',
    'timeout 25s "$BIN" --headless --disable-gpu --no-sandbox --window-size=1280,900 --dump-dom --virtual-time-budget=8000 "$URL" > /tmp/lingon-browser/dom.html 2>/tmp/lingon-browser/err.txt',
    'timeout 25s "$BIN" --headless --disable-gpu --no-sandbox --window-size=1280,900 --screenshot=/tmp/lingon-browser/shot.png --virtual-time-budget=8000 "$URL" >/dev/null 2>&1',
    'python3 - <<\'PY\'',
    'import json,os,re,base64',
    'html=open("/tmp/lingon-browser/dom.html","r",errors="ignore").read() if os.path.exists("/tmp/lingon-browser/dom.html") else ""',
    'title=re.search(r"<title[^>]*>(.*?)</title>", html, re.I|re.S)',
    'text=re.sub(r"<script[\\s\\S]*?</script>","", html, flags=re.I)',
    'text=re.sub(r"<style[\\s\\S]*?</style>","", text, flags=re.I)',
    'text=re.sub(r"<[^>]+>"," ", text)',
    'text=re.sub(r"\\s+"," ", text).strip()[:4000]',
    'shot=""',
    'p="/tmp/lingon-browser/shot.png"',
    'if os.path.exists(p) and os.path.getsize(p)<=180000:',
    '    shot="data:image/png;base64,"+base64.b64encode(open(p,"rb").read()).decode()',
    'print(json.dumps({"ok":True,"title":(title.group(1).strip()[:200] if title else ""),"text":text,"screenshot":shot}))',
    'PY',
  ].join('\n');
}

function browserSessionId(value) {
  const id = String(value || '');
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) {
    throw Object.assign(new Error('Invalid browser session id.'), { code: 'BAD_INPUT' });
  }
  return id;
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
    "const root = '/home/lingon/workspace/.browser-sessions';",
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
    "  const browser = await puppeteer.launch({ headless: true, executablePath, userDataDir: profile, args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1280,900'] });",
    "  try {",
    "    const pages = await browser.pages();",
    "    const page = pages[0] || await browser.newPage();",
    "    await page.setViewport({ width: 1280, height: 900 });",
    "    if (payload.action === 'navigate') { await page.goto(payload.url, { waitUntil: 'domcontentloaded', timeout: 20000 }); await sleep(700); }",
    "    else if (payload.action === 'input') {",
    "      if (state.url && state.url !== 'about:blank') await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: 20000 });",
    "      const ev = payload.event || {};",
    "      if (ev.type === 'click') await page.mouse.click(Number(ev.x) || 0, Number(ev.y) || 0, { button: ev.button === 2 ? 'right' : 'left' });",
    "      else if (ev.type === 'move') await page.mouse.move(Number(ev.x) || 0, Number(ev.y) || 0);",
    "      else if (ev.type === 'scroll') await page.mouse.wheel({ deltaY: Number(ev.dy) || 0 });",
    "      else if (ev.type === 'key') await page.keyboard.press(String(ev.key || 'Escape'));",
    "      else if (ev.type === 'type') await page.keyboard.type(String(ev.text || '').slice(0, 200));",
    "      await sleep(250);",
    "    } else if (state.url && state.url !== 'about:blank') { await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: 20000 }); await sleep(250); }",
    "    const url = page.url();",
    "    const title = await page.title().catch(() => '');",
    "    const text = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 1800) : '').catch(() => '');",
    "    const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].slice(0, 5).map((a) => ({ t: (a.innerText || '').slice(0, 60), h: a.href.slice(0, 160) }))).catch(() => []);",
    "    const screenshot = await page.screenshot({ type: 'jpeg', quality: 55 });",
    "    const upload = await fetch(payload.uploadUrl, { method: 'PUT', headers: { 'content-type': 'image/jpeg', 'x-ms-blob-type': 'BlockBlob' }, body: screenshot });",
    "    if (!upload.ok) throw new Error('Screenshot upload failed: HTTP ' + upload.status + ' ' + (await upload.text()).slice(0, 300));",
    "    fs.writeFileSync(stateFile, JSON.stringify({ url, title }));",
    "    process.stdout.write(JSON.stringify({ ok: true, url, title, text, links, screenshotBytes: screenshot.length }));",
    "  } finally { await browser.close().catch(() => {}); }",
    "})().catch((error) => { process.stdout.write(JSON.stringify({ ok: false, error: String(error.message || error) })); process.exitCode = 1; });",
  ].join('\n');
  const codeB64 = Buffer.from(runner, 'utf8').toString('base64');
  return [
    'set +e',
    `echo '${codeB64}' | base64 -d > /tmp/lingon-browser-session.js`,
    `LINGON_BROWSER_PAYLOAD='${payloadB64}' node /tmp/lingon-browser-session.js`,
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
    return { vmName: name, id: vm.id, provisioningState: vm.properties?.provisioningState || 'Unknown' };
  } catch (e) {
    if (e.code !== 'AZURE_NOT_FOUND') throw e;
  }
  if (!create && !cfg.autoProvision) {
    throw Object.assign(new Error(`Azure VM ${name} is not provisioned. Run npm run azure:provision -- --create --user <id> or set AZURE_AUTO_PROVISION=true.`), { code: 'AZURE_VM_MISSING' });
  }
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
  return { vmName: name, id: vm.id, provisioningState: vm.properties?.provisioningState || 'Creating' };
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
  const yaml = [
    '#cloud-config',
    'package_update: true',
    'packages:',
    '  - python3',
    '  - ca-certificates',
    '  - curl',
    '  - xvfb',
    '  - fonts-liberation',
    'runcmd:',
    `  - mkdir -p /home/${user}/workspace /opt/lingon`,
    `  - chown -R ${user}:${user} /home/${user}/workspace`,
    '  - curl -fsSL https://deb.nodesource.com/setup_22.x | bash -',
    '  - apt-get install -y nodejs',
    '  - snap install chromium || apt-get install -y chromium-browser || apt-get install -y chromium || true',
    '  - mkdir -p /opt/lingon && chown -R ' + user + ':' + user + ' /opt/lingon',
    '  - su - ' + user + ' -c "npm install --prefix /opt/lingon puppeteer-core@25.11.0" || true',
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
  const operation = deallocateVm(key).catch(() => {}).finally(() => stopping.delete(key));
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
    await ensureRunning(userId);
    await supabaseRpc('mark_agent_vm_running', { p_user_id: String(userId) });
  } catch (error) {
    await releaseLease(userId, { leaseId: id }).catch(() => {});
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
    await ensureRunning(userId);
    await supabaseRpc('mark_agent_vm_running', { p_user_id: String(userId) });
  }
  touchActivity(userId);
  return { vmName: vmNameForUser(userId), power: 'running', leaseId: id, leases: await leaseSnapshot(userId), expiresAt };
}

async function releaseLease(userId, { leaseId } = {}) {
  const key = String(userId);
  const id = String(leaseId || '').trim();
  if (isLeaseStoreConfigured()) {
    const claim = crypto.randomUUID();
    const result = await supabaseRpc('release_agent_vm_lease', {
      p_user_id: key, p_lease_id: id, p_claim_token: claim,
    });
    const row = Array.isArray(result) ? result[0] : result;
    if (row?.should_stop) {
      let success = false;
      try { await deallocateVm(key); success = true; }
      finally {
        await supabaseRpc('finish_agent_vm_stop', { p_user_id: key, p_claim_token: claim, p_success: success }).catch(() => {});
      }
    }
    const active = await leaseSnapshot(key);
    return { vmName: vmNameForUser(key), power: active.length ? 'running' : 'deallocated', leases: active };
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
      try { await deallocateVm(row.user_id); success = true; }
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

async function ensureRunning(userId) {
  await ensureVm(userId, { create: false });
  const st = await powerState(userId);
  if (st !== 'running') await startVm(userId);
  else touchActivity(userId);
  return { vmName: vmNameForUser(userId), power: 'running' };
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
      idleMinutes: cfg.idleMinutes,
      autoProvision: cfg.autoProvision,
      network: 'egress-allowlist-only',
      note: 'Dedicated Azure VM. Starts on work, deallocates after idle. Terminal/browser/code run on the VM disk.',
    };
  }
  return {
    mode: 'local',
    provider: 'local-per-user-fallback',
    vmName: null,
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
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    harness: 'gemini-azure-vm-harness',
    openaiUsed: false,
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

async function execInSandbox(userId, tool, args = {}) {
  const sb = await getSandbox(userId);
  const vmTools = new Set(['code_run', 'shell', 'browser_open', 'computer_screenshot', 'browser_session']);
  if (!vmTools.has(tool)) return { mode: sb.mode, tool, note: 'executed by existing allowlisted tool path' };
  if (sb.mode !== 'azure') {
    throw Object.assign(new Error('This tool runs only inside the user Azure VM. Configure AZURE_* to enable it.'), { code: 'DISABLED' });
  }
  await ensureRunning(userId);
  if (tool === 'code_run') {
    const out = await runCommand(userId, buildRunScript(args.language, args.code));
    return { mode: 'azure', vmName: sb.vmName, language: String(args.language || 'js'), ...out };
  }
  if (tool === 'shell') {
    const out = await runCommand(userId, buildShellScript(args.command));
    return { mode: 'azure', vmName: sb.vmName, tool: 'shell', ...out };
  }
  if (tool === 'browser_open' || tool === 'computer_screenshot') {
    return runBrowserSession(userId, sb, {
      sessionId: `oneshot_${userHash(userId).slice(0, 16)}`,
      action: 'navigate',
      url: args.url,
    });
  }
  if (tool === 'browser_session') {
    return runBrowserSession(userId, sb, args);
  }
  return { mode: 'azure', vmName: sb.vmName, tool };
}

async function provisionUserVm(userId) {
  return ensureVm(userId, { create: true });
}

export {
  azureConfig,
  isAzureConfigured,
  isLeaseStoreConfigured,
  verifySweepToken,
  missingAzureFields,
  vmNameForUser,
  userHash,
  localWorkspaceForUser,
  assertLocalPath,
  buildRunScript,
  buildShellScript,
  buildBrowserScript,
  buildBrowserSessionScript,
  getSandbox,
  statusForUser,
  execInSandbox,
  ensureInfrastructure,
  ensureVm,
  ensureRunning,
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
  LANGS,
};
