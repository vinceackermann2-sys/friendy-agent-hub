/* Lingon per-user sandbox — Azure VM (Microsoft) with secure local fallback.
   Each user gets ONE VM: lingon-sb-<sha256(userId)[0:24]>.
   Untrusted code is dispatched via Azure Run Command into a hardened worker
   container on that VM. This process never executes user code (node:vm is not
   a security boundary).
   No public SSH, no public IP, no secrets copied into the VM.
   Missing AZURE_* → isolated local workspace; code_run stays DISABLED.
*/
const crypto = require('crypto');
const { createAzureAccountErasure } = require('./azure-erasure');

const SANDBOX_ROOT = '/tmp/lingon-sandboxes';
const ARM = 'https://management.azure.com';
const COMPUTE_API = '2024-07-01';
const DISK_API = '2024-03-02';
const NET_API = '2023-09-01';
const STORAGE_API = '2023-05-01';
const BLOB_API = '2023-11-03';
const SCREEN_CONTAINER = 'browser-shots';
const STATE_CONTAINER = 'agent-state';
const LANGS = { js: 'node', javascript: 'node', node: 'node', py: 'python3', python: 'python3', sh: 'bash', bash: 'bash' };
const LEASE_TTL_MS = 90000;
function vmBillingRate() {
  const cfg = azureConfig();
  const configured = Number(process.env.AZURE_VM_BILLING_USD_PER_HOUR);
  if (!Number.isFinite(configured) || configured < 0.06) {
    if (cfg.location !== 'swedencentral' || cfg.vmSize !== 'Standard_B2als_v2') {
      throw Object.assign(new Error('Set AZURE_VM_BILLING_USD_PER_HOUR for this VM size and region.'), { code: 'VM_BILLING_RATE' });
    }
    return 0.06;
  }
  return configured;
}
async function meterVm(userId, stop = false) {
  if (!isLeaseStoreConfigured()) return 0;
  return supabaseRpc('meter_agent_vm_runtime', {
    p_user_id: String(userId), p_usd_per_hour: vmBillingRate(), p_stop: stop,
  });
}
async function requireVmTokens(userId) {
  const rows = await supabaseRpc('token_wallet_status', { p_user_id: String(userId) });
  const balance = Number((Array.isArray(rows) ? rows[0] : rows)?.remaining || 0);
  if (balance <= 0) throw Object.assign(new Error('Token allowance is used up.'), { code: 'NO_CREDIT' });
}
const DEFAULT_WORKER_IMAGE = 'localhost/lingon-worker:20260921';
const leases = new Map(); // userId -> Map(leaseId, { kind, expiresAt })
const stopping = new Map(); // userId -> Promise, prevents duplicate deallocate calls
const restoredState = new Map(); // userId -> Azure VM incarnation; replacement must restore again
const workerReadyState = new Map(); // userId -> VM incarnation whose worker image is ready
const pendingRestore = new Map(); // userId -> VM incarnation started without its restore check yet
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
    idleMinutes: Number(env('AZURE_VM_IDLE_MINUTES', '10')) || 10,
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

async function assertAccountActive(userId) {
  const cfg = supabaseLeaseConfig();
  if (!cfg.url || !cfg.key) throw Object.assign(new Error('Account cleanup status unavailable.'), {code:'SUPABASE_NOT_CONFIGURED'});
  const query = new URLSearchParams({select:'user_id',user_id:`eq.${String(userId)}`,limit:'1'});
  const response = await fetch(`${cfg.url}/rest/v1/account_deletions?${query}`, {headers:{apikey:cfg.key,Authorization:`Bearer ${cfg.key}`},signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw Object.assign(new Error('Account cleanup status unavailable.'), {code:'VM_LEASE_STORE'});
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Object.assign(new Error('Account cleanup status unavailable.'), {code:'VM_LEASE_STORE'});
  if (rows.length) throw Object.assign(new Error('Account deletion is pending.'), {code:'ACCOUNT_DELETING'});
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

function workerWorkspaceSetup(taskId) {
  return [
    'set -eu',
    `WORKDIR=${taskWorkspace(taskId)}`,
    // Open every directory without following links before touching its contents.
    // A worker can create symlinks in /workspace; privileged setup must never follow them.
    'python3 - "$WORKDIR" <<\'LINGON_WORKSPACE\'',
    'import os, pwd, sys',
    'user = pwd.getpwnam("lingon")',
    'fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)',
    'try:',
    '    for part in sys.argv[1].strip("/").split("/"):',
    '        try: os.mkdir(part, 0o700, dir_fd=fd)',
    '        except FileExistsError: pass',
    '        child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)',
    '        os.close(fd)',
    '        fd = child',
    '    os.fchown(fd, user.pw_uid, user.pw_gid)',
    'finally: os.close(fd)',
    'LINGON_WORKSPACE',
    'cd "$WORKDIR"',
  ];
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
    ...workerWorkspaceSetup(taskId),
    'command -v podman >/dev/null 2>&1 || { echo "Worker container runtime is not ready." >&2; exit 125; }',
    `podman image exists ${image} || { echo "Worker container image is not ready." >&2; exit 125; }`,
    `JOB=$(mktemp "/tmp/lingon-job.XXXXXX.${ext}")`,
    'trap \'rm -f "$JOB"\' EXIT',
    `echo '${b64}' | base64 -d > "$JOB"`,
    'chown lingon:lingon "$JOB" && chmod 600 "$JOB"',
    'set +e',
    // -k: a job that ignores TERM (podman forwards it into the container) is killed 5 s later,
    // and a container the killed client left behind is removed, so the slot is freed.
    `timeout -k 5s 20s podman run --rm --name "lingon-job-$$" --user "$(id -u lingon):$(id -g lingon)" --network=none --cap-drop=ALL --security-opt=no-new-privileges --read-only --pids-limit=128 --ulimit nofile=256:256 --ipc=private --pid=private --uts=private --memory=512m --cpus=1 --tmpfs /tmp:rw,nosuid,nodev,size=64m --volume "$WORKDIR:/workspace:rw" --volume "$JOB:/run/lingon/job.${ext}:ro" --workdir /workspace --env HOME=/home/lingon ${image} ${bin} "/run/lingon/job.${ext}"; EC=$?`,
    'podman rm -f "lingon-job-$$" >/dev/null 2>&1',
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
    ...workerWorkspaceSetup(taskId),
    'command -v podman >/dev/null 2>&1 || { echo "Worker container runtime is not ready." >&2; exit 125; }',
    `podman image exists ${image} || { echo "Worker container image is not ready." >&2; exit 125; }`,
    'JOB=$(mktemp "/tmp/lingon-cmd.XXXXXX.sh")',
    'trap \'rm -f "$JOB"\' EXIT',
    `echo '${b64}' | base64 -d > "$JOB"`,
    'chown lingon:lingon "$JOB" && chmod 600 "$JOB"',
    'set +e',
    `timeout -k 5s 30s podman run --rm --name "lingon-job-$$" --user "$(id -u lingon):$(id -g lingon)" --network=none --cap-drop=ALL --security-opt=no-new-privileges --read-only --pids-limit=128 --ulimit nofile=256:256 --ipc=private --pid=private --uts=private --memory=512m --cpus=1 --tmpfs /tmp:rw,nosuid,nodev,size=64m --volume "$WORKDIR:/workspace:rw" --volume "$JOB:/run/lingon/job.sh:ro" --workdir /workspace --env HOME=/home/lingon ${image} bash /run/lingon/job.sh`,
    'EC=$?',
    'podman rm -f "lingon-job-$$" >/dev/null 2>&1',
    'exit $EC',
  ].join('\n');
}

/*
 * Browser kit shared by both VM browser runners. It is serialized with
 * toString() into the runner, so it may only use its own body and its
 * arguments. The agent uses pages the way a person does: it reads the numbered
 * interactive elements and the screenshot, moves a visible pointer, clicks,
 * types, scrolls, selects, drags and goes back. Any public site can load;
 * private addresses are refused here and by the VM firewall for the browser
 * user. Credentials come from the user's vault (ev.secret) and their values
 * never appear in the page state returned to the model.
 */
function browserKit() {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const PRIVATE_HOST = /^(localhost|.+\.localhost|.+\.local|.+\.internal|0\.\d+\.\d+\.\d+|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|168\.63\.129\.16|\[(::1?|::ffff:.*|f[cd][0-9a-f]{2}:.*|fe[89ab][0-9a-f]:.*)\])$/i;
  const SENSITIVE = 'cc-|card.?(number|num|no)|cvc|cvv|iban|security.?code|one-time-code';
  const allowedRequest = (value) => {
    try {
      const u = new URL(value);
      if (['about:', 'data:', 'blob:'].includes(u.protocol)) return true;
      return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password
        && (!u.port || ['80', '443'].includes(u.port))
        && (u.hostname.includes('.') || u.hostname.startsWith('['))
        && !/\.(home|lan)$/i.test(u.hostname) && !PRIVATE_HOST.test(u.hostname);
    } catch { return false; }
  };
  async function settle(page, ms = 2500) {
    await Promise.race([page.waitForNetworkIdle({ idleTime: 350, timeout: ms }).catch(() => {}), sleep(ms)]);
  }
  async function setupPage(page, state) {
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      try { if (allowedRequest(request.url())) request.continue(); else request.abort('blockedbyclient'); } catch {}
    });
    // One tab: links and scripts that would open a new window load here instead.
    await page.evaluateOnNewDocument(() => {
      document.addEventListener('click', (event) => {
        const link = event.target && event.target.closest && event.target.closest('a[target]');
        if (link) link.target = '_self';
      }, true);
      window.open = (url) => { if (url) location.href = url; return null; };
    });
    // Dialogs would freeze the page; confirm-type dialogs are declined, leaving a page is allowed.
    page.on('dialog', (dialog) => {
      state.dialog = `${dialog.type()}: ${dialog.message()}`.slice(0, 300);
      (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()).catch(() => {});
    });
    const cdp = await page.target().createCDPSession();
    try {
      // Browser-wide: also covers popups and downloads from blob/data URLs.
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny', eventsEnabled: true });
    } catch (error) {
      await page.close().catch(() => {});
      throw new Error('Browser download protection could not be enabled.');
    } finally { await cdp.detach().catch(() => {}); }
  }
  async function open(page, url) {
    if (!allowedRequest(url) || !/^https?:/i.test(url)) throw new Error('Only public http and https pages can be opened.');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await settle(page);
  }
  // Where the agent points and what it is doing, so people watching the live view can follow
  // it. The app draws both over the stream; nothing is drawn into the page the agent reads.
  let pointer = {};
  let announce = () => {};
  const tell = (info) => { pointer = { ...pointer, ...info }; try { announce(pointer); } catch {} };
  const setAnnouncer = (fn) => { announce = typeof fn === 'function' ? fn : () => {}; };
  const note = (text) => tell({ text: String(text || '').slice(0, 80), pressed: false });
  async function showPointer(page, x, y, pressed) {
    tell({ x: Math.round(x), y: Math.round(y), pressed: !!pressed });
  }
  const quoted = (value) => { const t = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 40); return t ? ` “${t}”` : ''; };
  // A short description of an agent action; typed text never shows for a protected field.
  function describe(ev, at, guarded) {
    const label = at && !at.guarded ? at.label : '';
    switch (String(ev.type || '')) {
      case 'click': case 'click_text': return `Clicking${quoted(label || ev.text)}`;
      case 'double_click': return `Double-clicking${quoted(label)}`;
      case 'right_click': return `Right-clicking${quoted(label)}`;
      case 'hover': return `Pointing at${quoted(label)}`;
      case 'type': return ev.secret ? 'Filling in a saved value' : guarded || (at && at.guarded) ? 'Typing in a protected field' : `Typing${quoted(ev.text)}`;
      case 'key': return `Pressing ${String(ev.key || 'a key').slice(0, 30)}`;
      case 'scroll': return at ? `Scrolling to${quoted(label)}` : Number(ev.dy) < 0 ? 'Scrolling up' : 'Scrolling down';
      case 'select': return `Choosing${quoted(ev.value ?? ev.text)}`;
      case 'drag': return 'Dragging';
      case 'back': return 'Going back';
      case 'forward': return 'Going forward';
      case 'reload': return 'Reloading the page';
      case 'wait': return ev.text ? `Waiting for${quoted(ev.text)}` : 'Waiting for the page';
      default: return 'Working in the browser';
    }
  }
  // Numbers every visible interactive element that is not covered by another
  // element, and lists them as "[ref] role "name" @x,y" for the model.
  async function snapshot(page, state = {}) {
    const read = () => page.evaluate((sensitivePattern) => {
      const sensitive = new RegExp(sensitivePattern, 'i');
      const secretValues = [...document.querySelectorAll('[data-lingon-secret]')].map((el) => String(el.value || '')).filter(Boolean);
      const scrub = (value) => secretValues.reduce((text, secret) => text.split(secret).join('[protected]'), String(value || ''));
      const SELECTOR = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=combobox],[role=textbox],[role=searchbox],[contenteditable=""],[contenteditable=true],[onclick]';
      document.querySelectorAll('[data-lingon-ref]').forEach((el) => el.removeAttribute('data-lingon-ref'));
      const vw = innerWidth, vh = innerHeight, elements = [];
      let ref = 0, budget = 4500;
      for (const el of document.querySelectorAll(SELECTOR)) {
        if (elements.length >= 90 || budget <= 0) break;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
        const x = Math.round(Math.min(vw - 1, Math.max(0, r.left + r.width / 2))), y = Math.round(Math.min(vh - 1, Math.max(0, r.top + r.height / 2)));
        const top = document.elementFromPoint(x, y);
        const coveringLabel = top && top.closest && top.closest('label');
        if (top && top !== el && !el.contains(top) && !top.contains(el) && !(coveringLabel && coveringLabel.control === el)) continue;
        el.setAttribute('data-lingon-ref', String(++ref));
        const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase();
        const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? `input:${type || 'text'}` : tag);
        // A label can wrap its control; only the label's own words name it.
        const label = el.labels && el.labels[0] ? el.labels[0].cloneNode(true) : null;
        if (label) label.querySelectorAll('select,input,textarea,button').forEach((node) => node.remove());
        const name = scrub((el.getAttribute('aria-label') || (label && label.textContent.trim()) || (tag === 'select' ? el.name : el.innerText) || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || (type === 'submit' || type === 'button' ? el.value : '') || '').trim().replace(/\s+/g, ' ')).slice(0, 70);
        const guarded = type === 'password' || sensitive.test(`${el.getAttribute('autocomplete') || ''} ${el.name || ''} ${el.id || ''}`);
        let line = `[${ref}] ${role} "${name}"`;
        // Values of password, payment and vault-filled fields never reach the model.
        if (el.hasAttribute('data-lingon-secret')) line += ' (filled from the vault)';
        else if (guarded) line += el.value ? ' (password/payment field, filled)' : ' (password/payment field)';
        else if (['input', 'textarea', 'select'].includes(tag) && el.value && !['submit', 'button'].includes(type)) line += ` = "${String(tag === 'select' && el.selectedOptions[0] ? el.selectedOptions[0].text : el.value).slice(0, 50)}"`;
        if (el.checked) line += ' checked';
        if (el.disabled) line += ' disabled';
        line += ` @${x},${y}`;
        elements.push(line);
        budget -= line.length;
      }
      const links = [...document.querySelectorAll('a[href]')].slice(0, 5).map((a) => ({ t: scrub((a.innerText || '').trim().slice(0, 60)), h: scrub(a.href.slice(0, 160)) }));
      const sensitivePresent = [...document.querySelectorAll('input,textarea')].some((el) =>
        el.hasAttribute('data-lingon-secret') || ((el.type === 'password' || sensitive.test(`${el.autocomplete || ''} ${el.name || ''} ${el.id || ''}`)) && !!el.value));
      return { elements, links, scrollY: Math.round(scrollY), pageHeight: document.documentElement.scrollHeight, text: document.body ? scrub(document.body.innerText.slice(0, 3000)) : '', sensitivePresent };
    }, SENSITIVE);
    // A page that is still navigating has no document yet; try once more.
    const data = await read().catch(() => sleep(700).then(read)).catch(() => ({ elements: [], links: [], text: '', scrollY: 0, pageHeight: 0, sensitivePresent: true }));
    const out = { url: page.url(), title: await page.title().catch(() => ''), ...data };
    if (state.dialog) { out.dialog = state.dialog; state.dialog = ''; }
    return out;
  }
  async function locate(page, ev) {
    if (ev.ref != null && ev.ref !== '') {
      const found = await page.evaluate((ref, sensitivePattern) => {
        const el = document.querySelector(`[data-lingon-ref="${ref}"]`);
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        const guarded = el.type === 'password' || new RegExp(sensitivePattern, 'i').test(`${el.getAttribute('autocomplete') || ''} ${el.name || ''} ${el.id || ''}`);
        const label = guarded ? '' : (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '').trim().slice(0, 60);
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, guarded, label, select: el.tagName === 'SELECT' };
      }, Number(ev.ref), SENSITIVE);
      if (!found) throw new Error(`Element [${ev.ref}] is no longer on the page. Use a ref from the latest page state.`);
      return found;
    }
    if (Number.isFinite(ev.x) && Number.isFinite(ev.y)) return { x: ev.x, y: ev.y };
    if (ev.text) {
      const found = await page.evaluate((text) => {
        const want = String(text).trim().toLowerCase();
        const nodes = [...document.querySelectorAll('a,button,[role=button],[role=link],[role=tab],[role=menuitem],input[type=submit],input[type=button],summary,label')];
        const label = (node) => (node.innerText || node.value || node.getAttribute('aria-label') || '').trim().toLowerCase();
        const el = nodes.find((node) => label(node) === want) || nodes.find((node) => label(node).includes(want));
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 60) };
      }, String(ev.text));
      if (!found) throw new Error('No visible link or button has that text.');
      return found;
    }
    return null;
  }
  async function pressKeys(page, combo) {
    const alias = { ctrl: 'Control', control: 'Control', cmd: 'Meta', meta: 'Meta', shift: 'Shift', alt: 'Alt', option: 'Alt' };
    const parts = String(combo || 'Escape').split('+').map((part) => part.trim()).filter(Boolean);
    const key = parts.pop() || 'Escape';
    const modifiers = parts.map((part) => alias[part.toLowerCase()] || part);
    for (const modifier of modifiers) await page.keyboard.down(modifier);
    try { await page.keyboard.press(key); } finally { for (const modifier of modifiers.reverse()) await page.keyboard.up(modifier); }
  }
  // Runs one input event. Agent events (ev.agent) move the pointer visibly and
  // pause like a person; the user's own events from the live view stay instant.
  async function act(page, ev) {
    const type = String(ev.type || '');
    const agent = ev.agent === true;
    const moveTo = async (x, y) => {
      await page.mouse.move(x, y, agent ? { steps: 12 } : undefined);
      if (agent) await showPointer(page, x, y);
    };
    const need = async () => {
      const at = await locate(page, ev);
      if (!at) throw new Error('Give a ref, x and y, or text for this action.');
      if (agent) tell({ text: describe(ev, at), x: Math.round(at.x), y: Math.round(at.y), pressed: false });
      return at;
    };
    // An action without a place on the page says what it does up front (a quick check does not).
    const placed = ['click', 'double_click', 'right_click', 'click_text', 'hover', 'select', 'drag'].includes(type)
      || (['type', 'scroll'].includes(type) && ((ev.ref != null && ev.ref !== '') || Number.isFinite(ev.x)));
    if (agent && !placed && !(type === 'wait' && !ev.text && (Number(ev.ms) || 1000) < 300)) {
      const guarded = type === 'type' && !ev.secret ? await page.evaluate((pattern) => {
        const el = document.activeElement;
        return !!el && (el.type === 'password' || new RegExp(pattern, 'i').test(`${el.getAttribute('autocomplete') || ''} ${el.name || ''} ${el.id || ''}`));
      }, SENSITIVE).catch(() => true) : false;
      note(describe(ev, null, guarded));
    }
    if (type === 'move') { await page.mouse.move(Number(ev.x) || 0, Number(ev.y) || 0); return; }
    if (['click', 'double_click', 'right_click', 'click_text'].includes(type)) {
      const at = await need();
      await moveTo(at.x, at.y);
      if (agent) await showPointer(page, at.x, at.y, true);
      await page.mouse.click(at.x, at.y, { button: type === 'right_click' || ev.button === 2 ? 'right' : 'left', clickCount: type === 'double_click' ? 2 : 1, delay: agent ? 60 : 0 });
      if (agent) await showPointer(page, at.x, at.y, false);
    } else if (type === 'hover') {
      const at = await need();
      await moveTo(at.x, at.y);
    } else if (type === 'type') {
      const text = String(ev.text || '').slice(0, 1000);
      if ((ev.ref != null && ev.ref !== '') || Number.isFinite(ev.x)) {
        const at = await need();
        await moveTo(at.x, at.y);
        await page.mouse.click(at.x, at.y, { delay: agent ? 40 : 0 });
      }
      if (ev.clear) { await pressKeys(page, 'Control+A'); await page.keyboard.press('Backspace'); }
      await page.keyboard.type(text, { delay: agent ? 30 : 0 });
      // A vault value is marked so the page state never shows it to the model.
      if (ev.secret) await page.evaluate(() => { if (document.activeElement) document.activeElement.setAttribute('data-lingon-secret', '1'); }).catch(() => {});
      if (ev.submit) await page.keyboard.press('Enter');
    } else if (type === 'key') {
      await pressKeys(page, ev.key);
    } else if (type === 'scroll') {
      if (ev.ref != null && ev.ref !== '') await need();
      else await page.mouse.wheel({ deltaX: Number(ev.dx) || 0, deltaY: Number.isFinite(ev.dy) ? ev.dy : 600 });
    } else if (type === 'select') {
      const at = await need();
      if (!at.select) throw new Error('select needs the ref of a dropdown.');
      const picked = await page.evaluate((ref, want) => {
        const el = document.querySelector(`[data-lingon-ref="${ref}"]`);
        const w = String(want).trim().toLowerCase();
        const options = [...el.options];
        const option = options.find((o) => o.value === want) || options.find((o) => o.text.trim().toLowerCase() === w) || options.find((o) => o.text.toLowerCase().includes(w));
        if (!option) return null;
        el.value = option.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return option.text.trim();
      }, Number(ev.ref), String(ev.value ?? ev.text ?? ''));
      if (picked == null) throw new Error('No option in that dropdown matches.');
    } else if (type === 'drag') {
      const from = await need();
      const to = await locate(page, { ref: ev.to_ref, x: ev.to_x, y: ev.to_y });
      if (!to) throw new Error('drag needs to_ref, or to_x and to_y.');
      await moveTo(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 20 });
      if (agent) await showPointer(page, to.x, to.y);
      await page.mouse.up();
    } else if (type === 'back') {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
    } else if (type === 'forward') {
      await page.goForward({ waitUntil: 'domcontentloaded', timeout: 15000 });
    } else if (type === 'reload') {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    } else if (type === 'wait') {
      if (ev.text) {
        await page.waitForFunction((t) => !!document.body && document.body.innerText.includes(t), { timeout: 10000 }, String(ev.text))
          .catch(() => { throw new Error(`"${String(ev.text).slice(0, 80)}" did not appear within 10 seconds.`); });
      } else await sleep(Math.min(10000, Math.max(0, Number(ev.ms) || 1000)));
    } else {
      throw new Error('Unsupported browser action.');
    }
    if (agent) await settle(page, type === 'wait' ? 500 : 2500);
    else await sleep(35);
  }
  return { allowedRequest, setupPage, open, snapshot, act, settle, setAnnouncer, note };
}

// Shell lines, run as root before a browser or desktop starts: the given user
// may reach the public internet and loopback only, never private networks, the
// Azure platform endpoint or instance metadata. Without a firewall nothing starts.
function networkGuard(user) {
  if (!['lingon-browser', 'lingon-desktop'].includes(user)) throw new Error('Invalid network guard user.');
  return [
    // An older release blocked the desktop account entirely; its guarded container replaces that.
    ...(user === 'lingon-desktop' ? ['while iptables -D OUTPUT -m owner --uid-owner lingon-desktop -j REJECT 2>/dev/null; do :; done'] : []),
    // A print service (from the Chromium snap on older VMs) listens on every address; nothing uses it.
    "if ss -ltn 2>/dev/null | grep -q ':631 '; then snap stop --disable cups >/dev/null 2>&1 || true; systemctl disable --now cups.service cups.socket cups-browsed.service >/dev/null 2>&1 || true; fi",
    "command -v iptables >/dev/null 2>&1 || { echo 'iptables is required for the network guard' >&2; exit 1; }",
    // Install denies before allows. Every failure stops the browser launch.
    `for NET in 0.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 168.63.129.16/32 192.0.0.0/24 192.0.2.0/24 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do iptables -C OUTPUT -m owner --uid-owner ${user} -d "$NET" -j REJECT 2>/dev/null || iptables -I OUTPUT -m owner --uid-owner ${user} -d "$NET" -j REJECT || exit 1; done`,
    // IPv6 is denied entirely rather than leaving mapped/translated addresses open.
    "command -v ip6tables >/dev/null 2>&1 || { echo 'ip6tables is required for the network guard' >&2; exit 1; }",
    `ip6tables -C OUTPUT -m owner --uid-owner ${user} -j REJECT 2>/dev/null || ip6tables -I OUTPUT -m owner --uid-owner ${user} -j REJECT || exit 1`,
    `iptables -C OUTPUT ! -o lo -m owner --uid-owner ${user} ! -p tcp -j REJECT 2>/dev/null || iptables -I OUTPUT ! -o lo -m owner --uid-owner ${user} ! -p tcp -j REJECT || exit 1`,
    `iptables -C OUTPUT ! -o lo -m owner --uid-owner ${user} -p tcp -m multiport ! --dports 80,443 -j REJECT 2>/dev/null || iptables -I OUTPUT ! -o lo -m owner --uid-owner ${user} -p tcp -m multiport ! --dports 80,443 -j REJECT || exit 1`,
    // Only the browser owner may connect to its local debugging service.
    "iptables -C OUTPUT -o lo -p tcp -m owner ! --uid-owner lingon-browser -j REJECT 2>/dev/null || iptables -I OUTPUT -o lo -p tcp -m owner ! --uid-owner lingon-browser -j REJECT || exit 1",
    // The desktop runs only inside its container: a native desktop left by an older release ends.
    // (Container processes run as subordinate ids, so these never match them.)
    "if id -u lingon-desktop >/dev/null 2>&1; then pkill -KILL -u lingon-desktop -f '/home/lingon-desktop/.relay/' 2>/dev/null || true; pkill -KILL -u lingon-desktop -x 'Xvfb|openbox|pcmanfm|mousepad|chromium|ffmpeg|xdotool' 2>/dev/null || true; fi",
  ];
}
const BROWSER_NETWORK_GUARD = networkGuard('lingon-browser');
// Azure's command runner ends every process a command started shortly after the command
// finishes. The browser, the live streamer and the relays keep running between steps, so
// they start in their own systemd scope, outside the runner's cleanup.
const OWN_SCOPE = 'SCOPE=""; command -v systemd-run >/dev/null 2>&1 && SCOPE="systemd-run --scope --quiet --collect --"';
// Snap Chromium refuses to start from a service's cgroup, which is where Azure Run Command
// runs ("... is not a snap cgroup"), so browser steps use Chrome's standalone headless
// build instead: installed once per VM into /opt/lingon/chrome with the libraries it needs.
const CHROME_LIBS = 'libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 fonts-liberation';
const BROWSER_INSTALL = [
  // A VM whose first boot did not finish gets Node and the browser library here too.
  'command -v node >/dev/null 2>&1 || { export DEBIAN_FRONTEND=noninteractive; (curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y -q nodejs) >/dev/null 2>&1; }',
  '[ -d /opt/lingon/node_modules/puppeteer-core ] || { mkdir -p /opt/lingon && npm install --prefix /opt/lingon puppeteer-core@25.11.0 ws@8.21.3 >/dev/null 2>&1; } || true',
  'if [ ! -x /opt/lingon/chrome/chrome-headless-shell ]; then',
  '  export DEBIAN_FRONTEND=noninteractive',
  `  apt-get install -y -q ${CHROME_LIBS} >/dev/null 2>&1 || { apt-get update -q >/dev/null 2>&1; for P in ${CHROME_LIBS} libasound2t64; do apt-get install -y -q "$P" >/dev/null 2>&1 || true; done; }`,
  '  mkdir -p /opt/lingon/browsers /opt/lingon/chrome',
  '  (cd /opt/lingon && npx -y @puppeteer/browsers@2 install chrome-headless-shell@stable --path /opt/lingon/browsers) >/tmp/lingon-chrome-install.log 2>&1 || true',
  '  BIN=$(find /opt/lingon/browsers -type f -name chrome-headless-shell -perm -u+x 2>/dev/null | head -n1)',
  '  if [ -n "$BIN" ]; then chmod -R a+rX /opt/lingon/browsers && ln -sf "$BIN" /opt/lingon/chrome/chrome-headless-shell; fi',
  'fi',
];

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

// One Chromium profile belongs to this user's VM, while each live run keeps
// its own tab and page-state file. Chrome stores website sessions in the
// profile; passwords remain in the encrypted server vault and its password
// manager stays disabled by policy. This function is serialized into both VM
// browser runners, so it must not depend on module-scope imports.
// Serialized to the VM with toString(): Node's require arrives as `load`, because a bundler
// rewrites calls to the global require inside this module (to __require, absent on the VM).
function browserProfileRuntime(root, load) {
  const proc = load('process');
  const fs = load('fs');
  const path = load('path');
  const profile = path.join(root, 'profile');
  const portFile = path.join(profile, 'debug-port');
  const pidFile = path.join(profile, 'browser-pid');
  const cookieFile = path.join(profile, 'lingon-session-cookies.json');
  const launchLock = path.join(root, 'profile-launch.lock');
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const freePort = () => new Promise((resolve, reject) => {
    const server = load('net').createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
  const connect = async (puppeteer) => {
    const port = Number(fs.existsSync(portFile) ? fs.readFileSync(portFile, 'utf8') : 0);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    try {
      const url = `http://127.0.0.1:${port}`;
      const probe = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (!probe.ok) return null;
      const browser = await puppeteer.connect({ browserURL: url });
      try { await protectBrowser(browser); return browser; }
      catch (error) { await browser.disconnect(); throw error; }
    } catch { return null; }
  };
  const protectBrowser = async (browser) => {
    const client = await browser.target().createCDPSession();
    try {
      const { arguments: flags } = await client.send('Browser.getBrowserCommandLine');
      if (!Array.isArray(flags) || flags.some((flag) => /^--(?:no-sandbox|disable-(?:setuid-sandbox|seccomp-filter-sandbox|namespace-sandbox|web-security))(?:=|$)/.test(flag))) {
        throw new Error('Browser sandbox protection is required.');
      }
      await client.send('Browser.setDownloadBehavior', { behavior: 'deny', eventsEnabled: true });
    } finally { await client.detach().catch(() => {}); }
  };
  const cookieClient = async (browser) => {
    const page = (await browser.pages())[0] || await browser.newPage();
    return page.target().createCDPSession();
  };
  const saveCookies = async (browser) => {
    const client = await cookieClient(browser);
    try {
      const { cookies } = await client.send('Storage.getCookies');
      const temporary = `${cookieFile}.${proc.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(cookies || []), { mode: 0o600 });
      fs.renameSync(temporary, cookieFile);
    } finally { await client.detach().catch(() => {}); }
  };
  const restoreCookies = async (browser) => {
    if (!fs.existsSync(cookieFile)) return;
    let saved;
    try { saved = JSON.parse(fs.readFileSync(cookieFile, 'utf8')); } catch { return; }
    if (!Array.isArray(saved) || !saved.length) return;
    const cookies = saved.filter((item) => item && item.name && item.domain && item.value != null).map((item) => {
      const cookie = { name:item.name, value:item.value, path:item.path || '/', secure:!!item.secure, httpOnly:!!item.httpOnly };
      if (item.domain.startsWith('.')) cookie.domain = item.domain;
      else cookie.url = `${item.secure ? 'https' : 'http'}://${item.domain}${cookie.path}`;
      if (Number(item.expires) > 0) cookie.expires = Number(item.expires);
      if (item.sameSite) cookie.sameSite = item.sameSite;
      if (item.priority) cookie.priority = item.priority;
      if (item.partitionKey) cookie.partitionKey = item.partitionKey;
      return cookie;
    });
    if (!cookies.length) return;
    const client = await cookieClient(browser);
    try {
      try { await client.send('Storage.setCookies', { cookies }); }
      catch { for (const cookie of cookies) await client.send('Storage.setCookies', { cookies:[cookie] }).catch(() => {}); }
    }
    finally { await client.detach().catch(() => {}); }
  };
  const connectOrLaunch = async (puppeteer, executablePath) => {
    fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
    fs.chmodSync(profile, 0o700);
    let browser = await connect(puppeteer);
    if (browser) return browser;
    let locked = false;
    try { fs.mkdirSync(launchLock, { mode: 0o700 }); locked = true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (!locked) {
      try {
        if (Date.now() - fs.statSync(launchLock).mtimeMs > 30000) {
          fs.rmdirSync(launchLock);
          return connectOrLaunch(puppeteer, executablePath);
        }
      } catch {}
      for (let i = 0; i < 100; i++) {
        await sleep(200);
        browser = await connect(puppeteer);
        if (browser) return browser;
      }
      try {
        if (Date.now() - fs.statSync(launchLock).mtimeMs > 30000) {
          fs.rmdirSync(launchLock);
          return connectOrLaunch(puppeteer, executablePath);
        }
      } catch {}
      throw new Error('The browser profile is starting. Try again shortly.');
    }
    try {
      browser = await connect(puppeteer);
      if (browser) return browser;
      // A browser that no longer answers still holds the profile, so a new one could not start.
      const stale = Number(fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8') : 0);
      const ours = (pid) => { try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(profile); } catch { return proc.platform !== 'linux'; } };
      if (stale > 0 && ours(stale)) {
        try { proc.kill(-stale, 'SIGKILL'); } catch { try { proc.kill(stale, 'SIGKILL'); } catch {} }
        await sleep(1000);
      }
      const port = await freePort();
      // Chrome runs on its own, not as a child of this step: puppeteer.launch holds its pipes
      // (the step's process never ends, and the VM runs one command at a time) and kills it
      // when the step ends. Chrome's standalone headless build runs in "shell" mode.
      const url = `http://127.0.0.1:${port}`;
      const args = await puppeteer.defaultArgs({ browser: 'chrome', headless: /headless-shell/.test(executablePath) ? 'shell' : true, userDataDir: profile,
        args: ['--disable-dev-shm-usage', '--window-size=1280,900', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port] });
      const logFile = path.join(root, 'chrome.log');
      const start = async (extra) => {
        const log = fs.openSync(logFile, 'w', 0o600);
        const child = load('child_process').spawn(executablePath, [...extra, ...args], { detached: true, stdio: ['ignore', log, log], windowsHide: true });
        fs.closeSync(log);
        let exited = false;
        child.once('exit', () => { exited = true; });
        child.once('error', () => { exited = true; });
        child.unref();
        for (let i = 0; i < 150 && !exited; i++) {
          try { if ((await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(1000) })).ok) { fs.writeFileSync(pidFile, String(child.pid), { mode: 0o600 }); return true; } } catch {}
          await sleep(100);
        }
        try { proc.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
        return false;
      };
      // A missing kernel sandbox is a hard failure, never a reason to remove it.
      const tail = () => { try { return fs.readFileSync(logFile, 'utf8').slice(-400).trim(); } catch { return ''; } };
      if (!(await start([]))) {
        throw new Error(`Failed to launch the browser process. ${tail()}`.trim());
      }
      fs.writeFileSync(portFile, String(port), { mode: 0o600 });
      browser = await puppeteer.connect({ browserURL: url });
      try { await protectBrowser(browser); }
      catch (error) { await browser.close().catch(() => {}); throw error; }
      await restoreCookies(browser).catch(() => {});
      return browser;
    } finally { try { fs.rmdirSync(launchLock); } catch {} }
  };
  const session = async (browser, sessionId) => {
    const dir = path.join(root, sessionId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const targetFile = path.join(dir, 'target-id');
    const targetId = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8').trim() : '';
    let page = targetId ? (await browser.pages()).find((item) => item.target()._targetId === targetId) : null;
    const reusedPage = !!page;
    if (!page) page = await browser.newPage();
    fs.writeFileSync(targetFile, page.target()._targetId, { mode: 0o600 });
    return { page, reusedPage, stateFile: path.join(dir, 'state.json'), targetFile };
  };
  return { profile, pidFile, connectOrLaunch, connectExisting: connect, session, saveCookies };
}

/*
 * Live view over Supabase Realtime, for hosts without the WebSocket relay (the
 * Lovable-hosted app). A small streamer on the VM attaches to the session's page
 * in the running Chromium and joins one Realtime broadcast channel whose name is
 * an unguessable per-session secret. While a viewer is watching (it says so every
 * few seconds) the streamer sends screencast frames, only when the screen changes;
 * nobody watching means no frames. When the owner takes over, their mouse and
 * keyboard input is applied through the same browser kit the agent uses, and a
 * takeover file makes the agent's next browser step wait. The VM still accepts no
 * inbound connections: it dials out to Realtime, like the relay dials the app.
 */
const LIVE_REALTIME_URL = /^wss:\/\/[a-z0-9-]+\.supabase\.(co|in)\/realtime\/v1\/websocket$/;
const LIVE_TOPIC = /^live-[A-Za-z0-9_-]{32,64}$/;
function liveRealtimeArgs(live) {
  if (!live) return null;
  const url = String(live.url || ''), key = String(live.key || ''), topic = String(live.topic || ''), cmdKey = String(live.cmdKey || '');
  if (!LIVE_REALTIME_URL.test(url) || !/^[A-Za-z0-9._-]{20,400}$/.test(key) || !LIVE_TOPIC.test(topic) || (cmdKey && !/^[a-f0-9]{64}$/.test(cmdKey))) {
    throw Object.assign(new Error('Invalid live view channel.'), { code: 'BAD_INPUT' });
  }
  return cmdKey ? { url, key, topic, cmdKey } : { url, key, topic };
}
// The streamer build a VM runs. A streamer from another build, or holding another step key,
// is replaced at the next browser step: it would ignore signed steps, and each would wait for it.
const LIVE_STREAMER_BUILD = 'steps-2';
const liveStreamerVersion = (live) => `${LIVE_STREAMER_BUILD}-${crypto.createHash('sha256').update(String(live.cmdKey || '')).digest('hex').slice(0, 12)}`;
function liveStreamer(kit, profileRuntime, cfg, load) {
  const proc = load('process');
  const fs = load('fs');
  const path = load('path');
  const vmModules = '/opt/lingon/node_modules/';
  const loadVmModule = (name) => load(vmModules + name);
  const WebSocket = loadVmModule('ws');
  const puppeteer = loadVmModule('puppeteer-core');
  const dir = path.join(cfg.root || '/var/lib/lingon-browser/sessions', cfg.sessionId);
  const takeoverFile = path.join(dir, 'takeover');
  const topic = `realtime:${cfg.topic}`;
  // A viewer says it is watching every 10 s; frames stop 30 s after the last one,
  // and the streamer exits after 20 idle minutes (the next browser step restarts it).
  const VIEWER_MS = 30000, IDLE_EXIT_MS = 20 * 60000, MAX_FRAME = 240000, FRAME_GAP_MS = 120;
  let ws = null, joined = false, ref = 1, lastViewer = 0, lastActivity = Date.now();
  let page = null, cdp = null, streaming = false, quality = 60, pending = null, lastSent = 0, flushTimer = null, takeover = false;
  const send = (event, payload) => {
    if (!ws || ws.readyState !== 1 || !joined) return false;
    ws.send(JSON.stringify({ topic, event: 'broadcast', payload: { type: 'broadcast', event, payload }, ref: String(++ref), join_ref: '1' }));
    return true;
  };
  const meta = async () => send('state', { url: page ? page.url() : '', title: page ? await page.title().catch(() => '') : '', state: takeover ? 'user' : 'idle', transport: 'realtime' });
  const flush = () => { flushTimer = null; if (pending && send('frame', { d: pending })) lastSent = Date.now(); pending = null; };
  const startCast = async () => {
    if (streaming || !cdp) return;
    streaming = true;
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth: 1280, maxHeight: 900, everyNthFrame: 1 }).catch(() => { streaming = false; });
  };
  const stopCast = async () => { if (!streaming || !cdp) return; streaming = false; await cdp.send('Page.stopScreencast').catch(() => {}); };
  const setTakeover = (on) => {
    takeover = !!on;
    if (takeover) fs.writeFileSync(takeoverFile, String(Date.now()), { mode: 0o600 }); else fs.rmSync(takeoverFile, { force: true });
  };
  // The agent's pointer and current action, written by each browser step, go to viewers as
  // they change; a viewer who joins gets the latest.
  const agentFile = path.join(dir, 'agent.json');
  let agentSeen = 0, agentNow = null;
  setInterval(() => {
    try {
      const changed = fs.statSync(agentFile).mtimeMs;
      if (changed === agentSeen) return;
      agentSeen = changed;
      agentNow = JSON.parse(fs.readFileSync(agentFile, 'utf8'));
      lastActivity = Date.now();
      if (Date.now() - lastViewer < VIEWER_MS) send('agent', agentNow);
    } catch {}
  }, 150).unref?.();
  // Agent browser steps sent over the channel run here, in the browser this streamer already
  // holds, instead of a new VM command per step (many seconds each). A step counts only when it
  // is signed with the key the server gave this streamer at launch, has not expired and was not
  // seen before. Its result goes to a private upload link in the step, never to the channel; a
  // vault value never comes this way.
  const crypto = load('crypto');
  const BLOB = /^https:\/\/[a-z0-9]{3,24}\.blob\.core\.windows\.net\//;
  const stateFile = path.join(dir, 'state.json');
  const seenSteps = new Map();
  let stepQueue = Promise.resolve(), agentState = null, browserRef = null;
  // Keys sorted: the channel does not keep an object's key order (see signStep).
  const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v === undefined ? null : v));
  const stepSignature = (p) => crypto.createHmac('sha256', String(cfg.cmdKey)).update(canon([p.id, p.action, p.url || '', p.event || null, p.uploadUrl, p.resultUrl, p.exp])).digest('hex');
  const validStep = (p) => {
    if (!cfg.cmdKey || !p || typeof p.id !== 'string' || p.id.length > 80 || seenSteps.has(p.id)) return false;
    if (!(Number(p.exp) > Date.now()) || Number(p.exp) > Date.now() + 5 * 60000) return false;
    if (!['navigate', 'input', 'inspect'].includes(p.action) || (p.event && p.event.secret)) return false;
    if (!BLOB.test(String(p.uploadUrl || '')) || !BLOB.test(String(p.resultUrl || ''))) return false;
    const expected = Buffer.from(stepSignature(p)), given = Buffer.from(String(p.sig || ''));
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  };
  const runStep = (p) => {
    seenSteps.set(p.id, Date.now());
    for (const [id, at] of seenSteps) if (Date.now() - at > 10 * 60000) seenSteps.delete(id);
    lastActivity = Date.now();
    const report = (body, first) => fetch(p.resultUrl, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-ms-blob-type': 'BlockBlob', ...(first ? { 'If-None-Match': '*' } : {}) }, body: JSON.stringify(body) });
    // Taking the step creates its result blob. The server, giving up waiting, tries to create
    // the same blob; whoever creates it first owns the step, so it never runs twice.
    const taken = report({ ack: true }, true).then((r) => r.status === 201).catch(() => false);
    stepQueue = stepQueue.then(async () => {
      if (!(await taken)) return;
      let result;
      kit.setAnnouncer((info) => { agentNow = { ...info, at: Date.now() }; if (Date.now() - lastViewer < VIEWER_MS) send('agent', agentNow); });
      try {
        if (takeover) throw new Error('The owner has taken over this browser in the live view. Wait until they hand it back, then continue.');
        if (!page) throw new Error('The session page is gone.');
        if (!agentState) { agentState = {}; await kit.setupPage(page, agentState); }
        if (p.action === 'navigate') { const host = new URL(p.url).hostname; kit.note('Opening ' + (host.startsWith('www.') ? host.slice(4) : host)); await kit.open(page, p.url); }
        else if (p.action === 'input') await kit.act(page, p.event || {});
        const snap = await kit.snapshot(page, agentState);
        kit.note('Looking at the page');
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 });
        const upload = await fetch(p.uploadUrl, { method: 'PUT', headers: { 'content-type': 'image/jpeg', 'x-ms-blob-type': 'BlockBlob' }, body: screenshot });
        if (!upload.ok) throw new Error('Screenshot upload failed: HTTP ' + upload.status);
        fs.writeFileSync(stateFile, JSON.stringify({ url: snap.url, title: snap.title, scrollY: snap.scrollY }));
        if (browserRef) await profileRuntime.saveCookies(browserRef).catch(() => {});
        result = { ok: true, ...snap, screenshotBytes: screenshot.length };
      } catch (error) { result = { ok: false, error: String(error.message || error) }; }
      finally { kit.setAnnouncer(null); }
      await report({ done: true, ...result }).catch(() => {});
      lastActivity = Date.now();
      meta();
    });
  };
  const onBroadcast = (event, p) => {
    lastActivity = Date.now();
    if (event === 'step') { if (validStep(p)) runStep(p); return; }
    if (event === 'watch') { lastViewer = Date.now(); startCast(); meta(); if (agentNow) send('agent', agentNow); }
    else if (event === 'control') { setTakeover(p.takeover === true); meta(); }
    else if (event === 'input' && takeover && p.ev && typeof p.ev === 'object') {
      const ev = { ...p.ev, agent: false };
      if (['move', 'click', 'double_click', 'right_click', 'scroll', 'type', 'key', 'back', 'forward', 'reload'].includes(String(ev.type))) kit.act(page, ev).then(() => (ev.type === 'move' ? null : meta())).catch(() => {});
    }
  };
  const connect = () => {
    ws = new WebSocket(`${cfg.url}?apikey=${encodeURIComponent(cfg.key)}&vsn=1.0.0`);
    ws.on('open', () => ws.send(JSON.stringify({ topic, event: 'phx_join', payload: { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, private: false } }, ref: '1', join_ref: '1' })));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.event === 'phx_reply' && m.ref === '1') { joined = m.payload && m.payload.status === 'ok'; if (joined) meta(); }
      else if (m.event === 'broadcast' && m.payload) onBroadcast(m.payload.event, m.payload.payload || {});
    });
    ws.on('close', () => { joined = false; setTimeout(connect, 2000); });
    ws.on('error', () => {});
  };
  setInterval(() => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }));
    if (streaming && Date.now() - lastViewer > VIEWER_MS) stopCast();
    // An owner who left without handing back still hands back: the agent must not wait forever.
    if (takeover && Date.now() - lastViewer > VIEWER_MS) setTakeover(false);
    else if (takeover) fs.writeFileSync(takeoverFile, String(Date.now()), { mode: 0o600 });
    if (Date.now() - Math.max(lastViewer, lastActivity) > IDLE_EXIT_MS) { fs.rmSync(takeoverFile, { force: true }); proc.exit(0); }
  }, 10000).unref?.();
  (async () => {
    const browser = await profileRuntime.connectExisting(puppeteer);
    if (!browser) throw new Error('The browser is not running.');
    browserRef = browser;
    const targetId = fs.readFileSync(path.join(dir, 'target-id'), 'utf8').trim();
    page = (await browser.pages()).find((item) => item.target()._targetId === targetId);
    if (!page) throw new Error('The session page is gone.');
    cdp = await page.target().createCDPSession();
    await cdp.send('Page.enable');
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      // An oversized frame lowers the quality instead of being dropped repeatedly.
      if (data.length > MAX_FRAME) { if (quality > 30) { quality -= 15; stopCast().then(startCast); } return; }
      pending = data;
      const wait = FRAME_GAP_MS - (Date.now() - lastSent);
      if (wait <= 0) flush(); else if (!flushTimer) flushTimer = setTimeout(flush, wait);
    });
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) meta(); });
    page.on('close', () => proc.exit(0));
    browser.on('disconnected', () => proc.exit(0));
    connect();
  })().catch((error) => { proc.stderr.write(String(error.message || error)); proc.exit(1); });
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
  if (payload.url && !/^https?:\/\//i.test(payload.url)) {
    throw Object.assign(new Error('An http or https URL is required.'), { code: 'BAD_INPUT' });
  }
  if (!/^https:\/\/[a-z0-9]{3,24}\.blob\.core\.windows\.net\//.test(payload.uploadUrl)) {
    throw Object.assign(new Error('Valid Azure Blob upload URL required.'), { code: 'BAD_INPUT' });
  }
  // A vault value never travels in the Run Command script, which the VM agent
  // keeps on disk. The script only gets a short-lived link to a one-time blob.
  if (payload.event && payload.event.secret
    && (payload.event.text || !/^https:\/\/[a-z0-9]{3,24}\.blob\.core\.windows\.net\//.test(String(payload.event.secretUrl || '')))) {
    throw Object.assign(new Error('A vault value must be handed over by one-time blob.'), { code: 'BAD_INPUT' });
  }
  const live = liveRealtimeArgs(args.live);
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const runner = [
    "const fs = require('fs');",
    "const path = require('path');",
    `const kit = (${browserKit.toString()})();`,
    `const profileRuntime = (${browserProfileRuntime.toString()})('/var/lib/lingon-browser/sessions', require);`,
    "const payload = JSON.parse(Buffer.from(process.env.LINGON_BROWSER_PAYLOAD, 'base64').toString('utf8'));",
    // While the owner drives the live view, the agent's browser steps wait. The streamer
    // refreshes the file every 10 s, so a stale file (streamer gone) no longer blocks.
    "const takeoverFile = path.join('/var/lib/lingon-browser/sessions', payload.sessionId, 'takeover');",
    // What the agent does goes to a file the live streamer shows to people watching.
    "const agentFile = path.join('/var/lib/lingon-browser/sessions', payload.sessionId, 'agent.json');",
    "kit.setAnnouncer((info) => { try { fs.writeFileSync(agentFile + '.tmp', JSON.stringify({ ...info, at: Date.now() }), { mode: 0o600 }); fs.renameSync(agentFile + '.tmp', agentFile); } catch {} });",
    "try { if (Date.now() - fs.statSync(takeoverFile).mtimeMs < 45000) { process.stdout.write(JSON.stringify({ ok: false, error: 'The owner has taken over this browser in the live view. Wait until they hand it back, then continue.' })); process.exit(1); } } catch {}",
    "const findBrowser = () => ['/opt/lingon/chrome/chrome-headless-shell', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'].find((p) => fs.existsSync(p));",
    "const executablePath = findBrowser();",
    "if (!executablePath) throw new Error('Chromium is not installed yet (first boot is still running).');",
    "let puppeteer;",
    "try { puppeteer = require('/opt/lingon/node_modules/puppeteer-core'); } catch { throw new Error('VM browser runtime is not installed yet (first boot is still running).'); }",
    "(async () => {",
    "  const browser = await profileRuntime.connectOrLaunch(puppeteer, executablePath);",
    "  try {",
    "    const { page, reusedPage, stateFile } = await profileRuntime.session(browser, payload.sessionId);",
    "    const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { url: 'about:blank' };",
    "    const pageState = {};",
    "    await kit.setupPage(page, pageState);",
    "    if (payload.action === 'navigate') { const host = new URL(payload.url).hostname; kit.note('Opening ' + (host.startsWith('www.') ? host.slice(4) : host)); await kit.open(page, payload.url); }",
    "    else {",
    "      if (!reusedPage && state.url && state.url !== 'about:blank' && kit.allowedRequest(state.url)) { await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}); if (Number.isFinite(state.scrollY)) await page.evaluate((y) => window.scrollTo(0, y), state.scrollY).catch(() => {}); }",
    "      if (payload.action === 'input' && payload.event && payload.event.secretUrl) {",
    "        const secretUrl = payload.event.secretUrl; delete payload.event.secretUrl;",
    `        const got = await fetch(secretUrl, { headers: { 'x-ms-version': '${BLOB_API}' } });`,
    "        const value = got.ok ? await got.text() : '';",
    `        await fetch(secretUrl, { method: 'DELETE', headers: { 'x-ms-version': '${BLOB_API}' } }).catch(() => {});`,
    "        if (!value) throw new Error('The vault value was not available on the VM, so nothing was typed.');",
    "        payload.event.text = value;",
    "      }",
    "      if (payload.action === 'input') await kit.act(page, payload.event || {});",
    "    }",
    "    const snap = await kit.snapshot(page, pageState);",
    "    kit.note('Looking at the page');",
    "    const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 });",
    "    const upload = await fetch(payload.uploadUrl, { method: 'PUT', headers: { 'content-type': 'image/jpeg', 'x-ms-blob-type': 'BlockBlob' }, body: screenshot });",
    "    if (!upload.ok) throw new Error('Screenshot upload failed: HTTP ' + upload.status + ' ' + (await upload.text()).slice(0, 300));",
    "    fs.writeFileSync(stateFile, JSON.stringify({ url: snap.url, title: snap.title, scrollY: snap.scrollY }));",
    "    process.stdout.write(JSON.stringify({ ok: true, ...snap, screenshotBytes: screenshot.length }));",
    "  } finally { await profileRuntime.saveCookies(browser).catch(() => {}); browser.disconnect(); }",
    "})().catch((error) => { process.stdout.write(JSON.stringify({ ok: false, error: String(error.message || error) })); process.exitCode = 1; })",
    // A handle left open must not keep the step, and so the VM's one command slot, busy.
    "  .finally(() => setTimeout(() => process.exit(), 1500).unref());",
  ].join('\n');
  const codeB64 = Buffer.from(runner, 'utf8').toString('base64');
  return [
    'set -e',
    'id -u lingon-browser >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/lingon-browser --shell /usr/sbin/nologin lingon-browser',
    'install -d -m 700 -o lingon-browser -g lingon-browser /var/lib/lingon-browser /var/lib/lingon-browser/sessions',
    ...CHROMIUM_POLICY_SETUP,
    ...BROWSER_INSTALL,
    ...BROWSER_NETWORK_GUARD,
    'install -d -m 755 -o root -g root /run/lingon',
    `echo '${codeB64}' | base64 -d > /run/lingon/browser-session.js`,
    'chown root:root /run/lingon/browser-session.js && chmod 644 /run/lingon/browser-session.js',
    'set +e',
    // Bounded, so a hung page can never hold the VM's one command slot.
    'OUT=$(mktemp)',
    OWN_SCOPE,
    `$SCOPE runuser -u lingon-browser -- timeout -k 5 170 env LINGON_BROWSER_PAYLOAD='${payloadB64}' node /run/lingon/browser-session.js > "$OUT"`,
    'EC=$?',
    `if [ -s "$OUT" ]; then cat "$OUT"; elif [ "$EC" = 124 ] || [ "$EC" = 137 ]; then echo '{"ok":false,"error":"The browser step took too long and was stopped. Try again, or open a simpler page."}'; fi`,
    'rm -f "$OUT" /run/lingon/browser-session.js',
    ...(live ? liveStreamerLaunch(sessionId, live) : []),
    'exit $EC',
  ].join('\n');
}
// Starts this session's live streamer after a browser step, unless it is running.
// This upload capability imports a reviewed checkout into a separate, trusted
// browser. Neither payment credentials nor the checkout server key enter a VM.
function buildCheckoutExportScript(sessionId, website, uploadUrl) {
  const payloadB64=Buffer.from(JSON.stringify({sessionId,website,uploadUrl})).toString('base64');
  const source=[
    "const fs=require('fs'),path=require('path');",
    `const kit=(${browserKit.toString()})();`,
    `const profiles=(${browserProfileRuntime.toString()})('/var/lib/lingon-browser/sessions',require);`,
    "const input=JSON.parse(Buffer.from(process.env.LINGON_CHECKOUT_IMPORT,'base64').toString());",
    "(async()=>{const browser=await profiles.connectExisting(require('/opt/lingon/node_modules/puppeteer-core'));if(!browser)throw Error();try{",
    "const dir=path.join('/var/lib/lingon-browser/sessions',input.sessionId);const targetId=fs.readFileSync(path.join(dir,'target-id'),'utf8').trim();const page=(await browser.pages()).find(p=>p.target()._targetId===targetId);if(!page || page.url()!==input.website)throw Error();",
    "const snapshot=await kit.snapshot(page);if(snapshot.sensitivePresent)throw Error();",
    "const state=await page.evaluate(()=>({url:location.href,scrollY,localStorage:Object.fromEntries(Object.entries(localStorage)),sessionStorage:Object.fromEntries(Object.entries(sessionStorage)),fields:[...document.querySelectorAll('input,select,textarea')].filter(e=>(e.id||e.name)&&!/password|cc-|card|cvc|cvv|iban|one-time-code|otp/i.test([e.type,e.autocomplete,e.name,e.id].join(' '))).map(e=>({id:e.id,name:e.name,value:e.value}))}));",
    "const host=new URL(input.website).hostname;state.cookies=(await browser.cookies()).filter(c=>{const domain=c.domain.replace(/^\\./,'');return domain===host||host.endsWith('.'+domain);});state.sensitivePresent=false;",
    "const reply=await fetch(input.uploadUrl,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});if(!reply.ok || (await reply.json()).created!==true)throw Error();process.stdout.write('PRIVATE_CHECKOUT_IMPORTED');",
    "}finally{browser.disconnect();}})().catch(()=>{process.stdout.write('PRIVATE_CHECKOUT_FAILED');process.exitCode=1;}).finally(()=>setTimeout(()=>process.exit(),1000).unref());"
  ].join('\n');
  const codeB64=Buffer.from(source).toString('base64');
  return ['set -e',...BROWSER_NETWORK_GUARD,'install -d -m 755 -o root -g root /run/lingon',
    `echo '${codeB64}' | base64 -d > /run/lingon/checkout-export.js`,
    'chown root:root /run/lingon/checkout-export.js && chmod 644 /run/lingon/checkout-export.js',OWN_SCOPE,
    `$SCOPE runuser -u lingon-browser -- timeout -k 5 90 env LINGON_CHECKOUT_IMPORT='${payloadB64}' node /run/lingon/checkout-export.js`,
    'rm -f /run/lingon/checkout-export.js'].join('\n');
}
async function exportCheckout(userId, sessionId, approved, {uploadUrl}) {
  const fail=()=>Error('Your reviewed checkout could not be opened privately. Review it again before paying.');
  try {
    const endpoint=new URL(uploadUrl), configured=new URL(process.env.PRIVATE_CHECKOUT_URL||'');
    if(configured.protocol!=='https:' || endpoint.origin!==configured.origin || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !/^\/imports\/[a-f0-9-]{36}$/.test(endpoint.pathname) || !sessionId || new URL(approved.website).protocol!=='https:')throw fail();
    const result=await runCommand(userId,buildCheckoutExportScript(toolBrowserSessionId(userId,sessionId),approved.website,endpoint.href),{maxStdout:1000});
    if(!String(result.stdout||'').includes('PRIVATE_CHECKOUT_IMPORTED'))throw fail();
  }catch{throw fail();}
}
function liveStreamerLaunch(sessionId, live) {
  const root = `/run/lingon/${sessionId}`;
  const stateRoot = `/var/lib/lingon-browser/sessions/${sessionId}`;
  const source = [
    `const kit = (${browserKit.toString()})();`,
    `const profileRuntime = (${browserProfileRuntime.toString()})('/var/lib/lingon-browser/sessions', require);`,
    `(${liveStreamer.toString()})(kit, profileRuntime, JSON.parse(Buffer.from(process.env.LINGON_LIVE_PAYLOAD, 'base64').toString('utf8')), require);`,
  ].join('\n');
  const codeB64 = Buffer.from(source, 'utf8').toString('base64');
  const payloadB64 = Buffer.from(JSON.stringify({ sessionId, ...live }), 'utf8').toString('base64');
  const version = liveStreamerVersion(live);
  return [
    `if [ -f '${stateRoot}/target-id' ] && ! { [ -f '${root}/live.pid' ] && kill -0 "$(cat '${root}/live.pid')" 2>/dev/null && [ "$(cat '${root}/live.version' 2>/dev/null)" = '${version}' ]; }; then`,
    `  if [ -f '${root}/live.pid' ]; then kill "$(cat '${root}/live.pid')" 2>/dev/null || true; fi`,
    '  if [ ! -d /opt/lingon/node_modules/ws ]; then npm install --prefix /opt/lingon ws@8.21.3 >/dev/null 2>&1; fi',
    `  install -d -m 755 -o root -g root '${root}'`,
    `  echo '${codeB64}' | base64 -d > '${root}/live.js'`,
    `  chown root:root '${root}/live.js' && chmod 644 '${root}/live.js'`,
    `  ${OWN_SCOPE}`,
    `  $SCOPE runuser -u lingon-browser -- env LINGON_LIVE_PAYLOAD='${payloadB64}' nohup node '${root}/live.js' >> '${root}/live.log' 2>&1 < /dev/null &`,
    `  echo $! > '${root}/live.pid'`,
    `  echo '${version}' > '${root}/live.version'`,
    `  chown root:root '${root}/live.pid' '${root}/live.version' '${root}/live.log' 2>/dev/null || true`,
    'fi',
  ];
}

/*
 * Shell and code steps sent over the owner's own channel run here, exactly as the VM command
 * would run them, without a VM command per step: Azure Run Command takes about 11 s even for
 * "echo". The agent runs as root like those commands, and only scripts signed with the key
 * the server gave it at launch, not expired and not seen before. Results go to a private
 * upload link in the job, never to the channel. It is serialized with toString(), so it uses
 * only its arguments (see browserKit).
 */
const SHELL_AGENT_BUILD = 'jobs-2';
const shellAgentVersion = (live) => `${SHELL_AGENT_BUILD}-${crypto.createHash('sha256').update(String(live.cmdKey || '')).digest('hex').slice(0, 12)}`;
function shellAgent(cfg, load) {
  const proc = load('process');
  const fs = load('fs');
  const cp = load('child_process');
  const crypto = load('crypto');
  const WebSocket = load('/opt/lingon/node_modules/ws');
  const topic = `realtime:${cfg.topic}`;
  const BLOB = /^https:\/\/[a-z0-9]{3,24}\.blob\.core\.windows\.net\//;
  // Longer than the VM's idle window, so it ends only on a VM nobody uses; a stop ends it anyway.
  const IDLE_EXIT_MS = 30 * 60000, MAX_OUT = 64000, JOB_MS = 120000;
  let ws = null, ref = 1, lastActivity = Date.now(), queue = Promise.resolve();
  const seen = new Map();
  // Keys sorted: the channel does not keep an object's key order (see signStep).
  const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v === undefined ? null : v));
  const digest = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');
  const signature = (p) => crypto.createHmac('sha256', String(cfg.cmdKey)).update(canon([p.id, 'job', digest(p.script), p.resultUrl, p.exp])).digest('hex');
  const valid = (p) => {
    if (!cfg.cmdKey || !p || typeof p.id !== 'string' || p.id.length > 80 || seen.has(p.id)) return false;
    if (!(Number(p.exp) > Date.now()) || Number(p.exp) > Date.now() + 5 * 60000) return false;
    if (typeof p.script !== 'string' || !p.script || p.script.length > 200000 || !BLOB.test(String(p.resultUrl || ''))) return false;
    const expected = Buffer.from(signature(p)), given = Buffer.from(String(p.sig || ''));
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  };
  const report = (url, body, first) => fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-ms-blob-type': 'BlockBlob', ...(first ? { 'If-None-Match': '*' } : {}) }, body: JSON.stringify(body) });
  const execute = (script) => new Promise((resolve) => {
    const file = `/run/lingon/agent/job-${crypto.randomUUID()}.sh`;
    fs.writeFileSync(file, script, { mode: 0o600 });
    // A clean environment: the job never sees the agent's key.
    // Its own process group, so a timeout ends everything the job started. The job settles at
    // most 5 s after that even if something still holds its output open: one hung command must
    // not leave every later job queued behind it.
    const child = cp.spawn('bash', [file], { cwd: '/', detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/root', LANG: 'C.UTF-8' } });
    let stdout = '', stderr = '', settled = false;
    child.stdout.on('data', (d) => { if (stdout.length < MAX_OUT) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < MAX_OUT) stderr += d; });
    const timer = setTimeout(() => {
      try { proc.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
      setTimeout(() => done(137, '\nThe command was stopped after ' + JOB_MS / 1000 + ' seconds.'), 5000).unref?.();
    }, JOB_MS);
    const done = (exitCode, extra) => { if (settled) return; settled = true; clearTimeout(timer); fs.rmSync(file, { force: true }); resolve({ stdout, stderr: stderr + (extra || ''), exitCode }); };
    child.on('close', (code) => done(code));
    child.on('error', (error) => done(127, String(error.message || error)));
  });
  const run = (p) => {
    seen.set(p.id, Date.now());
    for (const [id, at] of seen) if (Date.now() - at > 10 * 60000) seen.delete(id);
    lastActivity = Date.now();
    // Taking the job creates its result blob. The server, giving up waiting, tries to create
    // the same blob; whoever creates it first owns the job, so it never runs twice.
    const taken = report(p.resultUrl, { ack: true }, true).then((r) => r.status === 201).catch(() => false);
    queue = queue.then(async () => {
      if (!(await taken)) return;
      const result = await execute(p.script);
      await report(p.resultUrl, { done: true, ...result }).catch(() => {});
      lastActivity = Date.now();
    });
  };
  const connect = () => {
    ws = new WebSocket(`${cfg.url}?apikey=${encodeURIComponent(cfg.key)}&vsn=1.0.0`);
    ws.on('open', () => ws.send(JSON.stringify({ topic, event: 'phx_join', payload: { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, private: false } }, ref: '1', join_ref: '1' })));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.event === 'broadcast' && m.payload && m.payload.event === 'job' && valid(m.payload.payload)) run(m.payload.payload);
    });
    ws.on('close', () => setTimeout(connect, 2000));
    ws.on('error', () => {});
  };
  setInterval(() => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }));
    if (Date.now() - lastActivity > IDLE_EXIT_MS) proc.exit(0);
  }, 10000);
  connect();
}

// Starts the shell agent for this channel unless it already runs. Its key goes in a root-only
// file, not the command line or the environment.
function shellAgentLaunch(live) {
  const dir = '/run/lingon/agent';
  const source = `(${shellAgent.toString()})(JSON.parse(require('fs').readFileSync('${dir}/payload', 'utf8')), require);`;
  const codeB64 = Buffer.from(source, 'utf8').toString('base64');
  const payloadB64 = Buffer.from(JSON.stringify({ url: live.url, key: live.key, topic: live.topic, cmdKey: live.cmdKey }), 'utf8').toString('base64');
  const version = shellAgentVersion(live);
  return [
    `if command -v node >/dev/null 2>&1 && ! { [ -f '${dir}/agent.pid' ] && kill -0 "$(cat '${dir}/agent.pid')" 2>/dev/null && [ "$(cat '${dir}/agent.version' 2>/dev/null)" = '${version}' ]; }; then`,
    `  if [ -f '${dir}/agent.pid' ]; then kill "$(cat '${dir}/agent.pid')" 2>/dev/null || true; fi`,
    `  install -d -m 700 -o root -g root '${dir}'`,
    `  echo '${codeB64}' | base64 -d > '${dir}/agent.js'`,
    `  ( umask 077; echo '${payloadB64}' | base64 -d > '${dir}/payload' )`,
    `  ${OWN_SCOPE}`,
    // ws is installed in the background on a VM that has no browser yet, so the job never waits.
    `  $SCOPE nohup sh -c "[ -d /opt/lingon/node_modules/ws ] || npm install --prefix /opt/lingon ws@8.21.3 >/dev/null 2>&1; exec node '${dir}/agent.js'" >> '${dir}/agent.log' 2>&1 < /dev/null &`,
    `  echo $! > '${dir}/agent.pid'`,
    `  echo '${version}' > '${dir}/agent.version'`,
    'fi',
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
    // Most commands on a running VM finish within seconds, so the first checks come
    // sooner; a long operation (a cold start, a backup) is checked less often.
    await new Promise((ok) => setTimeout(ok, Date.now() - start < 20000 ? 1500 : 3000));
  }
  throw Object.assign(new Error('Azure operation timed out.'), { code: 'AZURE_TIMEOUT' });
}

async function arm(cfg, method, urlPath, body, apiVersion, { wait = true } = {}) {
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
  if ((r.status === 201 || r.status === 202) && loc) return wait ? pollAsync(cfg, loc) : { status: r.status };
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
  const payload = { sessionId, relayUrl, token };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const runner = [
    "const fs = require('fs');",
    "const path = require('path');",
    "const WebSocket = require('/opt/lingon/node_modules/ws');",
    `const kit = (${browserKit.toString()})();`,
    `const profileRuntime = (${browserProfileRuntime.toString()})('/var/lib/lingon-browser/sessions', require);`,
    "const payload = JSON.parse(Buffer.from(process.env.LINGON_BROWSER_RELAY_PAYLOAD, 'base64').toString('utf8'));",
    "const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
    "const findBrowser = () => ['/opt/lingon/chrome/chrome-headless-shell', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'].find((p) => fs.existsSync(p));",
    "const send = (socket, value) => { try { if (socket && socket.readyState === 1) socket.send(JSON.stringify(value)); } catch {} };",
    "const connect = () => new Promise((resolve, reject) => { const socket = new WebSocket(payload.relayUrl); const timer = setTimeout(() => { try { socket.terminate(); } catch {} reject(new Error('relay connection timed out')); }, 15000); socket.once('open', () => { clearTimeout(timer); resolve(socket); }); socket.once('error', (error) => { clearTimeout(timer); reject(error); }); });",
    "(async () => {",
    "  const executablePath = findBrowser();",
    "  if (!executablePath) throw new Error('Chromium is not installed yet (first boot is still running).');",
    "  let puppeteer; try { puppeteer = require('/opt/lingon/node_modules/puppeteer-core'); } catch { throw new Error('VM browser runtime is not installed yet (first boot is still running).'); }",
    "  const browser = await profileRuntime.connectOrLaunch(puppeteer, executablePath);",
    "  let socket = null; let stopping = false; let page; let cookieTimer;",
    "  try {",
    "    const opened = await profileRuntime.session(browser, payload.sessionId); page = opened.page;",
    "    const { stateFile, targetFile } = opened;",
    "    const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { url: 'about:blank' };",
    "    const pageState = {};",
    "    await kit.setupPage(page, pageState);",
    "    if (!opened.reusedPage && state.url && state.url !== 'about:blank' && kit.allowedRequest(state.url)) { await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}); if (Number.isFinite(state.scrollY)) await page.evaluate((y) => window.scrollTo(0, y), state.scrollY).catch(() => {}); }",
    "    const cdp = await page.target().createCDPSession(); await cdp.send('Page.enable');",
    "    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 72, maxWidth: 1280, maxHeight: 900, everyNthFrame: 1 });",
    "    cdp.on('Page.screencastFrame', ({ data, sessionId: frameId }) => { try { if (socket && socket.readyState === 1 && socket.bufferedAmount < 4000000) socket.send(Buffer.from(data, 'base64')); } catch {} cdp.send('Page.screencastFrameAck', { sessionId: frameId }).catch(() => {}); });",
    // Agent actions and inspections return the full page state (text and numbered
    // elements); the user's own input in the live view only needs url and title.
    "    const metadata = async (full) => { const s = full ? await kit.snapshot(page, pageState) : { url: page.url(), title: await page.title().catch(() => '') }; const scrollY = full ? s.scrollY : await page.evaluate(() => window.scrollY).catch(() => 0); fs.writeFileSync(stateFile, JSON.stringify({ url: s.url, title: s.title, scrollY })); await profileRuntime.saveCookies(browser).catch(() => {}); return s; };",
    "    cookieTimer = setInterval(() => { profileRuntime.saveCookies(browser).catch(() => {}); }, 10000);",
    "    const dispatch = async (command) => { const action = String(command.action || 'inspect'); const ev = command.event || {}; if (action === 'navigate') await kit.open(page, String(command.url || '')); else if (action === 'input') { await kit.act(page, ev); if (ev.type === 'move') return { url: page.url() }; } else if (action === 'stop') { stopping = true; } else if (action !== 'inspect') throw new Error('Unsupported browser relay action.'); return metadata(action !== 'input' || ev.agent === true); };",
    "    while (!stopping) {",
    "      try { socket = await connect(); send(socket, { type: 'ready', sessionId: payload.sessionId }); send(socket, { type: 'meta', ...(await metadata(true)), state: 'idle' });",
    "        await new Promise((resolve) => { let commandQueue = Promise.resolve(); socket.on('message', (raw) => { commandQueue = commandQueue.then(async () => { let command; try { command = JSON.parse(String(raw)); } catch { return; } if (command.type !== 'command') return; try { const result = await dispatch(command); send(socket, { type: 'result', id: command.id, ...result, state: 'idle' }); } catch (error) { send(socket, { type: 'result', id: command.id, ok: false, error: String(error.message || error) }); } }).catch(() => {}); }); socket.once('close', resolve); socket.once('error', resolve); });",
    "      } catch (error) { if (!stopping) await sleep(1000); } finally { try { socket?.close(); } catch {} socket = null; }",
    "    }",
    "    await cdp.send('Page.stopScreencast').catch(() => {});",
    "    await page.close().catch(() => {});",
    "    fs.rmSync(targetFile, { force: true });",
    "  } finally { clearInterval(cookieTimer); await profileRuntime.saveCookies(browser).catch(() => {}); try { browser.disconnect(); } catch {} }",
    "})().catch((error) => { process.stderr.write(String(error.message || error)); process.exitCode = 1; });",
  ].join('\n');
  const codeB64 = Buffer.from(runner, 'utf8').toString('base64');
  const root = `/run/lingon/${sessionId}`;
  return [
    'set -eu',
    'id -u lingon-browser >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/lingon-browser --shell /usr/sbin/nologin lingon-browser',
    'if [ ! -d /opt/lingon/node_modules/ws ]; then npm install --prefix /opt/lingon ws@8.21.3; fi',
    ...CHROMIUM_POLICY_SETUP,
    ...BROWSER_NETWORK_GUARD,
    `install -d -m 755 -o root -g root /run/lingon '${root}'`,
    `echo '${codeB64}' | base64 -d > '${root}/relay.js'`,
    `chown root:root '${root}/relay.js' && chmod 644 '${root}/relay.js'`,
    `if [ -f '${root}/relay.pid' ] && kill -0 "$(cat '${root}/relay.pid')" 2>/dev/null; then echo READY; exit 0; fi`,
    OWN_SCOPE,
    `$SCOPE runuser -u lingon-browser -- env LINGON_BROWSER_RELAY_PAYLOAD='${payloadB64}' nohup node '${root}/relay.js' >> '${root}/relay.log' 2>&1 < /dev/null & echo $! > '${root}/relay.pid'`,
    `chown root:root '${root}/relay.pid' '${root}/relay.log' 2>/dev/null || true`,
    'sleep 1',
    `kill -0 "$(cat '${root}/relay.pid')" 2>/dev/null`,
    'echo READY',
  ].join('\n');
}

function buildBrowserRelayStopScript(sessionId) {
  const id = browserSessionId(sessionId);
  const root = `/run/lingon/${id}`;
  return [
    'set +e',
    `if [ -f '${root}/relay.pid' ]; then kill "$(cat '${root}/relay.pid')" 2>/dev/null || true; fi`,
    `rm -f '${root}/relay.pid' '${root}/relay.js'`,
    'exit 0',
  ].join('\n');
}

// Chromium never downloads files and never stores passwords or cards: the VM browser gets
// this as a machine policy, and the desktop's Chromium has it built into its image.
const CHROMIUM_POLICY = JSON.stringify({
  DownloadRestrictions: 3, PasswordManagerEnabled: false,
  AutofillCreditCardEnabled: false, AutofillAddressEnabled: false,
  DeveloperToolsAvailability: 2, ExtensionInstallBlocklist: ['*'],
  AllowFileSelectionDialogs: false, PrintingEnabled: false,
  SafeBrowsingProtectionLevel: 1, SafeBrowsingProceedAnywayDisabled: true,
  ExternalProtocolDialogShowAlwaysOpenCheckbox: false,
  URLBlocklist: ['file://*', 'javascript://*', 'chrome://*', 'chrome-extension://*', 'devtools://*'],
});
const CHROMIUM_POLICY_SETUP = [
  `for DIR in /etc/chromium/policies/managed /etc/chromium-browser/policies/managed /etc/opt/chrome/policies/managed; do install -d -m 755 "$DIR"; printf '%s' '${CHROMIUM_POLICY}' > "$DIR/lingon.json"; done`,
  `if [ -d /var/snap/chromium/current ]; then install -d -m 755 /var/snap/chromium/current/policies/managed && printf '%s' '${CHROMIUM_POLICY}' > /var/snap/chromium/current/policies/managed/lingon.json || true; fi`,
];

/*
 * The virtual computer (computer use). A file manager, editor or window manager can start
 * programs, so the whole desktop runs inside one locked container per session and none of
 * it runs on the VM itself (docs/vm-security.md):
 * - rootless podman under the unprivileged lingon-desktop account: the container's users map
 *   to that account's subordinate ids, so even an escape lands in an account without rights;
 * - the only VM folder it sees is the desktop's own home (/var/lib/lingon-desktop/home: its
 *   files and its browser profile, kept with the VM backup), mounted noexec/nosuid/nodev,
 *   plus this session's streamer code, read-only. /tmp is a size-limited tmpfs;
 * - all capabilities dropped, no new privileges, a read-only image without setuid programs,
 *   private PID/IPC/UTS namespaces, and memory/CPU/task limits on its systemd scope; its seccomp
 *   profile is podman's default plus chroot, so Chromium's sandbox can chroot inside its own
 *   user namespace without the container holding any capability;
 * - network through slirp4netns, which runs as lingon-desktop, so the same firewall as the
 *   browser applies: public TCP 80/443 only, no private, metadata, platform or IPv6 addresses,
 *   and no way to the VM's loopback services;
 * - Chromium keeps its own sandbox; if the kernel does not give it one, the desktop browser
 *   stays closed rather than running without it.
 * The image is built by root (like the worker image) and handed to lingon-desktop, so building
 * it never needs the desktop's restricted network.
 */
const DESKTOP_IMAGE = 'localhost/lingon-desktop:20260930b';
const DESKTOP_BUILD = 'desktop-9';
// One desktop runs per VM (its home is shared). Another task's desktop replaces it only once
// it has had no agent step or owner input for this long; until then that task waits its turn.
const DESKTOP_BUSY_SECONDS = 300;
const DESKTOP_APT = 'tini xvfb openbox xdotool ffmpeg x11-xserver-utils x11-utils pcmanfm mousepad chromium fonts-dejavu-core fonts-liberation ca-certificates';
// lingon-desktop's subordinate ids; the container's user 1000 is the VM's DESKTOP_SUBID + 999.
const DESKTOP_SUBID = 524288;
function desktopContainerfile() {
  return [
    'FROM docker.io/library/node:22-bookworm-slim',
    'ENV DEBIAN_FRONTEND=noninteractive',
    `RUN apt-get update && apt-get install -y --no-install-recommends ${DESKTOP_APT} && rm -rf /var/lib/apt/lists/*`,
    'RUN npm install --prefix /opt/lingon ws@8.21.3 && npm cache clean --force',
    `RUN install -d -m 755 /etc/chromium/policies/managed && printf '%s' '${CHROMIUM_POLICY}' > /etc/chromium/policies/managed/lingon.json`,
    // Nothing inside can change user: setuid/setgid bits go, and there is no terminal to open.
    'RUN find / -xdev -perm /6000 -type f -exec chmod a-s {} + ; rm -f /usr/bin/x-terminal-emulator /etc/alternatives/x-terminal-emulator',
    'RUN userdel -r node 2>/dev/null || true; useradd --uid 1000 --create-home --shell /usr/sbin/nologin desktop',
    'USER 1000:1000',
    'WORKDIR /home/desktop',
    'ENTRYPOINT ["/usr/bin/tini", "--"]',
  ].join('\n');
}
const desktopContainerName = (sessionId) => `lingon-desktop-${browserSessionId(sessionId)}`;
const desktopVersion = (live) => `${DESKTOP_BUILD}-${crypto.createHash('sha256').update(String(live.cmdKey || '')).digest('hex').slice(0, 12)}`;
// Rootless podman as lingon-desktop, with its storage outside the backed-up folders.
const DESKTOP_PODMAN = 'runuser -u lingon-desktop -- env HOME=/home/lingon-desktop XDG_RUNTIME_DIR=/run/lingon-desktop podman';
const DESKTOP_HOME = '/var/lib/lingon-desktop/home';
// podman's default seccomp profile only allows chroot to holders of CAP_SYS_CHROOT; the desktop
// holds no capabilities, and Chromium's sandbox chroots inside its own user namespace.
const DESKTOP_SECCOMP = "const fs = require('fs'); const p = JSON.parse(fs.readFileSync('/usr/share/containers/seccomp.json', 'utf8')); "
  + "p.syscalls.push({ names: ['chroot'], action: 'SCMP_ACT_ALLOW', args: [], comment: 'Chromium sandbox', includes: {}, excludes: {} }); "
  + "fs.writeFileSync('/etc/lingon/desktop-seccomp.json', JSON.stringify(p));";
const DESKTOP_ACCOUNT = [
  // Azure's command runner starts in a folder only root can enter; podman as lingon-desktop cannot.
  'cd /',
  'id -u lingon-desktop >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/lingon-desktop --shell /usr/sbin/nologin lingon-desktop',
  `grep -q '^lingon-desktop:' /etc/subuid || usermod --add-subuids ${DESKTOP_SUBID}-${DESKTOP_SUBID + 65535} lingon-desktop`,
  `grep -q '^lingon-desktop:' /etc/subgid || usermod --add-subgids ${DESKTOP_SUBID}-${DESKTOP_SUBID + 65535} lingon-desktop`,
  'command -v podman >/dev/null 2>&1 && command -v newuidmap >/dev/null 2>&1 && command -v slirp4netns >/dev/null 2>&1 && command -v fuse-overlayfs >/dev/null 2>&1 || { export DEBIAN_FRONTEND=noninteractive; apt-get update -q >/dev/null 2>&1; apt-get install -y -q podman uidmap slirp4netns fuse-overlayfs >/dev/null 2>&1; }',
  "command -v systemd-run >/dev/null 2>&1 || { echo 'systemd-run is required to limit the computer' >&2; exit 1; }",
  'install -d -m 755 -o root -g root /var/lib/lingon-desktop /opt/lingon/desktop /run/lingon /run/lingon/desktop /etc/lingon',
  `echo '${Buffer.from(DESKTOP_SECCOMP).toString('base64')}' | base64 -d | node && chmod 644 /etc/lingon/desktop-seccomp.json`,
  'install -d -m 700 -o lingon-desktop -g lingon-desktop /home/lingon-desktop /home/lingon-desktop/.config /home/lingon-desktop/.config/containers /var/lib/lingon-desktop/storage /run/lingon-desktop',
  // The desktop's home belongs to the container's user, never to an account on the VM.
  "DUID=$(( $(awk -F: '$1==\"lingon-desktop\"{print $2; exit}' /etc/subuid) + 999 )); DGID=$(( $(awk -F: '$1==\"lingon-desktop\"{print $2; exit}' /etc/subgid) + 999 ))",
  `install -d -m 700 -o "$DUID" -g "$DGID" ${DESKTOP_HOME} ${DESKTOP_HOME}/Files`,
  `printf '%s\\n' '[storage]' 'driver = "overlay"' 'graphroot = "/var/lib/lingon-desktop/storage"' 'runroot = "/run/lingon-desktop/containers"' '[storage.options.overlay]' 'mount_program = "/usr/bin/fuse-overlayfs"' > /home/lingon-desktop/.config/containers/storage.conf`,
  `printf '%s\\n' '[containers]' 'log_driver = "k8s-file"' '[engine]' 'cgroup_manager = "cgroupfs"' 'events_logger = "file"' > /home/lingon-desktop/.config/containers/containers.conf`,
  'chown -R lingon-desktop:lingon-desktop /home/lingon-desktop/.config',
];

/*
 * Desktop kit, serialized into the container's streamer with toString(). It turns agent and
 * user input into xdotool steps on the virtual 1280x900 screen, the size of the Canvas live
 * view. Agent input pauses like a person; the owner's own input stays instant.
 */
function desktopKit() {
  const WIDTH = 1280, HEIGHT = 900;
  const KEYS = { enter: 'Return', return: 'Return', backspace: 'BackSpace', escape: 'Escape', esc: 'Escape', tab: 'Tab', space: 'space',
    arrowleft: 'Left', arrowright: 'Right', arrowup: 'Up', arrowdown: 'Down', left: 'Left', right: 'Right', up: 'Up', down: 'Down',
    delete: 'Delete', home: 'Home', end: 'End', pageup: 'Prior', pagedown: 'Next', insert: 'Insert',
    control: 'ctrl', ctrl: 'ctrl', shift: 'shift', alt: 'alt', option: 'alt', meta: 'super', cmd: 'super', super: 'super', win: 'super' };
  const keysym = (part) => {
    const known = KEYS[part.toLowerCase()];
    if (known) return known;
    if (/^f([1-9]|1[0-2])$/i.test(part)) return part.toUpperCase();
    if (/^[A-Za-z0-9]$/.test(part)) return part.toLowerCase();
    // Other X key names, such as Print or XF86AudioMute.
    if (/^[A-Za-z_][A-Za-z0-9_]{1,30}$/.test(part)) return part;
    throw new Error(`Unknown key "${part}".`);
  };
  const combo = (value) => {
    const parts = String(value || 'Escape').split('+').map((part) => part.trim()).filter(Boolean);
    if (!parts.length || parts.length > 4) throw new Error('Give one key or a combination such as ctrl+s.');
    return parts.map(keysym).join('+');
  };
  const point = (x, y, what) => {
    const px = Math.round(Number(x)), py = Math.round(Number(y));
    if (x == null || y == null || !Number.isFinite(px) || !Number.isFinite(py) || px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) {
      throw new Error(`${what} needs x and y inside the ${WIDTH}x${HEIGHT} screen.`);
    }
    return [px, py];
  };
  const xdo = (...args) => ({ xdotool: args.map(String) });
  const pause = (ms) => ({ sleep: ms });
  // The steps for one input event: xdotool calls, pauses and app launches.
  function steps(ev) {
    const type = String(ev.type || '');
    const agent = ev.agent === true;
    const moveTo = (x, y, what) => { const [px, py] = point(x, y, what); return [xdo('mousemove', px, py), ...(agent ? [pause(120)] : [])]; };
    switch (type) {
      case 'screenshot': return [];
      case 'move': return [xdo('mousemove', ...point(ev.x, ev.y, 'move'))];
      case 'click': case 'double_click': case 'right_click': case 'middle_click': {
        const button = type === 'right_click' || ev.button === 2 ? 3 : type === 'middle_click' ? 2 : 1;
        return [...moveTo(ev.x, ev.y, type), xdo('click', ...(type === 'double_click' ? ['--repeat', 2, '--delay', 120] : []), button)];
      }
      case 'drag': {
        const [fx, fy] = point(ev.x, ev.y, 'drag'), [tx, ty] = point(ev.to_x, ev.to_y, 'drag');
        const path = [];
        for (let i = 1; i <= 8; i++) path.push(xdo('mousemove', Math.round(fx + (tx - fx) * i / 8), Math.round(fy + (ty - fy) * i / 8)), pause(25));
        return [...moveTo(fx, fy, 'drag'), xdo('mousedown', 1), ...path, xdo('mouseup', 1)];
      }
      case 'type': {
        const text = String(ev.text ?? '').slice(0, 2000);
        if (!text && !ev.clear) throw new Error('type needs text.');
        const out = ev.x != null || ev.y != null ? [...moveTo(ev.x, ev.y, 'type'), xdo('click', 1), pause(agent ? 150 : 0)] : [];
        if (ev.clear) out.push(xdo('key', '--clearmodifiers', 'ctrl+a'), xdo('key', 'BackSpace'));
        if (text) out.push({ ...xdo('type', '--clearmodifiers', '--delay', agent ? 35 : 8, '--file', '-'), stdin: text });
        if (ev.submit) out.push(xdo('key', 'Return'));
        return out;
      }
      case 'key': {
        const raw = String(ev.key || 'Escape');
        // A single punctuation character is typed; X key names differ from the character.
        if (raw.length === 1 && !/[A-Za-z0-9]/.test(raw)) return [{ ...xdo('type', '--file', '-'), stdin: raw }];
        return [xdo('key', '--clearmodifiers', combo(raw))];
      }
      case 'scroll': {
        const dy = Number(ev.dy ?? (ev.dx ? 0 : 500)), dx = Number(ev.dx || 0);
        if (!Number.isFinite(dy) || !Number.isFinite(dx) || Math.abs(dy) > 10000 || Math.abs(dx) > 10000) throw new Error('Invalid scroll distance.');
        const out = ev.x != null || ev.y != null ? moveTo(ev.x, ev.y, 'scroll') : [];
        const notches = (d) => Math.min(40, Math.max(1, Math.round(Math.abs(d) / 100)));
        if (dy) out.push(xdo('click', '--repeat', notches(dy), '--delay', 30, dy > 0 ? 5 : 4));
        if (dx) out.push(xdo('click', '--repeat', notches(dx), '--delay', 30, dx > 0 ? 7 : 6));
        return out;
      }
      case 'open_app': {
        const app = String(ev.app || '');
        if (!['browser', 'files', 'editor'].includes(app)) throw new Error('open_app supports browser, files and editor.');
        const url = /^https?:\/\//i.test(String(ev.url || '')) ? String(ev.url) : '';
        return [{ launch: app, url }, pause(2000)];
      }
      case 'wait': return [pause(Math.min(10000, Math.max(0, Number(ev.ms) || 1000)))];
      default: throw new Error('Unsupported computer action.');
    }
  }
  // What the pointer badge in the live view says while the agent acts.
  function describe(ev) {
    const type = String(ev.type || '');
    const app = { browser: 'the browser', files: 'the file manager', editor: 'the text editor' }[ev.app] || 'an app';
    return ({ screenshot: 'Looking at the screen', move: 'Moving the pointer', click: 'Clicking', double_click: 'Double-clicking', right_click: 'Right-clicking',
      middle_click: 'Clicking', drag: 'Dragging', type: 'Typing', key: `Pressing ${String(ev.key || 'a key').slice(0, 30)}`, scroll: 'Scrolling',
      open_app: `Opening ${app}`, wait: 'Waiting' })[type] || 'Working on the computer';
  }
  return { WIDTH, HEIGHT, steps, combo, describe };
}

/*
 * The desktop's streamer, the container's main program (serialized with toString(); Node's
 * require arrives as `load`). It starts the virtual screen, window manager and apps, and joins
 * the session's Realtime channel like the browser's liveStreamer: frames go out only while
 * someone watches, the owner's input applies only after they take over, and agent steps count
 * only when signed with the key the server gave at launch. Results go to the step's private
 * upload links, never to the channel. After 20 idle minutes it exits and the container ends.
 */
function desktopStreamer(kit, cfg, load) {
  const proc = load('process');
  const fs = load('fs');
  const path = load('path');
  const crypto = load('crypto');
  const { spawn, execFile } = load('child_process');
  const WebSocket = load('/opt/lingon/node_modules/ws');
  const HOME = '/home/desktop', DISPLAY = ':1';
  // Apps get a clean environment: never the launch payload.
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME, DISPLAY, LANG: 'C.UTF-8', XDG_RUNTIME_DIR: '/tmp/xdg', XDG_CONFIG_HOME: `${HOME}/.config`, XDG_CACHE_HOME: '/tmp/cache' };
  for (const dir of [env.XDG_RUNTIME_DIR, env.XDG_CACHE_HOME, path.join(HOME, 'Files')]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // The browser profile lives in the kept home; a lock left by the last container is stale (one
  // desktop runs per VM), and Chromium would refuse the profile as in use elsewhere.
  for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) { try { fs.rmSync(path.join(HOME, '.chromium', lock), { force: true }); } catch {} }
  const topic = `realtime:${cfg.topic}`;
  const VIEWER_MS = 30000, IDLE_EXIT_MS = 20 * 60000, MAX_FRAME = 240000;
  let ws = null, joined = false, announced = false, ref = 1, lastViewer = 0, lastActivity = Date.now(), takeover = false;
  let ffmpeg = null, quality = 8, lastFrame = '', lastFrameAt = 0, agentNow = null;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const run = (cmd, args, timeout = 15000, input) => new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { env, timeout }, (error, stdout, stderr) => (error ? reject(new Error(String(stderr || error.message).trim().slice(0, 300))) : resolve(String(stdout).trim())));
    child.stdin.on('error', () => {});
    child.stdin.end(input == null ? '' : String(input));
  });
  const send = (event, payload) => {
    if (!ws || ws.readyState !== 1 || !joined) return false;
    ws.send(JSON.stringify({ topic, event: 'broadcast', payload: { type: 'broadcast', event, payload }, ref: String(++ref), join_ref: '1' }));
    return true;
  };
  const windowInfo = async () => {
    const title = await run('xdotool', ['getactivewindow', 'getwindowname'], 3000).catch(() => '');
    const ids = (await run('xdotool', ['search', '--onlyvisible', '--name', '.'], 3000).catch(() => '')).split('\n').filter(Boolean).slice(-15);
    const windows = [];
    for (const id of ids) { const name = (await run('xdotool', ['getwindowname', id], 3000).catch(() => '')).slice(0, 100); if (name && !windows.includes(name)) windows.push(name); }
    return { title: title.slice(0, 120) || 'Desktop', windows };
  };
  const meta = async () => { const info = await windowInfo(); send('state', { ...info, url: '', state: takeover ? 'user' : 'idle', kind: 'desktop', transport: 'realtime' }); return info; };
  async function ensureDisplay() {
    const up = () => run('xdotool', ['getdisplaygeometry'], 3000).then(() => true, () => false);
    if (await up()) return;
    const x = spawn('Xvfb', [DISPLAY, '-screen', '0', `${kit.WIDTH}x${kit.HEIGHT}x24`, '-nolisten', 'tcp'], { env, stdio: 'ignore' });
    x.on('exit', () => proc.exit(1));
    for (let i = 0; i < 80 && !(await up()); i++) await sleep(100);
    if (!(await up())) throw new Error('The virtual screen did not start.');
    spawn('openbox', [], { env, stdio: 'ignore' }).on('error', () => {});
    // Windows opened before the window manager runs get no focus, so typing would go astray:
    // wait until it has claimed the screen (on a first start it builds font caches for seconds).
    const managed = () => run('xprop', ['-root', '_NET_SUPPORTING_WM_CHECK'], 3000).then((out) => /window id/.test(out), () => false);
    for (let i = 0; i < 150 && !(await managed()); i++) await sleep(200);
    await run('xsetroot', ['-solid', '#2b3140']).catch(() => {});
  }
  // ffmpeg grabs the screen as JPEGs; a frame goes out when it differs from the last one.
  function startFrames() {
    if (ffmpeg) return;
    lastFrame = '';
    ffmpeg = spawn('ffmpeg', ['-loglevel', 'error', '-f', 'x11grab', '-framerate', '4', '-video_size', `${kit.WIDTH}x${kit.HEIGHT}`, '-draw_mouse', '1', '-i', DISPLAY, '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', String(quality), 'pipe:1'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
    const SOI = Buffer.from([0xff, 0xd8]), EOI = Buffer.from([0xff, 0xd9]);
    let buffer = Buffer.alloc(0);
    ffmpeg.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const start = buffer.indexOf(SOI);
        if (start < 0) { buffer = Buffer.alloc(0); return; }
        const end = buffer.indexOf(EOI, start + 2);
        if (end < 0) { buffer = buffer.length > 4000000 ? Buffer.alloc(0) : buffer.subarray(start); return; }
        const d = buffer.subarray(start, end + 2).toString('base64');
        buffer = buffer.subarray(end + 2);
        // An oversized frame lowers the quality instead of being dropped again and again.
        if (d.length > MAX_FRAME) { if (quality < 24) { quality += 4; stopFrames(); setTimeout(startFrames, 100); } return; }
        if (d !== lastFrame && send('frame', { d })) { lastFrame = d; lastFrameAt = Date.now(); }
      }
    });
    ffmpeg.on('error', () => {});
    ffmpeg.on('exit', () => { ffmpeg = null; });
  }
  function stopFrames() { if (ffmpeg) { try { ffmpeg.kill(); } catch {} ffmpeg = null; } }
  const grab = () => new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-loglevel', 'error', '-f', 'x11grab', '-video_size', `${kit.WIDTH}x${kit.HEIGHT}`, '-i', DISPLAY, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '6', 'pipe:1'],
      { env, timeout: 10000, encoding: 'buffer', maxBuffer: 4000000 }, (error, stdout) => (error || !stdout.length ? reject(new Error('The screen could not be captured.')) : resolve(stdout)));
  });
  const APPS = {
    browser: (url) => ['chromium', [`--user-data-dir=${HOME}/.chromium`, `--disk-cache-dir=${env.XDG_CACHE_HOME}/chromium`, '--no-first-run', '--no-default-browser-check', '--password-store=basic', '--disable-dev-shm-usage', '--disable-gpu', '--hide-crash-restore-bubble', '--window-position=0,0', `--window-size=${kit.WIDTH},${kit.HEIGHT}`, ...(url ? [url] : [])]],
    files: () => ['pcmanfm', [path.join(HOME, 'Files')]],
    editor: () => ['mousepad', []],
  };
  // An app that quits at once reports why; a browser without its sandbox stays closed.
  async function launch(app, url) {
    const [bin, args] = APPS[app](url);
    const child = spawn(bin, args, { env, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '', code = null;
    child.stderr.on('data', (chunk) => { err = (err + chunk).slice(-2000); });
    child.on('exit', (c) => { code = c; });
    child.on('error', (e) => { code = -1; err = String(e.message); });
    child.unref();
    for (let i = 0; i < 25 && code === null; i++) await sleep(100);
    if (code === null) return;
    if (app === 'browser' && /sandbox/i.test(err)) throw new Error('The computer\'s browser could not start its security sandbox, so it stays closed. Use the protected browser tools for websites.');
    if (code !== 0) throw new Error(`The ${app === 'files' ? 'file manager' : app === 'editor' ? 'text editor' : 'browser'} could not start. ${err.trim().split('\n').pop() || ''}`.trim());
  }
  async function execute(ev) {
    for (const step of kit.steps(ev)) {
      if (step.sleep) await sleep(step.sleep);
      else if (step.xdotool) await run('xdotool', step.xdotool, 15000 + (step.stdin ? step.stdin.length * 60 : 0), step.stdin);
      else if (step.launch) await launch(step.launch, step.url);
    }
  }
  const announce = (ev, pressed) => {
    const at = Number.isFinite(Number(ev.x)) && Number.isFinite(Number(ev.y)) ? { x: Number(ev.x), y: Number(ev.y) } : {};
    agentNow = { ...at, text: kit.describe(ev), pressed: !!pressed, at: Date.now() };
    if (Date.now() - lastViewer < VIEWER_MS) send('agent', agentNow);
  };
  const BLOB = /^https:\/\/[a-z0-9]{3,24}\.blob\.core\.windows\.net\//;
  const seenSteps = new Map();
  let stepQueue = Promise.resolve();
  // Keys sorted: the channel does not keep an object's key order (see signStep).
  const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v === undefined ? null : v));
  const stepSignature = (p) => crypto.createHmac('sha256', String(cfg.cmdKey)).update(canon([p.id, p.action, p.url || '', p.event || null, p.uploadUrl, p.resultUrl, p.exp])).digest('hex');
  const validStep = (p) => {
    if (!cfg.cmdKey || !p || typeof p.id !== 'string' || p.id.length > 80 || seenSteps.has(p.id)) return false;
    // A step for another build is left unanswered, so the server starts the current one.
    if (p.build !== cfg.build) return false;
    if (!(Number(p.exp) > Date.now()) || Number(p.exp) > Date.now() + 5 * 60000) return false;
    if (!['input', 'inspect'].includes(p.action) || (p.event && p.event.secret)) return false;
    if (!BLOB.test(String(p.uploadUrl || '')) || !BLOB.test(String(p.resultUrl || ''))) return false;
    const expected = Buffer.from(stepSignature(p)), given = Buffer.from(String(p.sig || ''));
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  };
  // The VM reads this file's time before another task's desktop may replace this one
  // (see DESKTOP_BUSY_SECONDS): a desktop in use is never taken away mid-task.
  const markInUse = () => { try { fs.writeFileSync(path.join(HOME, '.lingon-in-use'), String(Date.now())); } catch {} };
  const runStep = (p) => {
    seenSteps.set(p.id, Date.now());
    for (const [id, at] of seenSteps) if (Date.now() - at > 10 * 60000) seenSteps.delete(id);
    lastActivity = Date.now();
    markInUse();
    const report = (body, first) => fetch(p.resultUrl, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-ms-blob-type': 'BlockBlob', ...(first ? { 'If-None-Match': '*' } : {}) }, body: JSON.stringify(body) });
    // Whoever creates the step's result blob first owns it, so a step never runs twice.
    const taken = report({ ack: true }, true).then((r) => r.status === 201).catch(() => false);
    stepQueue = stepQueue.then(async () => {
      if (!(await taken)) return;
      let result;
      try {
        if (takeover) throw new Error('The owner has taken over this computer in the live view. Wait until they hand it back, then continue.');
        const ev = { ...(p.event || { type: 'screenshot' }), agent: true };
        announce(ev, false);
        if (p.action === 'input') await execute(ev);
        if (ev.x != null) announce(ev, true);
        await sleep(400);
        const screenshot = await grab();
        const upload = await fetch(p.uploadUrl, { method: 'PUT', headers: { 'content-type': 'image/jpeg', 'x-ms-blob-type': 'BlockBlob' }, body: screenshot });
        if (!upload.ok) throw new Error('Screenshot upload failed: HTTP ' + upload.status);
        result = { ok: true, desktop: true, ...(await meta()), screenshotBytes: screenshot.length };
      } catch (error) { result = { ok: false, error: String(error.message || error) }; }
      await report({ done: true, ...result }).catch(() => {});
      lastActivity = Date.now();
    });
  };
  const USER_INPUT = ['move', 'click', 'double_click', 'right_click', 'scroll', 'type', 'key'];
  const onBroadcast = (event, p) => {
    lastActivity = Date.now();
    if (event === 'step') { if (validStep(p)) runStep(p); return; }
    if (event === 'watch') {
      lastViewer = Date.now(); startFrames(); meta(); if (agentNow) send('agent', agentNow);
      if (lastFrame && Date.now() - lastFrameAt > 5000 && send('frame', { d: lastFrame })) lastFrameAt = Date.now();
    }
    else if (event === 'control') { takeover = p.takeover === true; meta(); }
    else if (event === 'input' && takeover && p.ev && typeof p.ev === 'object' && USER_INPUT.includes(String(p.ev.type))) {
      if (p.ev.type !== 'move') markInUse();
      execute({ ...p.ev, agent: false }).then(() => (p.ev.type === 'move' ? null : meta())).catch(() => {});
    }
  };
  const connect = () => {
    ws = new WebSocket(`${cfg.url}?apikey=${encodeURIComponent(cfg.key)}&vsn=1.0.0`);
    ws.on('open', () => ws.send(JSON.stringify({ topic, event: 'phx_join', payload: { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, private: false } }, ref: '1', join_ref: '1' })));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.event === 'phx_reply' && m.ref === '1') {
        joined = m.payload && m.payload.status === 'ok';
        // The start script waits for this line before the server sends the first step.
        if (joined && !announced) { announced = true; proc.stdout.write('LINGON_DESKTOP_JOINED\n'); }
        if (joined) meta();
      } else if (m.event === 'broadcast' && m.payload) onBroadcast(m.payload.event, m.payload.payload || {});
    });
    ws.on('close', () => { joined = false; setTimeout(connect, 2000); });
    ws.on('error', () => {});
  };
  setInterval(() => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }));
    if (ffmpeg && Date.now() - lastViewer > VIEWER_MS) stopFrames();
    // An owner who left without handing back still hands back: the agent must not wait forever.
    if (takeover && Date.now() - lastViewer > VIEWER_MS) takeover = false;
    if (Date.now() - Math.max(lastViewer, lastActivity) > IDLE_EXIT_MS) proc.exit(0);
  }, 10000);
  (async () => { await ensureDisplay(); connect(); })().catch((error) => { proc.stderr.write(String(error.message || error)); proc.exit(1); });
}

// The streamer program for one session, as the container runs it.
function desktopStreamerSource() {
  return [
    `const kit = (${desktopKit.toString()})();`,
    `(${desktopStreamer.toString()})(kit, JSON.parse(Buffer.from(process.env.LINGON_DESKTOP_PAYLOAD, 'base64').toString('utf8')), require);`,
  ].join('\n');
}

/*
 * Starts (or finds) this session's desktop container. Prints DESKTOP_READY once its streamer
 * has joined the live channel, DESKTOP_BUILDING while the image is still being prepared (the
 * first use on a VM takes a few minutes), and fails with the reason otherwise.
 */
function buildDesktopSessionScript(args = {}) {
  const sessionId = browserSessionId(args.sessionId);
  const live = liveRealtimeArgs(args.live);
  if (!live || !live.cmdKey) throw Object.assign(new Error('The computer needs its live channel.'), { code: 'BAD_INPUT' });
  const name = desktopContainerName(sessionId), version = desktopVersion(live), image = shellQuote(DESKTOP_IMAGE);
  const codeB64 = Buffer.from(desktopStreamerSource(), 'utf8').toString('base64');
  const payloadB64 = Buffer.from(JSON.stringify({ sessionId, ...live, build: DESKTOP_BUILD }), 'utf8').toString('base64');
  const buildB64 = Buffer.from([
    '#!/bin/sh',
    'set -e',
    `podman build -t ${image} /opt/lingon/desktop`,
    `podman save ${image} | ${DESKTOP_PODMAN} load`,
    `podman rmi ${image} >/dev/null 2>&1 || true`,
    'rm -f /var/lib/lingon-desktop/build.failed',
  ].join('\n'), 'utf8').toString('base64');
  const code = `/run/lingon/desktop/${sessionId}`;
  const P = DESKTOP_PODMAN;
  return [
    'set -eu',
    ...DESKTOP_ACCOUNT,
    ...networkGuard('lingon-desktop'),
    // The image: built by root in the background on first use, then handed to lingon-desktop.
    `if ! ${P} image exists ${image}; then`,
    "  if [ -f /var/lib/lingon-desktop/build.pid ] && kill -0 \"$(cat /var/lib/lingon-desktop/build.pid)\" 2>/dev/null; then echo DESKTOP_BUILDING; exit 0; fi",
    "  if [ -f /var/lib/lingon-desktop/build.failed ] && [ \"$(( $(date +%s) - $(stat -c %Y /var/lib/lingon-desktop/build.failed) ))\" -lt 600 ]; then echo \"The computer could not be prepared: $(tail -c 300 /var/lib/lingon-desktop/build.log 2>/dev/null | tr '\\n' ' ')\" >&2; exit 1; fi",
    `  echo '${Buffer.from(desktopContainerfile(), 'utf8').toString('base64')}' | base64 -d > /opt/lingon/desktop/Containerfile`,
    `  echo '${buildB64}' | base64 -d > /opt/lingon/desktop/build.sh`,
    '  chmod 700 /opt/lingon/desktop/build.sh',
    `  ${OWN_SCOPE}`,
    "  $SCOPE nohup sh -c '/opt/lingon/desktop/build.sh || touch /var/lib/lingon-desktop/build.failed' > /var/lib/lingon-desktop/build.log 2>&1 < /dev/null &",
    '  echo $! > /var/lib/lingon-desktop/build.pid',
    '  echo DESKTOP_BUILDING; exit 0',
    'fi',
    `STATE=$(${P} container inspect ${name} --format '{{.State.Running}}/{{index .Config.Labels "lingon.version"}}' 2>/dev/null || true)`,
    `if [ "$STATE" = 'true/${version}' ]; then echo DESKTOP_READY; exit 0; fi`,
    `${P} rm -f ${name} >/dev/null 2>&1 || true`,
    // One desktop per VM: its home is shared, so another session's desktop stops first, but
    // only once it is idle. One still in use keeps running and this session waits its turn.
    `if [ -n "$(${P} ps -q --filter label=lingon.desktop=1 2>/dev/null)" ] && [ -f '${DESKTOP_HOME}/.lingon-in-use' ] && [ "$(( $(date +%s) - $(stat -c %Y '${DESKTOP_HOME}/.lingon-in-use') ))" -lt ${DESKTOP_BUSY_SECONDS} ]; then echo DESKTOP_BUSY; exit 0; fi`,
    `for C in $(${P} ps -a -q --filter label=lingon.desktop=1); do ${P} rm -f "$C" >/dev/null 2>&1 || true; done`,
    `install -d -m 755 -o root -g root '${code}'`,
    `echo '${codeB64}' | base64 -d > '${code}/desktop.js'`,
    `chown root:root '${code}/desktop.js' && chmod 644 '${code}/desktop.js'`,
    // Memory, CPU and task limits hold for everything in the container: it stays in this scope.
    `systemd-run --scope --quiet --collect -p MemoryMax=2G -p CPUQuota=150% -p TasksMax=768 -- ${P} run -d --name ${name} --label lingon.desktop=1 --label lingon.version=${version}`
      + ' --cgroups=disabled --network=slirp4netns:enable_ipv6=false,allow_host_loopback=false --dns=10.0.2.3'
      // No capabilities; the seccomp profile is podman's default plus chroot, which Chromium's
      // sandbox calls inside its own user namespace (see DESKTOP_SECCOMP).
      + ' --cap-drop=ALL --security-opt=no-new-privileges --security-opt=seccomp=/etc/lingon/desktop-seccomp.json --read-only --user 1000:1000 --ipc=private --pid=private --uts=private --hostname=computer'
      + ` --volume ${DESKTOP_HOME}:/home/desktop:rw,noexec,nosuid,nodev`
      + ' --tmpfs /tmp:rw,nosuid,nodev,noexec,size=512m --tmpfs /var/lib/xkb:rw,nosuid,nodev,noexec,size=8m,mode=1777'
      + ' --shm-size=256m --ulimit nofile=4096:4096'
      + ` --volume '${code}/desktop.js:/opt/lingon/desktop.js:ro' --env LINGON_DESKTOP_PAYLOAD='${payloadB64}' ${image} node /opt/lingon/desktop.js >/dev/null`,
    // Ready once the streamer is on the live channel, so the first step is not missed.
    'for I in $(seq 1 60); do',
    `  if ${P} logs ${name} 2>/dev/null | grep -q LINGON_DESKTOP_JOINED; then echo DESKTOP_READY; exit 0; fi`,
    `  [ "$(${P} container inspect ${name} --format '{{.State.Running}}' 2>/dev/null)" = true ] || break`,
    '  sleep 0.5',
    'done',
    `echo "The computer did not start: $(${P} logs --tail 5 ${name} 2>&1 | tr '\\n' ' ' | tail -c 400)" >&2`,
    'exit 1',
  ].join('\n');
}

function buildDesktopStopScript(sessionId) {
  const id = browserSessionId(sessionId);
  return [
    'set +e',
    'cd /',
    `id -u lingon-desktop >/dev/null 2>&1 && ${DESKTOP_PODMAN} rm -f ${desktopContainerName(id)} >/dev/null 2>&1`,
    `rm -rf '/run/lingon/desktop/${id}'`,
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

// The screenshot store and its key, kept ten minutes: looking them up took three Azure
// management calls on every browser step.
let screenshotStorageCache = { accountId: '', accountKey: '', storage: null, exp: 0 };
async function createScreenshotTransfer(userId, sessionId, ext = 'jpg') {
  const cfg = azureConfig();
  const accountId = `${rgPath(cfg)}/providers/Microsoft.Storage/storageAccounts/${storageAccountName(cfg)}`;
  if (screenshotStorageCache.accountId !== accountId || Date.now() >= screenshotStorageCache.exp) {
    const storage = await ensureScreenshotStorage(cfg);
    const keys = await arm(cfg, 'POST', `${storage.accountId}/listKeys`, {}, STORAGE_API);
    const accountKey = (keys.keys || []).find((key) => key.value)?.value;
    if (!accountKey) throw Object.assign(new Error('Azure Storage account key was not returned.'), { code: 'AZURE_STORAGE' });
    screenshotStorageCache = { accountId, accountKey, storage, exp: Date.now() + 10 * 60000 };
  }
  const { storage, accountKey } = screenshotStorageCache;
  const blob = `${userHash(userId)}/${browserSessionId(sessionId)}-${crypto.randomUUID()}.${ext}`;
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
    'if [ -f "$MARKER" ]; then echo STATE_RESTORED; exit 0; fi',
    'install -d -m 700 /var/lib/lingon-state',
    'ARCHIVE=$(mktemp /tmp/lingon-state.XXXXXX.tar.gz)',
    'trap \'rm -f "$ARCHIVE"\' EXIT',
    `URL=$(echo '${encoded}' | base64 -d)`,
    `CODE=$(curl -sS --retry 2 --max-time 180 -w '%{http_code}' -o "$ARCHIVE" -H 'x-ms-version: ${BLOB_API}' "$URL")`,
    'if [ "$CODE" = 200 ]; then',
    '  timeout 150 tar -xzf "$ARCHIVE" -C /',
    'elif [ "$CODE" != 404 ]; then',
    '  echo "Workspace restore failed with HTTP $CODE" >&2; exit 1',
    'fi',
    'id -u lingon-browser >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/lingon-browser --shell /usr/sbin/nologin lingon-browser',
    'install -d -m 700 -o lingon -g lingon /home/lingon/workspace',
    'install -d -m 700 -o lingon-browser -g lingon-browser /var/lib/lingon-browser/sessions',
    'chown -R lingon:lingon /home/lingon/workspace',
    'chown -R lingon-browser:lingon-browser /var/lib/lingon-browser/sessions',
    'id -u lingon-desktop >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/lingon-desktop --shell /usr/sbin/nologin lingon-desktop',
    'install -d -m 700 -o lingon-desktop -g lingon-desktop /home/lingon-desktop',
    'chown -R lingon-desktop:lingon-desktop /home/lingon-desktop',
    'date -u +%FT%TZ > "$MARKER"',
    'echo STATE_RESTORED',
  ].join('\n');
}

// The restore as the first part of another command. A disk that was restored before (every VM
// that only stopped and started again) skips it at once; a separate restore command cost a
// VM round trip of 12-15 s on every cold start.
function buildRestorePrelude(url) {
  return [
    'if [ ! -f /var/lib/lingon-state/restored-v1 ]; then',
    'LINGON_RESTORE_ERR=$(mktemp)',
    '(',
    buildRestoreStateScript(url),
    ') >/dev/null 2>"$LINGON_RESTORE_ERR" || { echo "Workspace restore failed: $(tail -c 400 "$LINGON_RESTORE_ERR")" >&2; exit 1; }',
    'rm -f "$LINGON_RESTORE_ERR"',
    'fi',
  ].join('\n');
}

function buildSnapshotStateScript(url) {
  const encoded = assertStateTransferUrl(url);
  return [
    'set -eu',
    'install -d -m 700 /var/lib/lingon-state',
    'install -d -m 700 -o lingon -g lingon /home/lingon/workspace',
    'install -d -m 700 -o lingon-browser -g lingon-browser /var/lib/lingon-browser/sessions',
    'id -u lingon-desktop >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/lingon-desktop --shell /usr/sbin/nologin lingon-desktop',
    'install -d -m 700 -o lingon-desktop -g lingon-desktop /home/lingon-desktop',
    // Everything the browser users run (Chrome, the live streamer) stops, so the profile is
    // saved whole; the next browser step starts them again.
    'pkill -u lingon-browser 2>/dev/null || true',
    // The desktop container stops first, so its home is saved whole.
    `if id -u lingon-desktop >/dev/null 2>&1 && command -v podman >/dev/null 2>&1; then (cd / && ${DESKTOP_PODMAN} rm -f -a) >/dev/null 2>&1 || true; fi`,
    'pkill -u lingon-desktop 2>/dev/null || true',
    'sleep 1',
    'ARCHIVE=$(mktemp /tmp/lingon-state.XXXXXX.tar.gz)',
    'trap \'rm -f "$ARCHIVE"\' EXIT',
    // Time-bounded, so a backup can never hold the VM's one command slot for long.
    "timeout 150 tar --exclude='*/Cache/*' --exclude='*/Code Cache/*' --exclude='*/GPUCache/*' --exclude='*/Service Worker/CacheStorage/*' --exclude='*/Service Worker/ScriptCache/*' --exclude='*/GrShaderCache/*' --exclude='*/ShaderCache/*' --exclude='*/Crashpad/*' --exclude='*/component_crx_cache/*' --exclude='home/lingon-desktop/.relay' --exclude='home/lingon-desktop/.run' --exclude='home/lingon-desktop/.cache' --exclude='var/lib/lingon-desktop/home/.cache' -czf \"$ARCHIVE\" -C / home/lingon/workspace var/lib/lingon-browser/sessions home/lingon-desktop $([ -d /var/lib/lingon-desktop/home ] && echo var/lib/lingon-desktop/home)",
    'tar -tzf "$ARCHIVE" >/dev/null',
    `URL=$(echo '${encoded}' | base64 -d)`,
    `curl -fsS --retry 2 --max-time 180 -X PUT -H 'x-ms-version: ${BLOB_API}' -H 'x-ms-blob-type: BlockBlob' -H 'content-type: application/gzip' --data-binary @"$ARCHIVE" "$URL"`,
    'date -u +%FT%TZ > /var/lib/lingon-state/restored-v1',
    'echo STATE_SAVED',
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

// Azure sometimes has no capacity for a size in the region (seen for Standard_B2als_v2 and
// B2as_v2 in swedencentral on 2026-09-30), or a size is not offered to the subscription. A VM
// is then created on, or resized to, the next of these: all 2 vCPUs on x64 at a similar price.
// The configured AZURE_VM_SIZE stays first.
const VM_SIZE_FALLBACKS = ['Standard_B2as_v2', 'Standard_B2s_v2', 'Standard_D2as_v5', 'Standard_D2s_v5'];
// A size that just had no capacity usually still has none: for half an hour the size that last
// worked is tried first, so a new VM does not fail on the same sizes again (5-10 s each).
let sizeWithCapacity = { size: '', at: 0 };
const noteCapacity = (size) => { sizeWithCapacity = { size, at: Date.now() }; };
const vmSizes = (cfg) => [...new Set([Date.now() - sizeWithCapacity.at < 30 * 60000 ? sizeWithCapacity.size : '', cfg.vmSize, ...VM_SIZE_FALLBACKS].filter(Boolean))];
const noCapacity = (error) => /AllocationFailed|sufficient capacity|OverconstrainedAllocationRequest|SkuNotAvailable|not available (?:to|in) the current (?:subscription|region)/i.test(String(error && error.message));

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
  await assertAccountActive(userId);
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
  const body = (vmSize) => ({
    location: cfg.location,
    tags: { lingon: 'sandbox', user: userHash(userId) },
    properties: {
      hardwareProfile: { vmSize },
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
  });
  // A size without capacity leaves a failed VM behind; it is removed and the next size tried.
  const sizes = vmSizes(cfg);
  for (let i = 0; ; i++) {
    try {
      await assertAccountActive(userId);
      const vm = await arm(cfg, 'PUT', vmPath, body(sizes[i]), COMPUTE_API);
      if (i) { console.warn('[vm] created on a fallback size', { vm: name, size: sizes[i] }); noteCapacity(sizes[i]); }
      return { vmName: name, id: vm.id, vmId: vm.properties?.vmId || null, provisioningState: vm.properties?.provisioningState || 'Creating', created: true, vmSize: sizes[i] };
    } catch (error) {
      if (!noCapacity(error) || i + 1 >= sizes.length) throw error;
      console.warn('[vm] no capacity for size', { vm: name, size: sizes[i] });
      // Removing a VM keeps its OS disk, which would stay behind (and be billed) unused.
      const failed = await arm(cfg, 'GET', vmPath, undefined, COMPUTE_API).catch(() => null);
      const diskId = String(failed?.properties?.storageProfile?.osDisk?.managedDisk?.id || '');
      await arm(cfg, 'DELETE', vmPath, undefined, COMPUTE_API).catch((e) => { if (e.code !== 'AZURE_NOT_FOUND') throw e; });
      if (diskId.toLowerCase().startsWith(`${rgPath(cfg)}/providers/Microsoft.Compute/disks/`.toLowerCase())) {
        await arm(cfg, 'DELETE', diskId, undefined, DISK_API).catch((e) => { if (e.code !== 'AZURE_NOT_FOUND') console.warn('[vm] failed VM disk not removed', { vm: name, error: e.code || 'AZURE_ARM' }); });
      }
    }
  }
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

function assertStateCommandSucceeded(output, marker, code) {
  if (output.stderr || !String(output.stdout || '').split(/\r?\n/).includes(marker)) {
    throw Object.assign(new Error(output.stderr || 'VM state command did not confirm completion.'), { code });
  }
}

// The worker image recipe, used at first boot and when a VM repairs a failed bootstrap.
function workerContainerfileB64() {
  return Buffer.from([
    'FROM docker.io/library/node:22-bookworm-slim',
    'ENV DEBIAN_FRONTEND=noninteractive',
    'RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates coreutils python3 && rm -rf /var/lib/apt/lists/*',
    'WORKDIR /workspace',
  ].join('\n'), 'utf8').toString('base64');
}
function cloudInit(cfg) {
  const user = cfg.adminUsername || 'lingon';
  const image = workerImage(cfg);
  const workerContainerfile = workerContainerfileB64();
  const yaml = [
    '#cloud-config',
    'package_update: true',
    'packages:',
    '  - python3',
    '  - ca-certificates',
    '  - curl',
    '  - fonts-liberation',
    '  - podman',
    '  - uidmap',
    '  - slirp4netns',
    '  - fuse-overlayfs',
    'runcmd:',
    '  - id -u lingon-browser >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/lingon-browser --shell /usr/sbin/nologin lingon-browser',
    '  - install -d -m 700 -o lingon-browser -g lingon-browser /var/lib/lingon-browser /var/lib/lingon-browser/sessions',
    '  - id -u lingon-desktop >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/lingon-desktop --shell /usr/sbin/nologin lingon-desktop',
    `  - mkdir -p /home/${user}/workspace /opt/lingon`,
    `  - chown -R ${user}:${user} /home/${user}/workspace`,
    '  - curl -fsSL https://deb.nodesource.com/setup_22.x | bash -',
    '  - apt-get install -y nodejs',
    '  - mkdir -p /opt/lingon && chown -R ' + user + ':' + user + ' /opt/lingon',
    '  - su - ' + user + ' -c "npm install --prefix /opt/lingon puppeteer-core@25.11.0 ws@8.21.3" || true',
    // One runcmd entry: each entry runs on its own, and the install is one if-block.
    `  - ${JSON.stringify(BROWSER_INSTALL.join('\n'))}`,
    '  - install -d -m 700 /opt/lingon/worker /var/lib/lingon-worker',
    `  - echo '${workerContainerfile}' | base64 -d > /opt/lingon/worker/Containerfile`,
    `  - podman image exists ${shellQuote(image)} || (podman pull ${shellQuote(image)} || podman build -t ${shellQuote(image)} /opt/lingon/worker)`,
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
    await new Promise((ok) => setTimeout(ok, 2000));
  }
  throw Object.assign(new Error(`Azure VM did not reach ${want} in time.`), { code: 'AZURE_TIMEOUT' });
}

async function startVm(userId) {
  await assertAccountActive(userId);
  const cfg = azureConfig();
  const name = vmNameForUser(userId);
  const vmPath = `${rgPath(cfg)}/providers/Microsoft.Compute/virtualMachines/${name}`;
  try {
    await arm(cfg, 'POST', `${vmPath}/start`, undefined, COMPUTE_API);
  } catch (error) {
    if (!noCapacity(error)) throw error;
    // No capacity for its size right now: the stopped VM moves to the next size and starts
    // there. Its disk, files and browser profile stay the same.
    const current = (await arm(cfg, 'GET', vmPath, undefined, COMPUTE_API)).properties?.hardwareProfile?.vmSize;
    const sizes = vmSizes(cfg).filter((size) => size !== current);
    for (let i = 0; ; i++) {
      console.warn('[vm] no capacity to start, resizing', { vm: name, from: current, to: sizes[i] });
      try {
        await assertAccountActive(userId);
        await arm(cfg, 'PATCH', vmPath, { properties: { hardwareProfile: { vmSize: sizes[i] } } }, COMPUTE_API);
        await arm(cfg, 'POST', `${vmPath}/start`, undefined, COMPUTE_API);
        noteCapacity(sizes[i]);
        break;
      } catch (next) {
        if (!noCapacity(next) || i + 1 >= sizes.length) throw next;
      }
    }
  }
  await waitPower(userId, 'running');
  touchActivity(userId);
  return { vmName: name, power: 'running' };
}

async function deallocateVm(userId, { wait = true } = {}) {
  const cfg = azureConfig();
  const name = vmNameForUser(userId);
  await arm(cfg, 'POST', `${rgPath(cfg)}/providers/Microsoft.Compute/virtualMachines/${name}/deallocate`, undefined, COMPUTE_API, { wait });
  return { vmName: name, power: wait ? 'deallocated' : 'deallocating' };
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
  await assertAccountActive(userId);
  await requireVmTokens(userId);
  const expiresAt = Date.now() + LEASE_TTL_MS;
  const began = Date.now(), timing = {};
  let acquired = false, recorded = '';
  // A shutdown in progress counts as stale after five minutes (see acquire_agent_vm_lease), so
  // new work waits a little longer than that rather than failing while the VM stops.
  for (let attempt = 0; attempt < 220 && !acquired; attempt++) {
    await assertAccountActive(userId);
    const result = await supabaseRpc('acquire_agent_vm_lease', {
      p_user_id: String(userId),
      p_lease_id: id,
      p_kind: String(kind || 'app').slice(0, 32),
      p_vm_name: vmNameForUser(userId),
      p_expires_at: new Date(expiresAt).toISOString(),
    });
    const row = Array.isArray(result) ? result[0] : result;
    acquired = !!row?.acquired;
    recorded = String(row?.power_state || '');
    if (!acquired) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  timing.leaseMs = Date.now() - began;
  if (!acquired) throw Object.assign(new Error('VM is still stopping; retry shortly.'), { code: 'AZURE_BUSY' });
  try {
    const vm = await ensureRunning(userId, { create: azureConfig().autoProvision });
    timing.startMs = Date.now() - began - timing.leaseMs;
    timing.started = vm.started;
    const workerKey = String(userId);
    if (workerReadyState.get(workerKey) && vm.vmId && workerReadyState.get(workerKey) !== vm.vmId) workerReadyState.delete(workerKey);
    // A new VM restores the owner's files before anything runs. A VM that only stopped and
    // started kept its disk, so its restore check rides along with its first command (see
    // runCommand) instead of costing a command of its own. A VM recorded as running was
    // checked when it started.
    if (vm.created) {
      const restoreAt = Date.now();
      await restoreDurableState(userId, { vmId: vm.vmId });
      timing.restoreMs = Date.now() - restoreAt;
    } else if (vm.started || recorded !== 'running') {
      if (azureConfig().durableState && (!vm.vmId || restoredState.get(workerKey) !== vm.vmId)) pendingRestore.set(workerKey, vm.vmId || 'started');
    } else if (vm.vmId) restoredState.set(String(userId), vm.vmId);
    await supabaseRpc('mark_agent_vm_running', { p_user_id: String(userId) });
    await meterVm(userId);
    timing.totalMs = Date.now() - began;
    if (timing.started || timing.totalMs > 5000) console.info('[vm] lease', { vm: vmNameForUser(userId), ...timing });
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
  await assertAccountActive(userId);
  await requireVmTokens(userId);
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
  await meterVm(userId);
  return { vmName: vmNameForUser(userId), power: 'running', leaseId: id, leases: await leaseSnapshot(userId), expiresAt };
}

async function releaseLease(userId, { leaseId, skipSnapshot = false } = {}) {
  const key = String(userId);
  const id = String(leaseId || '').trim();
  if (isLeaseStoreConfigured()) {
    await meterVm(key);
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
        await meterVm(key, true);
        success = true;
      }
      finally {
        await supabaseRpc('finish_agent_vm_stop', { p_user_id: key, p_claim_token: claim, p_success: success }).catch(() => {});
      }
    }
    // No backup here: files stay on the VM's disk while it idles, and the backup runs before it
    // is deallocated (above, and in sweepLeases). A backup after every step also stopped the
    // browser and its live view between steps.
    const active = await leaseSnapshot(key);
    return { vmName: vmNameForUser(key), power: active.length ? 'running' : (row?.idle_until ? 'idle' : 'deallocated'), idleUntil: row?.idle_until || null, leases: active };
  }
  const map = leases.get(key);
  if (map) { map.delete(id); if (!map.size) leases.delete(key); }
  await deallocateIfUnused(key);
  return { vmName: vmNameForUser(key), power: (leases.get(key)?.size || 0) ? 'running' : 'deallocated', leases: await leaseSnapshot(key) };
}

/* Idle VMs stop here, once a minute (the vm-lease-sweeper schedule). The scheduler waits
   25 seconds for a sweep, and the host can end the request then. A sweep that backed up
   and then waited for Azure to deallocate took longer: it was cut off with the VM marked
   stopping, which no sweep looked at again, and a cut before the deallocation was sent
   left the VM running. So a sweep gives the backup SWEEP_BACKUP_MS, sends the
   deallocation without waiting for it, and first settles every VM left stopping from
   Azure's own power state. */
const SWEEP_BACKUP_MS = 12000;
const STOP_SETTLE_MS = 45000;

async function stoppingVms(limit) {
  const cfg = supabaseLeaseConfig();
  const query = new URLSearchParams({
    select: 'user_id,vm_name,stop_claim_token',
    power_state: 'eq.stopping',
    stop_claim_token: 'not.is.null',
    stop_claimed_at: `lt.${new Date(Date.now() - STOP_SETTLE_MS).toISOString()}`,
    limit: String(limit),
  });
  const response = await fetch(`${cfg.url}/rest/v1/agent_vm_instances?${query}`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
  });
  if (!response.ok) throw Object.assign(new Error('Could not read stopping VMs.'), { code: 'VM_LEASE_STORE' });
  return response.json();
}

// A deallocated VM is marked so. One still up goes back to running, and the claim below
// stops it again unless new work has leased it meanwhile.
async function settleStop(row) {
  let power;
  try { power = await powerState(row.user_id); }
  catch (error) { if (error.code !== 'AZURE_NOT_FOUND') return { vmName: row.vm_name, settled: false, error: error.code || 'AZURE_ARM' }; power = 'deallocated'; }
  if (power === 'deallocating') return null;
  const stopped = power === 'deallocated';
  await supabaseRpc('finish_agent_vm_stop', { p_user_id: row.user_id, p_claim_token: row.stop_claim_token, p_success: stopped });
  return { vmName: row.vm_name, stopped, power };
}

async function stopIdleVm(row, claim, backupMs) {
  const results = [];
  // Deallocating keeps the OS disk, so a backup that fails or runs long does not keep an
  // idle VM running; the files stay on the disk and the next backup includes them.
  let timer;
  const backupTime = new Promise((resolve, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Backup still running.'), { code: 'AZURE_STATE_SLOW' })), backupMs); });
  try { await Promise.race([snapshotDurableState(row.user_id), backupTime]); }
  catch (error) { results.push({ vmName: row.vm_name, snapshot: false, error: error.code || 'AZURE_STATE' }); }
  finally { clearTimeout(timer); }
  try {
    await deallocateVm(row.user_id, { wait: false });
    await meterVm(row.user_id, true).catch(() => {});
    results.push({ vmName: row.vm_name, stopping: true });
  } catch (error) {
    const gone = error.code === 'AZURE_NOT_FOUND';
    await supabaseRpc('finish_agent_vm_stop', { p_user_id: row.user_id, p_claim_token: row.claim_token || claim, p_success: gone }).catch(() => {});
    results.push(gone ? { vmName: row.vm_name, stopped: true } : { vmName: row.vm_name, stopped: false, error: error.code || 'AZURE_ARM' });
  }
  return results;
}

async function sweepLeases({ limit = 20, backupMs = SWEEP_BACKUP_MS } = {}) {
  if (isLeaseStoreConfigured()) {
    const results = [];
    const stale = await stoppingVms(limit).catch((error) => { results.push({ settled: false, error: error.code || 'VM_LEASE_STORE' }); return []; });
    for (const outcome of await Promise.all(stale.map((row) => settleStop(row).catch((error) => ({ vmName: row.vm_name, settled: false, error: error.code || 'VM_LEASE_STORE' }))))) {
      if (outcome) results.push(outcome);
    }
    const claim = crypto.randomUUID();
    const rows = await supabaseRpc('claim_idle_agent_vms', { p_claim_token: claim, p_limit: limit }) || [];
    for (const list of await Promise.all(rows.map((row) => stopIdleVm(row, claim, backupMs)))) results.push(...list);
    return { checked: rows.length, settled: stale.length, results };
  }
  const now = Date.now();
  for (const [userId, map] of leases) {
    for (const [leaseId, lease] of map) if (lease.expiresAt <= now) map.delete(leaseId);
    if (!map.size) { leases.delete(userId); await deallocateIfUnused(userId); }
  }
  return { checked: leases.size, results: [] };
}

async function ensureRunning(userId, { create = true } = {}) {
  await assertAccountActive(userId);
  const vm = await ensureVm(userId, { create });
  const key = String(userId);
  if (workerReadyState.get(key) && vm.vmId && workerReadyState.get(key) !== vm.vmId) workerReadyState.delete(key);
  const st = await powerState(userId);
  // A VM already starting (see prewarm) only needs waiting for; a second start request
  // could conflict with the one in progress.
  if (st === 'starting') await waitPower(userId, 'running');
  else if (st !== 'running') {
    // An idle stop is sent without waiting for it (see sweepLeases); Azure refuses a start
    // until that stop is done.
    if (st === 'deallocating') await waitPower(userId, 'deallocated');
    else if (st === 'stopping') await waitPower(userId, 'stopped');
    await startVm(userId);
  }
  else touchActivity(userId);
  return { vmName: vmNameForUser(userId), vmId: vm.vmId, power: 'running', started: st !== 'running', created: !!vm.created };
}

// Starts the VM ahead of work that will need it, without waiting for it to boot. A task
// that will use the browser or shell calls this while its first plan is written, so the
// minute a cold start takes overlaps with that. The lease and its release leave the usual
// idle window, after which an unused VM is stopped as always. It never creates a VM, and
// a VM that is stopping is left to stop.
async function prewarm(userId) {
  if (!userId || !isAzureConfigured() || !isLeaseStoreConfigured()) return { started: false };
  let power;
  try { power = await powerState(userId); }
  catch (error) { if (error.code === 'AZURE_NOT_FOUND') return { started: false, power: 'missing' }; throw error; }
  await requireVmTokens(userId);
  const cfg = azureConfig();
  const leaseId = `warm-${userHash(userId).slice(0, 24)}`;
  const result = await supabaseRpc('acquire_agent_vm_lease', {
    p_user_id: String(userId), p_lease_id: leaseId, p_kind: 'warm', p_vm_name: vmNameForUser(userId),
    p_expires_at: new Date(Date.now() + LEASE_TTL_MS).toISOString(),
  });
  const row = Array.isArray(result) ? result[0] : result;
  if (!row?.acquired) return { started: false, power: row?.power_state || 'stopping' };
  try {
    // Already up: the lease and its release only keep it from stopping before the task needs it.
    if (['running', 'starting'].includes(power)) return { started: false, power };
    await assertAccountActive(userId);
    await arm(cfg, 'POST', `${rgPath(cfg)}/providers/Microsoft.Compute/virtualMachines/${vmNameForUser(userId)}/start`, undefined, COMPUTE_API, { wait: false });
    console.info('[vm] prewarm', { vm: vmNameForUser(userId) });
    return { started: true, power: 'starting' };
  } finally {
    await supabaseRpc('release_agent_vm_lease', {
      p_user_id: String(userId), p_lease_id: leaseId, p_claim_token: crypto.randomUUID(),
      p_idle_until: new Date(Date.now() + cfg.idleMinutes * 60000).toISOString(),
    }).catch(() => {});
  }
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

// Ends the running command when it has run for over ten minutes, longer than any command
// of ours takes, so it is stuck rather than working. Azure shows no status for it and only
// ends it after 90 minutes; a managed Run Command runs alongside it and ends its processes.
const UNSTICK_SCRIPT = [
  "P=$(pgrep -of '/var/lib/waagent/run-command/download/[0-9]+/script.sh')",
  '[ -n "$P" ] || { echo IDLE; exit 0; }',
  'AGE=$(ps -o etimes= -p "$P" | tr -d " ")',
  'if [ "${AGE:-0}" -lt 600 ]; then echo "BUSY $AGE"; exit 0; fi',
  'tree() { for C in $(pgrep -P "$1"); do tree "$C"; done; echo "$1"; }',
  'kill -KILL $(tree "$P") 2>/dev/null',
  'echo CLEARED',
].join('\n');

async function clearStuckRunCommand(cfg, name) {
  const vmPath = `${rgPath(cfg)}/providers/Microsoft.Compute/virtualMachines/${name}`;
  const vm = await arm(cfg, 'GET', vmPath, undefined, COMPUTE_API);
  // Azure queues requests on a busy VM; while an earlier one is still pending, another would
  // only queue behind it.
  const current = await arm(cfg, 'GET', `${vmPath}/runCommands/lingon-unstick`, undefined, COMPUTE_API).catch(() => null);
  if (current && !/succeeded|failed|canceled/i.test(current.properties?.provisioningState || '')) return false;
  // The marker makes each request a new run, and tells this run's output from the last one's.
  const run = `RUN_${Date.now()}`;
  await arm(cfg, 'PUT', `${vmPath}/runCommands/lingon-unstick`, {
    location: vm.location,
    properties: { source: { script: `echo ${run}\n${UNSTICK_SCRIPT}` }, asyncExecution: false, timeoutInSeconds: 60 },
  // Azure completes this request only once the stuck command has ended; the script's own
  // status (below) reports sooner.
  }, COMPUTE_API, { wait: false });
  for (let i = 0; i < 30; i++) {
    const view = await arm(cfg, 'GET', `${vmPath}/runCommands/lingon-unstick?$expand=instanceView`, undefined, COMPUTE_API);
    const iv = view.properties?.instanceView || {};
    const output = String(iv.output || '');
    if (output.includes(run) && /succeeded|failed|timed|cancel/i.test(iv.executionState || '')) return /\bCLEARED\b/.test(output);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return false;
}

async function runCommand(userId, script, { maxStdout = 12000, restore = true } = {}) {
  const cfg = azureConfig();
  const name = vmNameForUser(userId);
  const key = String(userId);
  const pending = restore ? pendingRestore.get(key) : null;
  if (pending) script = `${buildRestorePrelude((await createDurableStateTransfer(userId)).url)}\n${script}`;
  const path_ = `${rgPath(cfg)}/providers/Microsoft.Compute/virtualMachines/${name}/runCommand`;
  // Azure runs one command per VM at a time. Another one (a workspace restore right after
  // the VM starts, a backup) makes a new command fail at once; it waits its turn instead.
  // A command stuck for longer than any of ours runs (Azure only ends it after 90 minutes)
  // would block every tool, so it is ended once (see clearStuckRunCommand).
  const busy = (error) => /run command extension execution is in progress|another operation is in progress|conflict/i.test(String(error && error.message));
  let cleared = false;
  for (let attempt = 0; ; attempt++) {
    await assertAccountActive(userId);
    try {
      const data = await arm(cfg, 'POST', path_, { commandId: 'RunShellScript', script: [script] }, COMPUTE_API);
      const out = parseRunOutput(data, { maxStdout });
      if (pending && !/Workspace restore failed/.test(out.stderr || '') && pendingRestore.get(key) === pending) {
        pendingRestore.delete(key);
        restoredState.set(key, pending);
      }
      return out;
    } catch (error) {
      if (!busy(error)) throw error;
      if (attempt >= 36) {
        if (cleared || !(await clearStuckRunCommand(cfg, name).catch(() => false))) throw error;
        cleared = true;
        attempt = 30; // a few more tries once the slot is free
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function waitWorkerReady(userId) {
  const key = String(userId);
  if (workerReadyState.has(key)) return true;
  // Waits while first boot is still running; once it has finished without the worker
  // (a failed bootstrap), prepares the container image here instead of failing every time.
  const image = shellQuote(workerImage());
  const out = await runCommand(userId, [
    'set +e',
    'for i in $(seq 1 90); do',
    '  if [ -f /var/lib/lingon-worker/ready ]; then echo READY; exit 0; fi',
    '  cloud-init status 2>/dev/null | grep -q running || break',
    '  sleep 2',
    'done',
    'export DEBIAN_FRONTEND=noninteractive',
    'command -v podman >/dev/null 2>&1 || { apt-get update -q >/dev/null 2>&1; apt-get install -y -q podman uidmap slirp4netns fuse-overlayfs >/dev/null 2>&1; }',
    'install -d -m 700 /opt/lingon/worker /var/lib/lingon-worker',
    `echo '${workerContainerfileB64()}' | base64 -d > /opt/lingon/worker/Containerfile`,
    `podman image exists ${image} || podman pull ${image} >/tmp/lingon-worker-build.log 2>&1 || podman build -t ${image} /opt/lingon/worker >>/tmp/lingon-worker-build.log 2>&1`,
    `if podman image exists ${image}; then touch /var/lib/lingon-worker/ready; echo READY; exit 0; fi`,
    'echo "The worker container could not be prepared: $(tail -n 3 /tmp/lingon-worker-build.log 2>/dev/null | tr \'\\n\' \' \')" >&2',
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
  await assertAccountActive(userId);
  const cfg = azureConfig();
  if (!cfg.durableState) return { restored: false, disabled: true };
  const key = String(userId);
  if (vmId && restoredState.get(key) === vmId) return { restored: true, cached: true };
  const transfer = await createDurableStateTransfer(userId);
  const out = await runCommand(userId, buildRestoreStateScript(transfer.url), { maxStdout: 2000, restore: false });
  assertStateCommandSucceeded(out, 'STATE_RESTORED', 'AZURE_STATE_RESTORE');
  if (vmId) restoredState.set(key, vmId);
  pendingRestore.delete(key);
  return { restored: true };
}

async function snapshotDurableState(userId) {
  await assertAccountActive(userId);
  const cfg = azureConfig();
  if (!cfg.durableState) return { saved: false, disabled: true };
  const transfer = await createDurableStateTransfer(userId);
  // A disk that was never restored is restored before it is saved, so a backup can never
  // replace the owner's saved files with an empty workspace.
  const out = await runCommand(userId, `${buildRestorePrelude(transfer.url)}\n${buildSnapshotStateScript(transfer.url)}`, { maxStdout: 2000, restore: false });
  assertStateCommandSucceeded(out, 'STATE_SAVED', 'AZURE_STATE_SAVE');
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

// Stages a vault value in a private one-time blob for the VM browser to read
// and delete; the server deletes it too once the session command returns.
async function createSecretTransfer(userId, sessionId, value) {
  const cfg = azureConfig();
  const storage = await ensureScreenshotStorage(cfg);
  const keys = await arm(cfg, 'POST', `${storage.accountId}/listKeys`, {}, STORAGE_API);
  const accountKey = (keys.keys || []).find((key) => key.value)?.value;
  if (!accountKey) throw Object.assign(new Error('Azure Storage account key was not returned.'), { code: 'AZURE_STORAGE' });
  const blob = `${userHash(userId)}/${browserSessionId(sessionId)}-${crypto.randomUUID()}.v`;
  const writeUrl = blobServiceSas({ ...storage, accountKey, blob, permissions: 'cwd', minutes: 2 });
  const put = await fetch(writeUrl, { method: 'PUT', headers: { 'x-ms-version': BLOB_API, 'x-ms-blob-type': 'BlockBlob', 'content-type': 'text/plain; charset=utf-8' }, body: String(value) });
  if (!put.ok) throw Object.assign(new Error(`The vault value could not be handed to the VM (HTTP ${put.status}). Nothing was typed.`), { code: 'AZURE_BROWSER' });
  return { writeUrl, readUrl: blobServiceSas({ ...storage, accountKey, blob, permissions: 'rd', minutes: 2 }) };
}

// A browser step sent to the live streamer already running on the VM, over the session's
// Realtime channel: about a second plus the action, where a Run Command takes many seconds.
// The step is signed with a key only the server and that streamer hold; the streamer reports
// to a private blob. Null when no streamer takes the step within STEP_ACK_MS (none running
// yet, or an old one), so the caller runs it as a VM command. Once taken, the step is never
// run a second way: a lost result is an outcome to check, not a retry.
const STEP_ACK_MS = 2500, STEP_DONE_MS = 75000;
// Realtime forwards objects with their keys re-sorted, so a step is signed over a canonical
// form with sorted keys; the streamers check the same form.
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v === undefined ? null : v));
const signStep = (key, step) => crypto.createHmac('sha256', key).update(canon([step.id, step.action, step.url, step.event, step.uploadUrl, step.resultUrl, step.exp])).digest('hex');
function realtimeBroadcastUrl(live) {
  return String(live.url).replace(/^wss:/, 'https:').replace(/\/realtime\/v1\/websocket$/, '/realtime/v1/api/broadcast');
}
// A signed step for the session's streamer (the browser's, or the desktop's in its container).
// null when no streamer took it in time: the caller then starts one or uses a VM command.
async function streamerBrowserStep(userId, sb, args, live, { ackMs = STEP_ACK_MS, label = 'browser', build } = {}) {
  if (!live?.cmdKey || (args.event && args.event.secret)) return null;
  const [shot, report] = await Promise.all([createScreenshotTransfer(userId, args.sessionId), createScreenshotTransfer(userId, args.sessionId, 'json')]);
  const drop = () => Promise.all([shot, report].map((t) => fetch(t.url, { method: 'DELETE', headers: { 'x-ms-version': BLOB_API } }).catch(() => {})));
  const dropShot = () => fetch(shot.url, { method: 'DELETE', headers: { 'x-ms-version': BLOB_API } }).catch(() => {});
  const step = { id: crypto.randomUUID(), action: args.action, url: String(args.url || ''), event: args.event && typeof args.event === 'object' ? args.event : null,
    uploadUrl: shot.url, resultUrl: report.url, exp: Date.now() + STEP_DONE_MS, ...(build ? { build } : {}) };
  step.sig = signStep(live.cmdKey, step);
  const sent = await fetch(realtimeBroadcastUrl(live), { method: 'POST', headers: { apikey: live.key, Authorization: `Bearer ${live.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ topic: live.topic, event: 'step', payload: step, private: false }] }) }).catch(() => null);
  const started = Date.now();
  // A failed send may still have reached the streamer (an approved final click among them):
  // the claim below, not that reply, settles who takes the step, so it is claimed at once.
  let taken = false, claimAt = sent && sent.ok ? ackMs : 0;
  for (;;) {
    const waited = Date.now() - started;
    if (!taken && waited > claimAt) {
      // Giving up creates the step's result blob first, unless the streamer just did: then it
      // owns the step and its result is awaited, so the step never runs a second way.
      const cancel = await fetch(report.url, { method: 'PUT', headers: { 'x-ms-version': BLOB_API, 'x-ms-blob-type': 'BlockBlob', 'content-type': 'application/json', 'If-None-Match': '*' }, body: '{"cancelled":true}' }).catch(() => null);
      // The cancel marker stays: deleting it would let a streamer whose claim is still in
      // flight create the blob after all and run the step while the caller runs it again.
      if (cancel && cancel.status === 201) { await dropShot(); return null; }
      // Only "it already exists" means the streamer owns the step. A network or storage
      // error says nothing either way, so the claim is tried again shortly.
      if (cancel && (cancel.status === 409 || cancel.status === 412)) taken = true;
      else claimAt = waited + 1000;
    }
    if (waited > STEP_DONE_MS) {
      await drop();
      throw Object.assign(new Error(taken
        ? `The ${label} took this step but did not report its result. Check the screen before repeating it.`
        : `Whether the ${label} took this step could not be checked. Check the screen before repeating it.`), { code: label === 'computer' ? 'AZURE_DESKTOP' : 'AZURE_BROWSER' });
    }
    await new Promise((resolve) => setTimeout(resolve, waited < 4000 ? 200 : 400));
    const got = await fetch(report.url, { headers: { 'x-ms-version': BLOB_API } }).catch(() => null);
    if (!got || !got.ok) continue;
    const body = await got.json().catch(() => ({}));
    // Our own cancel marker (its 201 reply was lost): the streamer never took the step.
    if (body.cancelled === true && !body.done && !body.ack) { await dropShot(); return null; }
    taken = true;
    if (!body.done) continue;
    await fetch(report.url, { method: 'DELETE', headers: { 'x-ms-version': BLOB_API } }).catch(() => {});
    const { done, ...parsed } = body;
    if (parsed.ok === false) {
      await drop();
      throw Object.assign(new Error(parsed.error || `The ${label} step failed on the user VM.`), { code: label === 'computer' ? 'AZURE_DESKTOP' : 'AZURE_BROWSER' });
    }
    const screenshot = await readAndDeleteScreenshot(shot);
    console.info(`[vm] ${label} step`, { via: 'streamer', action: step.action, ms: Date.now() - started });
    return { mode: 'azure', vmName: sb.vmName, ...parsed, screenshot };
  }
}

// A shell or code step sent to the VM's shell agent (see shellAgent). Null when no agent took
// it in time (none running yet on this boot): the caller then runs it as a VM command, which
// also starts the agent. Once taken, a job never runs a second way.
const JOB_ACK_MS = 2500, JOB_DONE_MS = 150000;
const signJob = (key, job) => crypto.createHmac('sha256', key).update(canon([job.id, 'job', crypto.createHash('sha256').update(job.script).digest('hex'), job.resultUrl, job.exp])).digest('hex');
async function shellAgentJob(userId, script, live, { ackMs = JOB_ACK_MS, maxStdout = 12000, maxStderr = 4000 } = {}) {
  if (!live?.cmdKey) return null;
  // Nothing is sent yet: a storage error leaves the job to the VM command path.
  let report;
  try { report = await createScreenshotTransfer(userId, 'shell-agent', 'json'); } catch { return null; }
  const drop = () => fetch(report.url, { method: 'DELETE', headers: { 'x-ms-version': BLOB_API }, signal: AbortSignal.timeout(8000) }).catch(() => {});
  const job = { id: crypto.randomUUID(), script, resultUrl: report.url, exp: Date.now() + JOB_DONE_MS };
  job.sig = signJob(live.cmdKey, job);
  const sent = await fetch(realtimeBroadcastUrl(live), { method: 'POST', headers: { apikey: live.key, Authorization: `Bearer ${live.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ topic: live.topic, event: 'job', payload: job, private: false }] }), signal: AbortSignal.timeout(8000) }).catch(() => null);
  const started = Date.now();
  // A send that failed or timed out may still have arrived: the claim below, not that reply,
  // settles whether the agent runs the job, so it is claimed at once.
  let taken = false, claimAt = sent && sent.ok ? ackMs : 0;
  for (;;) {
    const waited = Date.now() - started;
    if (!taken && waited > claimAt) {
      const cancel = await fetch(report.url, { method: 'PUT', headers: { 'x-ms-version': BLOB_API, 'x-ms-blob-type': 'BlockBlob', 'content-type': 'application/json', 'If-None-Match': '*' }, body: '{"cancelled":true}', signal: AbortSignal.timeout(8000) }).catch(() => null);
      // The marker is left in place (see streamerBrowserStep): the caller runs this job
      // another way, so a late claim by the agent must keep failing.
      if (cancel && cancel.status === 201) return null;
      if (cancel && (cancel.status === 409 || cancel.status === 412)) taken = true;
      else claimAt = waited + 1000;
    }
    if (waited > JOB_DONE_MS) {
      await drop();
      throw Object.assign(new Error(taken
        ? 'The computer took this command but did not report its result. Check its files before running it again.'
        : 'Whether the computer took this command could not be checked. Check its files before running it again.'), { code: 'AZURE_SHELL' });
    }
    await new Promise((resolve) => setTimeout(resolve, waited < 4000 ? 150 : 400));
    const got = await fetch(report.url, { headers: { 'x-ms-version': BLOB_API }, signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!got || !got.ok) continue;
    const body = await got.json().catch(() => ({}));
    if (body.cancelled === true && !body.done && !body.ack) return null;
    taken = true;
    if (!body.done) continue;
    await drop();
    console.info('[vm] shell step', { via: 'agent', ms: Date.now() - started });
    return { stdout: String(body.stdout || '').replace(/\r?\n$/, '').slice(0, maxStdout), stderr: String(body.stderr || '').replace(/\r?\n$/, '').slice(0, maxStderr) };
  }
}

async function runBrowserSession(userId, sb, args) {
  const live = args.live ? liveRealtimeArgs(args.live) : null;
  const fast = live ? await streamerBrowserStep(userId, sb, args, live) : null;
  if (fast) return fast;
  const transfer = await createScreenshotTransfer(userId, args.sessionId);
  let secretTransfer = null;
  try {
    let event = args.event;
    if (event && event.secret && typeof event.text === 'string') {
      secretTransfer = await createSecretTransfer(userId, args.sessionId, event.text);
      event = { ...event, text: '', secretUrl: secretTransfer.readUrl };
    }
    const out = await runCommand(userId, buildBrowserSessionScript(args.action, { ...args, event, uploadUrl: transfer.url }), { maxStdout: 12000, maxStderr: 12000 });
    let parsed = null;
    try { parsed = JSON.parse(String(out.stdout || '').trim().split('\n').pop()); } catch {}
    if (!parsed || parsed.ok === false) {
      throw Object.assign(new Error(parsed?.error || out.stderr || out.stdout || 'Browser session failed on the user VM.'), { code: 'AZURE_BROWSER' });
    }
    const screenshot = await readAndDeleteScreenshot(transfer);
    return { mode: 'azure', vmName: sb.vmName, ...parsed, screenshot };
  } finally {
    await fetch(transfer.url, { method: 'DELETE', headers: { 'x-ms-version': BLOB_API } }).catch(() => {});
    if (secretTransfer) await fetch(secretTransfer.writeUrl, { method: 'DELETE', headers: { 'x-ms-version': BLOB_API } }).catch(() => {});
  }
}

// The computer (computer use): each step goes to the desktop container's streamer over the
// session's live channel. A step nobody takes starts the container first (the first use on a
// VM prepares its image, which takes a few minutes), then goes again.
const toolDesktopSessionId = (userId, sessionId) => `desk_${userHash(`desktop:${userId}:${sessionId || 'default'}`)}`;
async function runDesktopStep(userId, sb, args) {
  const live = liveRealtimeArgs(args.live);
  if (!live || !live.cmdKey) throw Object.assign(new Error('The computer needs the live view channel, which is not configured here.'), { code: 'DISABLED' });
  const event = args.event && typeof args.event === 'object' ? args.event : { type: 'screenshot' };
  if (event.secret) throw Object.assign(new Error('Saved logins are typed in the protected browser, not on the computer.'), { code: 'BAD_INPUT' });
  const step = { sessionId: args.sessionId, action: event.type === 'screenshot' ? 'inspect' : 'input', event };
  const done = (out) => ({ ...out, desktop: true });
  const fast = await streamerBrowserStep(userId, sb, step, live, { label: 'computer', build: DESKTOP_BUILD });
  if (fast) return done(fast);
  const out = await runCommand(userId, buildDesktopSessionScript({ sessionId: args.sessionId, live }), { maxStdout: 12000, maxStderr: 4000 });
  if (/\bDESKTOP_BUILDING\b/.test(out.stdout || '')) {
    throw Object.assign(new Error('The computer is being set up for its first use on this VM, which takes a few minutes. Do other steps (or use the browser) meanwhile and try the computer again shortly.'), { code: 'DESKTOP_PREPARING' });
  }
  if (/\bDESKTOP_BUSY\b/.test(out.stdout || '')) {
    throw Object.assign(new Error('Another of the owner\'s tasks is using the computer right now. Do other steps (or use the browser) meanwhile and try the computer again in a few minutes.'), { code: 'DESKTOP_BUSY' });
  }
  if (!/\bDESKTOP_READY\b/.test(out.stdout || '')) {
    throw Object.assign(new Error(String(out.stderr || '').trim().slice(-500) || `The computer did not start. ${String(out.stdout || '').trim().slice(-300)}`.trim()), { code: 'AZURE_DESKTOP' });
  }
  const started = await streamerBrowserStep(userId, sb, step, live, { label: 'computer', ackMs: 8000, build: DESKTOP_BUILD });
  if (!started) throw Object.assign(new Error('The computer started but did not answer. Try the step again.'), { code: 'AZURE_DESKTOP' });
  return done(started);
}

// Starts the VM for work that holds no lease (an approval card reading the checkout page, a
// live view action after its lease lapsed). A VM started this way used to be recorded nowhere,
// so the idle sweeper never stopped it. It is now recorded as running with the usual idle
// grace, exactly as when a lease is released.
async function ensureRunningUnleased(userId) {
  // Only a lease creates a VM: it restores the owner's files first and honours the token
  // check and AZURE_AUTO_PROVISION. A VM made here would run unrecorded and unrestored.
  const vm = await ensureRunning(userId, { create: false });
  if (!vm?.started || !isLeaseStoreConfigured()) return vm;
  const leaseId = `start:${crypto.randomUUID()}`;
  try {
    await supabaseRpc('acquire_agent_vm_lease', { p_user_id: String(userId), p_lease_id: leaseId, p_kind: 'agent',
      p_vm_name: vmNameForUser(userId), p_expires_at: new Date(Date.now() + LEASE_TTL_MS).toISOString() });
    await supabaseRpc('mark_agent_vm_running', { p_user_id: String(userId) });
    await releaseLease(userId, { leaseId, skipSnapshot: true });
  } catch (error) {
    console.warn('[vm] start outside a lease not recorded:', error.code || error.message);
  }
  return vm;
}

async function startBrowserRelay(userId, args = {}, { alreadyRunning = false } = {}) {
  const sb = await getSandbox(userId);
  if (sb.mode !== 'azure') {
    throw Object.assign(new Error('Live browser relay requires the user Azure VM.'), { code: 'DISABLED' });
  }
  if (!alreadyRunning) await ensureRunningUnleased(userId);
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

async function startDesktopRelay() {
  // The old WebSocket relay ran the desktop natively; the desktop now runs only in its
  // container and streams over the live channel (desktop_action).
  throw Object.assign(new Error('The computer runs over the live channel on the hosted app.'), { code: 'DISABLED' });
}

async function stopDesktopRelay(userId, sessionId) {
  if (!isAzureConfigured()) return { stopped: false, disabled: true };
  try {
    await runCommand(userId, buildDesktopStopScript(sessionId), { maxStdout: 1000, maxStderr: 1000 });
    return { stopped: true };
  } catch (error) {
    return { stopped: false, error: error.code || 'AZURE_DESKTOP' };
  }
}

async function execInSandbox(userId, tool, args = {}, { alreadyRunning = false, taskId } = {}) {
  const sb = await getSandbox(userId);
  const vmTools = new Set(['code_run', 'shell', 'browser_open', 'computer_screenshot', 'browser_action', 'browser_session', 'browser_relay', 'desktop_action']);
  if (!vmTools.has(tool)) return { mode: sb.mode, tool, note: 'executed by existing allowlisted tool path' };
  if (sb.mode !== 'azure') {
    throw Object.assign(new Error('This tool runs only inside the user Azure VM. Configure AZURE_* to enable it.'), { code: 'DISABLED' });
  }
  // A newly acquired agent lease already confirmed power state. Other callers
  // still verify it here before touching the VM.
  if (!alreadyRunning) await ensureRunningUnleased(userId);
  if (tool === 'code_run' || tool === 'shell') {
    const script = tool === 'shell' ? buildShellScript(args.command, taskId) : buildRunScript(args.language, args.code, taskId);
    // The script checks the worker image itself, so a ready VM needs one command, not a
    // readiness check first. Only a first boot still preparing the image waits for it.
    // The VM's shell agent runs it in a second or two. A VM whose restore check is still due
    // uses a VM command, which carries that check (and its storage link) instead.
    const live = args.live ? liveRealtimeArgs(args.live) : null;
    let out = live?.cmdKey && !pendingRestore.has(String(userId)) ? await shellAgentJob(userId, script, live) : null;
    if (!out || /Worker container (?:runtime|image) is not ready/.test(out.stderr || '')) {
      out = await runCommand(userId, live?.cmdKey ? `${shellAgentLaunch(live)}\n${script}` : script);
    }
    if (/Worker container (?:runtime|image) is not ready/.test(out.stderr || '')) {
      workerReadyState.delete(String(userId));
      await waitWorkerReady(userId);
      out = await runCommand(userId, script);
    }
    return tool === 'shell'
      ? { mode: 'azure', vmName: sb.vmName, tool: 'shell', ...out }
      : { mode: 'azure', vmName: sb.vmName, language: String(args.language || 'js'), ...out };
  }
  if (tool === 'browser_open' || tool === 'computer_screenshot') {
    return runBrowserSession(userId, sb, {
      sessionId: toolBrowserSessionId(userId, args.sessionId),
      action: 'navigate',
      url: args.url,
      live: args.live,
    });
  }
  if (tool === 'browser_action') {
    return runBrowserSession(userId, sb, {
      sessionId: toolBrowserSessionId(userId, args.sessionId),
      action: 'input',
      event: args.event,
      live: args.live,
    });
  }
  if (tool === 'browser_session') {
    return runBrowserSession(userId, sb, args);
  }
  if (tool === 'browser_relay') {
    return startBrowserRelay(userId, args, { alreadyRunning: true });
  }
  if (tool === 'desktop_action') {
    return runDesktopStep(userId, sb, { sessionId: toolDesktopSessionId(userId, args.sessionId), event: args.event, live: args.live });
  }
  return { mode: 'azure', vmName: sb.vmName, tool };
}

async function provisionUserVm(userId) {
  return ensureVm(userId, { create: true });
}

const accountErasure = createAzureAccountErasure({config:azureConfig,arm,userHash,vmNameForUser,storageAccountName});
const planAccountErasure = (owner,previous) => accountErasure.plan(owner,previous);
const eraseAccountWorkspace = async (owner,manifest) => {
  const result = await accountErasure.erase(owner,manifest);
  for (const map of [leases,restoredState,workerReadyState,pendingRestore]) map.delete(String(owner));
  return result;
};

module.exports = {
  assertAccountActive, planAccountErasure, eraseAccountWorkspace,
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
  browserKit,
  browserProfileRuntime,
  liveStreamer,
  desktopKit,
  desktopContainerfile,
  desktopStreamer,
  desktopStreamerSource,
  shellAgent,
  shellAgentLaunch,
  shellAgentJob,
  buildDesktopSessionScript,
  buildDesktopStopScript,
  toolDesktopSessionId,
  startDesktopRelay,
  stopDesktopRelay,
  buildBrowserSessionScript,
  buildCheckoutExportScript,
  exportCheckout,
  buildBrowserRelayScript,
  buildBrowserRelayStopScript,
  cloudInit,
  buildRestoreStateScript,
  buildSnapshotStateScript,
  assertStateCommandSucceeded,
  getSandbox,
  statusForUser,
  execInSandbox,
  startBrowserRelay,
  stopBrowserRelay,
  ensureInfrastructure,
  ensureVm,
  ensureRunning,
  prewarm,
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
