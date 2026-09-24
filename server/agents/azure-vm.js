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
      return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !PRIVATE_HOST.test(u.hostname);
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
    await cdp.send('Page.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
  }
  async function open(page, url) {
    if (!allowedRequest(url) || !/^https?:/i.test(url)) throw new Error('Only public http and https pages can be opened.');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await settle(page);
  }
  // A visible pointer, so people watching the live view can follow the agent.
  async function showPointer(page, x, y, pressed) {
    await page.evaluate((px, py, down) => {
      let dot = document.getElementById('__lingon_pointer');
      if (!dot) {
        dot = document.createElement('div');
        dot.id = '__lingon_pointer';
        dot.setAttribute('aria-hidden', 'true');
        dot.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(255,99,71,.35);border:2px solid #ff6347;transition:transform .12s;left:0;top:0';
        (document.body || document.documentElement).appendChild(dot);
      }
      dot.style.left = `${px}px`;
      dot.style.top = `${py}px`;
      dot.style.transform = down ? 'scale(.65)' : 'scale(1)';
    }, x, y, !!pressed).catch(() => {});
  }
  // Numbers every visible interactive element that is not covered by another
  // element, and lists them as "[ref] role "name" @x,y" for the model.
  async function snapshot(page, state = {}) {
    const read = () => page.evaluate((sensitivePattern) => {
      const sensitive = new RegExp(sensitivePattern, 'i');
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
        const name = (el.getAttribute('aria-label') || (label && label.textContent.trim()) || (tag === 'select' ? el.name : el.innerText) || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || (type === 'submit' || type === 'button' ? el.value : '') || '').trim().replace(/\s+/g, ' ').slice(0, 70);
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
      const links = [...document.querySelectorAll('a[href]')].slice(0, 5).map((a) => ({ t: (a.innerText || '').trim().slice(0, 60), h: a.href.slice(0, 160) }));
      return { elements, links, scrollY: Math.round(scrollY), pageHeight: document.documentElement.scrollHeight, text: document.body ? document.body.innerText.slice(0, 3000) : '' };
    }, SENSITIVE);
    // A page that is still navigating has no document yet; try once more.
    const data = await read().catch(() => sleep(700).then(read)).catch(() => ({ elements: [], links: [], text: '', scrollY: 0, pageHeight: 0 }));
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
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, guarded, select: el.tagName === 'SELECT' };
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
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
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
      return at;
    };
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
  return { allowedRequest, setupPage, open, snapshot, act, settle };
}

// Shell lines, run as root before a browser or desktop starts: the given user
// may reach the public internet and loopback only, never private networks, the
// Azure platform endpoint or instance metadata. Without a firewall nothing starts.
function networkGuard(user) {
  return [
    "command -v iptables >/dev/null 2>&1 || { echo 'iptables is required for the network guard' >&2; exit 1; }",
    `for NET in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 168.63.129.16/32; do iptables -C OUTPUT -m owner --uid-owner ${user} -d "$NET" -j REJECT 2>/dev/null || iptables -I OUTPUT -m owner --uid-owner ${user} -d "$NET" -j REJECT || exit 1; done`,
    `if command -v ip6tables >/dev/null 2>&1; then for NET in fc00::/7 fe80::/10; do ip6tables -C OUTPUT -m owner --uid-owner ${user} -d "$NET" -j REJECT 2>/dev/null || ip6tables -I OUTPUT -m owner --uid-owner ${user} -d "$NET" -j REJECT; done; fi`,
  ];
}
const BROWSER_NETWORK_GUARD = networkGuard('lingon-browser');

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
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const runner = [
    "const fs = require('fs');",
    "const path = require('path');",
    `const kit = (${browserKit.toString()})();`,
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
    "(async () => {",
    "  const portFile = path.join(profile, 'debug-port');",
    "  const freePort = () => new Promise((resolve, reject) => { const server = require('net').createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });",
    "  let port = Number(fs.existsSync(portFile) ? fs.readFileSync(portFile, 'utf8') : 0) || 0;",
    "  let browser; let reused = false;",
    "  try { const probe = await fetch('http://127.0.0.1:' + port + '/json/version'); if (!probe.ok) throw new Error('not ready'); browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + port }); reused = true; }",
    "  catch { port = await freePort(); fs.writeFileSync(portFile, String(port)); browser = await puppeteer.launch({ headless: true, executablePath, userDataDir: profile, args: ['--disable-dev-shm-usage', '--window-size=1280,900', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port] }); browser.process()?.unref?.(); }",
    "  try {",
    "    const pages = await browser.pages();",
    "    const page = pages[0] || await browser.newPage();",
    "    const pageState = {};",
    "    await kit.setupPage(page, pageState);",
    "    if (payload.action === 'navigate') await kit.open(page, payload.url);",
    "    else {",
    "      if (!reused && state.url && state.url !== 'about:blank' && kit.allowedRequest(state.url)) { await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}); if (Number.isFinite(state.scrollY)) await page.evaluate((y) => window.scrollTo(0, y), state.scrollY).catch(() => {}); }",
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
    "    const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 });",
    "    const upload = await fetch(payload.uploadUrl, { method: 'PUT', headers: { 'content-type': 'image/jpeg', 'x-ms-blob-type': 'BlockBlob' }, body: screenshot });",
    "    if (!upload.ok) throw new Error('Screenshot upload failed: HTTP ' + upload.status + ' ' + (await upload.text()).slice(0, 300));",
    "    fs.writeFileSync(stateFile, JSON.stringify({ url: snap.url, title: snap.title, scrollY: snap.scrollY }));",
    "    process.stdout.write(JSON.stringify({ ok: true, ...snap, screenshotBytes: screenshot.length }));",
    "  } finally { browser.disconnect(); }",
    "})().catch((error) => { process.stdout.write(JSON.stringify({ ok: false, error: String(error.message || error) })); process.exitCode = 1; });",
  ].join('\n');
  const codeB64 = Buffer.from(runner, 'utf8').toString('base64');
  return [
    'set +e',
    'id -u lingon-browser >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/lingon-browser --shell /usr/sbin/nologin lingon-browser',
    'install -d -m 700 -o lingon-browser -g lingon-browser /var/lib/lingon-browser /var/lib/lingon-browser/sessions',
    ...BROWSER_NETWORK_GUARD,
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
  const payload = { sessionId, relayUrl, token };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const runner = [
    "const fs = require('fs');",
    "const path = require('path');",
    "const WebSocket = require('/opt/lingon/node_modules/ws');",
    `const kit = (${browserKit.toString()})();`,
    "const payload = JSON.parse(Buffer.from(process.env.LINGON_BROWSER_RELAY_PAYLOAD, 'base64').toString('utf8'));",
    "const root = '/var/lib/lingon-browser/sessions';",
    "const profile = path.join(root, payload.sessionId);",
    "const stateFile = path.join(profile, 'state.json');",
    "const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
    "const findBrowser = () => ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));",
    "const send = (socket, value) => { try { if (socket && socket.readyState === 1) socket.send(JSON.stringify(value)); } catch {} };",
    "const connect = () => new Promise((resolve, reject) => { const socket = new WebSocket(payload.relayUrl); const timer = setTimeout(() => { try { socket.terminate(); } catch {} reject(new Error('relay connection timed out')); }, 15000); socket.once('open', () => { clearTimeout(timer); resolve(socket); }); socket.once('error', (error) => { clearTimeout(timer); reject(error); }); });",
    "(async () => {",
    "  fs.mkdirSync(profile, { recursive: true });",
    "  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { url: 'about:blank' };",
    "  const executablePath = findBrowser();",
    "  if (!executablePath) throw new Error('Chromium is not installed yet (first boot is still running).');",
    "  let puppeteer; try { puppeteer = require('/opt/lingon/node_modules/puppeteer-core'); } catch { throw new Error('VM browser runtime is not installed yet (first boot is still running).'); }",
    "  const portFile = path.join(profile, 'debug-port');",
    "  const freePort = () => new Promise((resolve, reject) => { const server = require('net').createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });",
    "  let port = Number(fs.existsSync(portFile) ? fs.readFileSync(portFile, 'utf8') : 0) || 0;",
    "  let browser;",
    "  try { const probe = await fetch('http://127.0.0.1:' + port + '/json/version'); if (!probe.ok) throw new Error('not ready'); browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + port }); }",
    "  catch { port = await freePort(); fs.writeFileSync(portFile, String(port)); browser = await puppeteer.launch({ headless: true, executablePath, userDataDir: profile, args: ['--disable-dev-shm-usage', '--window-size=1280,900', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port] }); browser.process()?.unref?.(); }",
    "  let socket = null; let stopping = false; let page;",
    "  try {",
    "    const pages = await browser.pages(); page = pages[0] || await browser.newPage();",
    "    const pageState = {};",
    "    await kit.setupPage(page, pageState);",
    "    if (!state.url || state.url === 'about:blank') { await page.goto('about:blank').catch(() => {}); } else if (kit.allowedRequest(state.url)) { await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}); if (Number.isFinite(state.scrollY)) await page.evaluate((y) => window.scrollTo(0, y), state.scrollY).catch(() => {}); }",
    "    const cdp = await page.target().createCDPSession(); await cdp.send('Page.enable');",
    "    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 72, maxWidth: 1280, maxHeight: 900, everyNthFrame: 1 });",
    "    cdp.on('Page.screencastFrame', ({ data, sessionId: frameId }) => { try { if (socket && socket.readyState === 1 && socket.bufferedAmount < 4000000) socket.send(Buffer.from(data, 'base64')); } catch {} cdp.send('Page.screencastFrameAck', { sessionId: frameId }).catch(() => {}); });",
    // Agent actions and inspections return the full page state (text and numbered
    // elements); the user's own input in the live view only needs url and title.
    "    const metadata = async (full) => { const s = full ? await kit.snapshot(page, pageState) : { url: page.url(), title: await page.title().catch(() => '') }; const scrollY = full ? s.scrollY : await page.evaluate(() => window.scrollY).catch(() => 0); fs.writeFileSync(stateFile, JSON.stringify({ url: s.url, title: s.title, scrollY })); return s; };",
    "    const dispatch = async (command) => { const action = String(command.action || 'inspect'); const ev = command.event || {}; if (action === 'navigate') await kit.open(page, String(command.url || '')); else if (action === 'input') { await kit.act(page, ev); if (ev.type === 'move') return { url: page.url() }; } else if (action === 'stop') { stopping = true; } else if (action !== 'inspect') throw new Error('Unsupported browser relay action.'); return metadata(action !== 'input' || ev.agent === true); };",
    "    while (!stopping) {",
    "      try { socket = await connect(); send(socket, { type: 'ready', sessionId: payload.sessionId }); send(socket, { type: 'meta', ...(await metadata(true)), state: 'idle' });",
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
    ...BROWSER_NETWORK_GUARD,
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

/*
 * Desktop kit for the VM desktop relay, serialized with toString() like
 * browserKit. It turns agent and user input into xdotool steps on the virtual
 * 1280x900 screen, the same size as the Canvas live view. Agent input pauses
 * like a person; the user's own input from the live view stays instant.
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
  return { WIDTH, HEIGHT, steps, combo };
}

// Packages for the virtual desktop. New VMs get them at first boot; older VMs
// install whatever is missing the first time the desktop starts.
const DESKTOP_PACKAGES = [['xvfb', 'Xvfb'], ['openbox', 'openbox'], ['xdotool', 'xdotool'], ['ffmpeg', 'ffmpeg'], ['x11-xserver-utils', 'xsetroot'], ['pcmanfm', 'pcmanfm'], ['mousepad', 'mousepad']];
// Chromium on the VM never downloads files and never stores passwords or cards.
const CHROMIUM_POLICY = '{"DownloadRestrictions":3,"PasswordManagerEnabled":false,"AutofillCreditCardEnabled":false,"AutofillAddressEnabled":false}';
const CHROMIUM_POLICY_SETUP = [
  `for DIR in /etc/chromium/policies/managed /etc/chromium-browser/policies/managed /etc/opt/chrome/policies/managed; do install -d -m 755 "$DIR"; printf '%s' '${CHROMIUM_POLICY}' > "$DIR/lingon.json"; done`,
  `if [ -d /var/snap/chromium/current ]; then install -d -m 755 /var/snap/chromium/current/policies/managed && printf '%s' '${CHROMIUM_POLICY}' > /var/snap/chromium/current/policies/managed/lingon.json || true; fi`,
];

/*
 * Starts the desktop relay: a virtual screen (Xvfb, display :7) with a small
 * window manager, run by the unprivileged lingon-desktop user behind the same
 * firewall as the browser. The relay streams the screen as JPEG frames over an
 * authenticated outbound WebSocket, like the browser relay, and applies input
 * with xdotool. Its apps are Chromium, a file manager and a text editor; there
 * is no terminal, because commands run in the sandboxed worker instead.
 */
function buildDesktopRelayScript(args = {}) {
  const sessionId = browserSessionId(args.sessionId);
  const relayUrl = String(args.relayUrl || '');
  const token = String(args.token || '');
  if (!/^wss?:\/\//i.test(relayUrl)) throw Object.assign(new Error('Desktop relay URL must be ws:// or wss://.'), { code: 'BAD_INPUT' });
  if (!/^[A-Za-z0-9._~-]{32,256}$/.test(token)) throw Object.assign(new Error('Desktop relay token is invalid.'), { code: 'BAD_INPUT' });
  const payloadB64 = Buffer.from(JSON.stringify({ sessionId, relayUrl, token }), 'utf8').toString('base64');
  const runner = [
    "const fs = require('fs');",
    "const path = require('path');",
    "const { spawn, execFile } = require('child_process');",
    "const WebSocket = require('/opt/lingon/node_modules/ws');",
    `const kit = (${desktopKit.toString()})();`,
    "const payload = JSON.parse(Buffer.from(process.env.LINGON_DESKTOP_PAYLOAD, 'base64').toString('utf8'));",
    "const HOME = '/home/lingon-desktop', SESSION = path.join(HOME, '.relay', payload.sessionId);",
    "const displayFile = path.join(SESSION, 'display');",
    "let DISPLAY = fs.existsSync(displayFile) ? fs.readFileSync(displayFile, 'utf8').trim() : '';",
    "if (!/^:\\d+$/.test(DISPLAY)) { let n = 10; while (fs.existsSync('/tmp/.X11-unix/X' + n) || fs.existsSync('/tmp/.X' + n + '-lock')) n++; DISPLAY = ':' + n; fs.writeFileSync(displayFile, DISPLAY); }",
    "const env = { ...process.env, DISPLAY, HOME, XDG_RUNTIME_DIR: path.join(SESSION, 'run') };",
    "fs.mkdirSync(env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 });",
    "fs.mkdirSync(path.join(HOME, 'Files'), { recursive: true });",
    "const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
    "const run = (cmd, args, timeout = 15000, input) => new Promise((resolve, reject) => { const child = execFile(cmd, args, { env, timeout }, (error, stdout, stderr) => error ? reject(new Error(String(stderr || error.message).trim().slice(0, 300))) : resolve(String(stdout).trim())); child.stdin.on('error', () => {}); child.stdin.end(input == null ? '' : String(input)); });",
    "const detach = (cmd, args) => { const child = spawn(cmd, args, { env, detached: true, stdio: 'ignore' }); child.on('error', () => {}); child.unref(); };",
    "const displayUp = () => run('xdotool', ['getdisplaygeometry'], 3000).then(() => true, () => false);",
    "const send = (socket, value) => { try { if (socket && socket.readyState === 1) socket.send(JSON.stringify(value)); } catch {} };",
    "const APPS = {",
    "  browser: () => { const bin = ['/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p)); if (!bin) throw new Error('Chromium is not installed yet (first boot is still running).'); return [bin, ['--user-data-dir=' + path.join(SESSION, 'chromium'), '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', '--window-position=0,0', '--window-size=' + kit.WIDTH + ',' + kit.HEIGHT]]; },",
    "  files: () => ['pcmanfm', [path.join(HOME, 'Files')]],",
    "  editor: () => ['mousepad', []],",
    "};",
    "let socket = null, stopping = false, ffmpeg = null;",
    "async function ensureDisplay() {",
    "  if (await displayUp()) return;",
    "  detach('Xvfb', [DISPLAY, '-screen', '0', kit.WIDTH + 'x' + kit.HEIGHT + 'x24', '-nolisten', 'tcp']);",
    "  for (let i = 0; i < 60 && !(await displayUp()); i++) await sleep(100);",
    "  if (!(await displayUp())) throw new Error('The virtual screen did not start.');",
    "  detach('openbox', []);",
    "  await run('xsetroot', ['-solid', '#20242e']).catch(() => {});",
    "}",
    // ffmpeg writes a stream of JPEG images; each one is sent as a binary frame.
    "function startFrames() {",
    "  if (stopping) return;",
    "  ffmpeg = spawn('ffmpeg', ['-loglevel', 'error', '-f', 'x11grab', '-framerate', '3', '-video_size', kit.WIDTH + 'x' + kit.HEIGHT, '-draw_mouse', '1', '-i', DISPLAY, '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '7', 'pipe:1'], { env, stdio: ['ignore', 'pipe', 'ignore'] });",
    "  const SOI = Buffer.from([0xff, 0xd8]), EOI = Buffer.from([0xff, 0xd9]);",
    "  let buffer = Buffer.alloc(0);",
    "  ffmpeg.stdout.on('data', (chunk) => {",
    "    buffer = Buffer.concat([buffer, chunk]);",
    "    for (;;) {",
    "      const start = buffer.indexOf(SOI);",
    "      if (start < 0) { buffer = Buffer.alloc(0); return; }",
    "      const end = buffer.indexOf(EOI, start + 2);",
    "      if (end < 0) { buffer = buffer.length > 4000000 ? Buffer.alloc(0) : buffer.subarray(start); return; }",
    "      const frame = buffer.subarray(start, end + 2); buffer = buffer.subarray(end + 2);",
    "      try { if (socket && socket.readyState === 1 && socket.bufferedAmount < 4000000) socket.send(frame); } catch {}",
    "    }",
    "  });",
    "  ffmpeg.on('error', () => {});",
    "  ffmpeg.on('exit', () => { ffmpeg = null; if (!stopping) setTimeout(startFrames, 1000); });",
    "}",
    "async function metadata() {",
    "  const title = await run('xdotool', ['getactivewindow', 'getwindowname']).catch(() => '');",
    "  const ids = (await run('xdotool', ['search', '--onlyvisible', '--name', '.']).catch(() => '')).split('\\n').filter(Boolean).slice(-15);",
    "  const windows = [];",
    "  for (const id of ids) { const name = (await run('xdotool', ['getwindowname', id]).catch(() => '')).slice(0, 100); if (name && !windows.includes(name)) windows.push(name); }",
    "  return { title: title.slice(0, 120) || 'Desktop', windows, desktop: true };",
    "}",
    // A vault fill names the window it was approved for; nothing is typed elsewhere.
    "async function execute(ev) {",
    "  if (ev.expectTitle) { const active = await run('xdotool', ['getactivewindow', 'getwindowname']).catch(() => ''); if (!active.toLowerCase().includes(String(ev.expectTitle).toLowerCase())) throw new Error('The active window is \"' + active.slice(0, 80) + '\", not the approved one. Nothing was typed.'); }",
    "  for (const step of kit.steps(ev)) {",
    "    if (step.sleep) await sleep(step.sleep);",
    "    else if (step.xdotool) await run('xdotool', step.xdotool, 15000 + (step.stdin ? step.stdin.length * 60 : 0), step.stdin);",
    "    else if (step.launch) { const [bin, args] = APPS[step.launch](); detach(bin, step.url ? [...args, step.url] : args); }",
    "  }",
    "}",
    "const dispatch = async (command) => { const action = String(command.action || 'inspect'); const ev = command.event || {}; if (action === 'input') { await execute(ev); if (ev.type === 'move') return { desktop: true }; if (ev.agent === true) await sleep(500); } else if (action === 'stop') { stopping = true; } else if (action !== 'inspect') throw new Error('Unsupported desktop relay action.'); return metadata(); };",
    "const connect = () => new Promise((resolve, reject) => { const ws = new WebSocket(payload.relayUrl); const timer = setTimeout(() => { try { ws.terminate(); } catch {} reject(new Error('relay connection timed out')); }, 15000); ws.once('open', () => { clearTimeout(timer); resolve(ws); }); ws.once('error', (error) => { clearTimeout(timer); reject(error); }); });",
    "(async () => {",
    "  await ensureDisplay();",
    "  startFrames();",
    "  while (!stopping) {",
    "    try { socket = await connect(); send(socket, { type: 'ready', sessionId: payload.sessionId }); send(socket, { type: 'meta', ...(await metadata()), state: 'idle' });",
    "      await new Promise((resolve) => { let queue = Promise.resolve(); socket.on('message', (raw) => { queue = queue.then(async () => { let command; try { command = JSON.parse(String(raw)); } catch { return; } if (command.type !== 'command') return; try { const result = await dispatch(command); send(socket, { type: 'result', id: command.id, ...result, state: 'idle' }); } catch (error) { send(socket, { type: 'result', id: command.id, ok: false, error: String(error.message || error) }); } }).catch(() => {}); }); socket.once('close', resolve); socket.once('error', resolve); });",
    "    } catch (error) { if (!stopping) await sleep(1000); } finally { try { socket?.close(); } catch {} socket = null; }",
    "  }",
    "  if (ffmpeg) ffmpeg.kill();",
    "})().catch((error) => { process.stderr.write(String(error.message || error)); process.exitCode = 1; });",
  ].join('\n');
  const codeB64 = Buffer.from(runner, 'utf8').toString('base64');
  const root = `/home/lingon-desktop/.relay/${sessionId}`;
  const missing = DESKTOP_PACKAGES.map(([pkg, cmd]) => `command -v ${cmd} >/dev/null 2>&1 || NEED="$NEED ${pkg}"`);
  return [
    'set -eu',
    'id -u lingon-desktop >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/lingon-desktop --shell /usr/sbin/nologin lingon-desktop',
    'NEED=""',
    ...missing,
    'if [ -n "$NEED" ]; then export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq --no-install-recommends $NEED fonts-dejavu-core >/dev/null; fi',
    'if [ ! -d /opt/lingon/node_modules/ws ]; then npm install --prefix /opt/lingon ws@8.21.3; fi',
    ...networkGuard('lingon-desktop'),
    ...CHROMIUM_POLICY_SETUP,
    `install -d -m 700 -o lingon-desktop -g lingon-desktop /home/lingon-desktop /home/lingon-desktop/.relay '${root}'`,
    `echo '${codeB64}' | base64 -d > '${root}/relay.js'`,
    `chown lingon-desktop:lingon-desktop '${root}/relay.js' && chmod 600 '${root}/relay.js'`,
    `if [ -f '${root}/relay.pid' ] && kill -0 "$(cat '${root}/relay.pid')" 2>/dev/null; then echo READY; exit 0; fi`,
    `runuser -u lingon-desktop -- env LINGON_DESKTOP_PAYLOAD='${payloadB64}' nohup node '${root}/relay.js' >> '${root}/relay.log' 2>&1 & echo $! > '${root}/relay.pid'`,
    `chown lingon-desktop:lingon-desktop '${root}/relay.pid' '${root}/relay.log' 2>/dev/null || true`,
    'sleep 2',
    `kill -0 "$(cat '${root}/relay.pid')" 2>/dev/null || { tail -c 600 '${root}/relay.log' >&2; exit 1; }`,
    'echo READY',
  ].join('\n');
}

function buildDesktopRelayStopScript(sessionId) {
  const id = browserSessionId(sessionId);
  const root = `/home/lingon-desktop/.relay/${id}`;
  return [
    'set +e',
    `if [ -f '${root}/relay.pid' ]; then kill "$(cat '${root}/relay.pid')" 2>/dev/null || true; fi`,
    `D=$(cat '${root}/display' 2>/dev/null)`,
    'case "$D" in :[0-9]*) pkill -u lingon-desktop -f "Xvfb $D " 2>/dev/null || true ;; esac',
    'sleep 1',
    `rm -rf '${root}'`,
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
    'id -u lingon-desktop >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/lingon-desktop --shell /usr/sbin/nologin lingon-desktop',
    'install -d -m 700 -o lingon-desktop -g lingon-desktop /home/lingon-desktop',
    'chown -R lingon-desktop:lingon-desktop /home/lingon-desktop',
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
    'id -u lingon-desktop >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/lingon-desktop --shell /usr/sbin/nologin lingon-desktop',
    'install -d -m 700 -o lingon-desktop -g lingon-desktop /home/lingon-desktop',
    'pkill -u lingon-browser chromium 2>/dev/null || true',
    'pkill -u lingon-desktop chromium 2>/dev/null || true',
    'sleep 1',
    'ARCHIVE=$(mktemp /tmp/lingon-state.XXXXXX.tar.gz)',
    'trap \'rm -f "$ARCHIVE"\' EXIT',
    "tar --exclude='*/Cache/*' --exclude='*/Code Cache/*' --exclude='*/GPUCache/*' --exclude='home/lingon-desktop/.relay' --exclude='home/lingon-desktop/.run' --exclude='home/lingon-desktop/.cache' -czf \"$ARCHIVE\" -C / home/lingon/workspace var/lib/lingon-browser/sessions home/lingon-desktop",
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
    ...DESKTOP_PACKAGES.map(([pkg]) => `  - ${pkg}`),
    '  - fonts-dejavu-core',
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
  await requireVmTokens(userId);
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
    await meterVm(userId);
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
      try { await snapshotDurableState(row.user_id); await deallocateVm(row.user_id); await meterVm(row.user_id, true); success = true; }
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

async function runBrowserSession(userId, sb, args) {
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

async function startDesktopRelay(userId, args = {}, { alreadyRunning = false } = {}) {
  const sb = await getSandbox(userId);
  if (sb.mode !== 'azure') {
    throw Object.assign(new Error('Computer use requires the user Azure VM.'), { code: 'DISABLED' });
  }
  if (!alreadyRunning) await ensureRunning(userId);
  const out = await runCommand(userId, buildDesktopRelayScript(args), { maxStdout: 2000, maxStderr: 4000 });
  if (!/\bREADY\b/.test(out.stdout || '')) {
    throw Object.assign(new Error(out.stderr || 'The desktop did not start.'), { code: 'AZURE_DESKTOP' });
  }
  return { mode: 'azure', vmName: sb.vmName, relay: 'x11-stream' };
}

async function stopDesktopRelay(userId, sessionId) {
  if (!isAzureConfigured()) return { stopped: false, disabled: true };
  try {
    await runCommand(userId, buildDesktopRelayStopScript(sessionId), { maxStdout: 1000, maxStderr: 1000 });
    return { stopped: true };
  } catch (error) {
    return { stopped: false, error: error.code || 'AZURE_DESKTOP' };
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
  browserKit,
  desktopKit,
  buildDesktopRelayScript,
  buildDesktopRelayStopScript,
  startDesktopRelay,
  stopDesktopRelay,
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
