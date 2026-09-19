/* Live browser sessions backed by the user's Azure VM.
   The application server never launches a browser for an Azure-backed user.
   Each session uses a persistent profile on that user's VM and returns capped
   screenshots/content through the existing WS viewer. Input is translated to
   a VM-side Puppeteer action, so takeover remains account-scoped. */
const { hostAllowed } = require('./sandbox');
const { entry } = require('./tracing');
const azure = require('./azure-vm');

const sessions = new Map();
const IDLE_MS = 90000;
let sweepTimer = null;

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function broadcast(s, obj) {
  const msg = JSON.stringify(obj);
  for (const ws of s.viewers) {
    try { ws.readyState === 1 && ws.send(msg); } catch {}
  }
}

function broadcastFrame(s) {
  if (!s.screenshot) return;
  const frame = s.screenshot.replace(/^data:image\/[^;]+;base64,/, '');
  broadcast(s, { frame });
}

async function sweep() {
  const now = Date.now();
  for (const s of [...sessions.values()]) {
    if (now - s.lastActive > IDLE_MS || s.fail) await stop(s);
  }
  if (!sessions.size && sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
}

function ensureSweep() {
  if (!sweepTimer) sweepTimer = setInterval(() => { sweep().catch(() => {}); }, 15000);
}

async function start({ userId, trace }) {
  if (process.env.BROWSER_TOOL === 'off') throw Object.assign(new Error('browser tool disabled'), { code: 'DISABLED' });
  if (!azure.isAzureConfigured()) throw Object.assign(new Error('Live browser requires the user Azure VM.'), { code: 'DISABLED' });
  const id = 'live_' + uid();
  await azure.acquireLease(userId, { leaseId: id, kind: 'browser' });
  const s = { id, remote: true, userId, url: 'about:blank', title: '', text: '', links: [], screenshot: '', working: false, userControl: false, viewers: new Set(), lastActive: Date.now(), fail: false };
  sessions.set(id, s);
  ensureSweep();
  trace && trace(entry('globe', `live session ${id.slice(0, 12)} started on the user VM`));
  return s;
}

async function updateFromVm(s, out, trace) {
  s.url = out.url || s.url;
  s.title = out.title || '';
  s.text = out.text || '';
  s.links = Array.isArray(out.links) ? out.links : [];
  s.screenshot = out.screenshot || s.screenshot;
  s.lastActive = Date.now();
  broadcast(s, { state: s.userControl ? 'user' : 'idle', url: s.url, title: s.title });
  broadcastFrame(s);
  trace && trace(entry('globe', `live VM page: ${new URL(s.url).hostname} · “${String(s.title).slice(0, 60)}”`));
  return s;
}

async function navigate(s, url, trace) {
  if (!hostAllowed(url)) throw Object.assign(new Error('host blocked by sandbox allowlist'), { code: 'HOST_BLOCKED' });
  s.working = true;
  s.lastActive = Date.now();
  broadcast(s, { state: 'working', url });
  try {
    const out = await azure.execInSandbox(s.userId, 'browser_session', { sessionId: s.id, action: 'navigate', url });
    return await updateFromVm(s, out, trace);
  } finally {
    s.working = false;
    s.lastActive = Date.now();
    broadcast(s, { state: s.userControl ? 'user' : 'idle', url: s.url, title: s.title });
  }
}

async function content(s) {
  s.lastActive = Date.now();
  if (!s.text && s.url !== 'about:blank') {
    const out = await azure.execInSandbox(s.userId, 'browser_session', { sessionId: s.id, action: 'inspect' });
    await updateFromVm(s, out);
  }
  return { url: s.url, title: s.title, text: s.text, links: s.links };
}

async function screenshot(s) {
  s.lastActive = Date.now();
  if (!s.screenshot) return null;
  const b64 = s.screenshot.replace(/^data:image\/[^;]+;base64,/, '');
  return Buffer.from(b64, 'base64');
}

async function input(s, ev) {
  s.lastActive = Date.now();
  if (!s.userControl) throw Object.assign(new Error('agent holds control — take over first'), { code: 'NO_CONTROL' });
  const out = await azure.execInSandbox(s.userId, 'browser_session', { sessionId: s.id, action: 'input', event: ev || {} });
  await updateFromVm(s, out);
  return { url: s.url, title: s.title };
}

function takeOver(s, on) {
  s.userControl = !!on;
  s.lastActive = Date.now();
  broadcast(s, { state: s.userControl ? 'user' : (s.working ? 'working' : 'idle') });
  return { userControl: s.userControl };
}

function get(id) { return sessions.get(id) || null; }
function owned(id, userId) {
  const s = sessions.get(id);
  return s && s.userId === userId ? s : null;
}

async function stop(s) {
  if (!s || !sessions.has(s.id)) return;
  sessions.delete(s.id);
  for (const ws of s.viewers) { try { ws.close(); } catch {} }
  s.viewers.clear();
  await azure.releaseLease(s.userId, { leaseId: s.id }).catch(() => {});
}

module.exports = { start, navigate, content, screenshot, input, takeOver, get, owned, stop };
