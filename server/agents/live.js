/*
 * Live browser sessions backed by the user's Azure VM.
 *
 * The live path is a persistent CDP screencast relay, not a screenshot-per-
 * action loop and not VNC. Chromium stays open on the VM, starts
 * Page.startScreencast, and makes one authenticated outbound WebSocket to the
 * application. The application forwards binary JPEG frames to the user's
 * authenticated Canvas socket and forwards mouse/keyboard commands back to the
 * relay. The VM still has no inbound port.
 *
 * The old Run Command screenshot path remains as a compatibility fallback for
 * deployments that have not set LINGON_PUBLIC_ORIGIN yet.
 */
const crypto = require('crypto');
const { hostAllowed } = require('./sandbox');
const { entry } = require('./tracing');
const azure = require('./azure-vm');

const sessions = new Map();
const toolSessions = new Map();
const IDLE_MS = 600000;
const RELAY_WAIT_MS = 10000;
const MAX_FRAME_BYTES = 2000000;
let sweepTimer = null;

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function publicOrigin() {
  return String(process.env.LINGON_PUBLIC_ORIGIN || process.env.PUBLIC_APP_ORIGIN || process.env.SITE_URL || '').trim();
}

function relayUrlFor(s) {
  const origin = publicOrigin();
  if (!origin) return '';
  try {
    const u = new URL(origin);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = `/ws/live-vm/${encodeURIComponent(s.id)}`;
    u.search = '';
    u.searchParams.set('token', s.relayToken);
    return u.toString();
  } catch {
    return '';
  }
}

function broadcast(s, obj) {
  const msg = JSON.stringify(obj);
  for (const ws of s.viewers) {
    try { ws.readyState === 1 && ws.send(msg); } catch {}
  }
}

function broadcastBinary(s, frame) {
  for (const ws of s.viewers) {
    try {
      // Drop a stale frame rather than allowing a slow tab to build an
      // unbounded queue. The next screencast frame is always newer.
      if (ws.readyState === 1 && Number(ws.bufferedAmount || 0) < 4000000) ws.send(frame, { binary: true });
    } catch {}
  }
}

function broadcastFrame(s) {
  if (!s.screenshot) return;
  const frame = s.screenshot.replace(/^data:image\/[^;]+;base64,/, '');
  broadcast(s, { frame });
}

function rejectPending(s, error) {
  for (const [id, pending] of s.pending) {
    clearTimeout(pending.timer);
    pending.reject(error);
    s.pending.delete(id);
  }
}

function relayTokenMatches(s, token) {
  const expected = Buffer.from(String(s.relayToken || ''));
  const actual = Buffer.from(String(token || ''));
  return expected.length > 0 && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function resolveRelayWaiters(s, value) {
  const waiters = s.relayWaiters.splice(0);
  for (const waiter of waiters) {
    clearTimeout(waiter.timer);
    waiter.resolve(value);
  }
}

function waitForRelay(s, timeoutMs = RELAY_WAIT_MS) {
  if (s.relay && s.relay.readyState === 1) return Promise.resolve(true);
  return new Promise((resolve) => {
    const waiter = { resolve, timer: setTimeout(() => {
      const i = s.relayWaiters.indexOf(waiter);
      if (i >= 0) s.relayWaiters.splice(i, 1);
      resolve(false);
    }, timeoutMs) };
    s.relayWaiters.push(waiter);
  });
}

function attachRelay(id, token, ws) {
  const s = sessions.get(String(id));
  if (!s || !relayTokenMatches(s, token)) return false;
  if (s.relay && s.relay !== ws) {
    try { s.relay.close(); } catch {}
  }
  s.relay = ws;
  s.relayConnectedAt = Date.now();
  s.lastActive = Date.now();
  resolveRelayWaiters(s, true);
  return true;
}

function relayAuthorized(id, token) {
  const s = sessions.get(String(id));
  return !!s && relayTokenMatches(s, token);
}

function relayClosed(s, ws) {
  if (s.relay !== ws) return;
  s.relay = null;
  rejectPending(s, Object.assign(new Error('Browser live relay disconnected.'), { code: 'BROWSER_RELAY_CLOSED' }));
  if (s.viewers.size) broadcast(s, { state: 'reconnecting' });
}

function frameFromRelay(s, data) {
  const frame = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!frame.length || frame.length > MAX_FRAME_BYTES) return;
  s.lastFrame = frame;
  s.lastFrameAt = Date.now();
  // Keep the tool result contract useful for the model and older Canvas cards.
  // Canvas viewers receive the same frame as binary data and do not base64 it.
  s.screenshot = `data:image/jpeg;base64,${frame.toString('base64')}`;
  s.lastActive = Date.now();
  broadcastBinary(s, frame);
}

async function waitForFrame(s, since = 0, timeoutMs = 1200) {
  const until = Date.now() + timeoutMs;
  while ((!s.lastFrame || (since && (s.lastFrameAt || 0) <= since)) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 40));
  return !!s.lastFrame;
}

function updateFromRelay(s, out, trace) {
  if (!out || out.ok === false) {
    throw Object.assign(new Error(out?.error || 'Browser relay action failed.'), { code: 'AZURE_BROWSER_RELAY' });
  }
  s.url = out.url || s.url;
  s.title = out.title || '';
  s.text = out.text || '';
  s.links = Array.isArray(out.links) ? out.links : [];
  s.lastActive = Date.now();
  broadcast(s, { state: out.state || (s.userControl ? 'user' : 'idle'), url: s.url, title: s.title });
  trace && trace(entry('globe', `live VM page: ${(() => { try { return new URL(s.url).hostname; } catch { return 'browser'; } })()} · “${String(s.title).slice(0, 60)}”`));
  return s;
}

function onRelayMessage(s, ws, data, isBinary = false) {
  if (!s || s.relay !== ws) return;
  if (isBinary || Buffer.isBuffer(data) || data instanceof Uint8Array) {
    frameFromRelay(s, data);
    return;
  }
  let msg;
  try { msg = JSON.parse(String(data)); } catch { return; }
  if (msg.type === 'ready') {
    s.relayReady = true;
    broadcast(s, { state: s.userControl ? 'user' : 'idle', url: s.url, title: s.title, transport: 'cdp-screencast' });
  } else if (msg.type === 'meta' || msg.type === 'result') {
    if (msg.type === 'result' && msg.id && s.pending.has(msg.id)) {
      const pending = s.pending.get(msg.id);
      s.pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.ok === false) pending.reject(Object.assign(new Error(msg.error || 'Browser relay action failed.'), { code: 'AZURE_BROWSER_RELAY' }));
      else pending.resolve(msg);
    }
    if (msg.url) s.url = msg.url;
    if (msg.title) s.title = msg.title;
    if (typeof msg.text === 'string') s.text = msg.text;
    if (Array.isArray(msg.links)) s.links = msg.links;
    s.lastActive = Date.now();
    broadcast(s, { state: msg.state || (s.userControl ? 'user' : 'idle'), url: s.url, title: s.title, transport: 'cdp-screencast' });
  } else if (msg.type === 'error') {
    broadcast(s, { state: 'error', error: String(msg.error || 'Browser live relay error').slice(0, 300) });
  }
}

function sendRelayCommand(s, action, data = {}, timeoutMs = 20000) {
  if (!s.relay || s.relay.readyState !== 1) return Promise.resolve(null);
  const id = `cmd_${uid()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.pending.delete(id);
      reject(Object.assign(new Error('Browser live action timed out.'), { code: 'BROWSER_RELAY_TIMEOUT' }));
    }, timeoutMs);
    s.pending.set(id, { resolve, reject, timer });
    try {
      s.relay.send(JSON.stringify({ type: 'command', id, action, ...data }));
    } catch (error) {
      clearTimeout(timer);
      s.pending.delete(id);
      reject(error);
    }
  });
}

async function sweep() {
  const now = Date.now();
  for (const s of [...sessions.values()]) {
    if (s.viewers.size) s.lastActive = now;
    if (now - (s.lastRenewedAt || 0) > 45000) {
      await azure.renewLease(s.userId, { leaseId:s.id }).catch(() => {});
      s.lastRenewedAt = now;
    }
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
  const s = {
    id, remote: true, userId, url: 'about:blank', title: '', text: '', links: [], screenshot: '', lastFrame: null,
    working: false, userControl: false, viewers: new Set(), lastActive: Date.now(), lastRenewedAt:Date.now(), fail: false,
    relayToken: crypto.randomBytes(32).toString('base64url'), relay: null, relayReady: false, relayConnectedAt: 0,
    relayWaiters: [], pending: new Map(), transport: 'cdp-screencast',
  };
  sessions.set(id, s);
  ensureSweep();
  const relayUrl = relayUrlFor(s);
  if (relayUrl && typeof azure.startBrowserRelay === 'function') {
    try {
      await azure.startBrowserRelay(userId, { sessionId: id, relayUrl, token: s.relayToken }, { alreadyRunning: true });
      await waitForRelay(s);
    } catch (error) {
      trace && trace(entry('alert', `live relay unavailable: ${String(error.message || error).slice(0, 140)}`));
    }
  } else {
    trace && trace(entry('alert', 'live relay origin is not configured; using compatibility browser actions'));
  }
  trace && trace(entry('globe', `live session ${id.slice(0, 12)} started on the user VM`));
  return s;
}

async function forTool(userId, sessionId, trace, create = true) {
  const key = `${userId}:${sessionId || 'default'}`;
  const existing = toolSessions.get(key);
  if (existing && sessions.has(existing.id)) return existing;
  if (!create) throw Object.assign(new Error('Open a browser page before using browser_action.'), { code:'NO_BROWSER_SESSION' });
  const s = await start({ userId, trace });
  s.toolKey = key;
  toolSessions.set(key, s);
  return s;
}

async function updateFromVm(s, out, trace) {
  s.url = out.url || s.url;
  s.title = out.title || '';
  s.text = out.text || '';
  s.links = Array.isArray(out.links) ? out.links : [];
  s.screenshot = out.screenshot || s.screenshot;
  s.lastActive = Date.now();
  await azure.renewLease(s.userId, { leaseId:s.id }).catch(() => {});
  s.lastRenewedAt = Date.now();
  broadcast(s, { state: s.userControl ? 'user' : 'idle', url: s.url, title: s.title, transport: s.relay ? 'cdp-screencast' : 'compatibility' });
  broadcastFrame(s);
  trace && trace(entry('globe', `live VM page: ${(() => { try { return new URL(s.url).hostname; } catch { return 'browser'; } })()} · “${String(s.title).slice(0, 60)}”`));
  return s;
}

async function navigate(s, url, trace) {
  if (!hostAllowed(url)) throw Object.assign(new Error('host blocked by sandbox allowlist'), { code: 'HOST_BLOCKED' });
  if (s.userControl) throw Object.assign(new Error('The user is controlling this browser. Wait until they give it back.'), { code:'USER_CONTROL' });
  s.working = true;
  s.lastActive = Date.now();
  broadcast(s, { state: 'working', url });
  try {
    if (s.relay && s.relay.readyState === 1) {
      const frameAt = s.lastFrameAt || 0;
      const out = await sendRelayCommand(s, 'navigate', { url });
      if (out) { await waitForFrame(s, frameAt); return updateFromRelay(s, out, trace); }
    }
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
  if (s.relay && s.relay.readyState === 1) {
    const out = await sendRelayCommand(s, 'inspect');
    if (out) {
      updateFromRelay(s, out);
      return { url: s.url, title: s.title, text: s.text, links: s.links };
    }
  }
  if (!s.text && s.url !== 'about:blank') {
    const out = await azure.execInSandbox(s.userId, 'browser_session', { sessionId: s.id, action: 'inspect' });
    await updateFromVm(s, out);
  }
  return { url: s.url, title: s.title, text: s.text, links: s.links };
}

async function screenshot(s) {
  s.lastActive = Date.now();
  if (s.lastFrame) return Buffer.from(s.lastFrame);
  if (!s.screenshot) return null;
  const b64 = s.screenshot.replace(/^data:image\/[^;]+;base64,/, '');
  return Buffer.from(b64, 'base64');
}

async function input(s, ev) {
  s.lastActive = Date.now();
  if (!s.userControl) throw Object.assign(new Error('agent holds control — take over first'), { code: 'NO_CONTROL' });
  if (s.relay && s.relay.readyState === 1) {
    // Mouse moves are fire-and-forget to keep the pointer responsive. Clicks,
    // keys and scrolling still wait for a browser acknowledgement.
    if (ev?.type === 'move') {
      sendRelayCommand(s, 'input', { event: ev }, 5000).catch(() => {});
      return { url: s.url, title: s.title };
    }
    const out = await sendRelayCommand(s, 'input', { event: ev });
    if (out) return updateFromRelay(s, out);
  }
  const out = await azure.execInSandbox(s.userId, 'browser_session', { sessionId: s.id, action: 'input', event: ev || {} });
  await updateFromVm(s, out);
  return { url: s.url, title: s.title };
}

async function agentInput(s, ev, trace) {
  if (s.userControl) throw Object.assign(new Error('The user is controlling this browser. Wait until they give it back.'), { code:'USER_CONTROL' });
  s.working = true;
  broadcast(s, { state:'working', url:s.url });
  try {
    if (s.relay && s.relay.readyState === 1) {
      const frameAt = s.lastFrameAt || 0;
      const out = await sendRelayCommand(s, 'input', { event: ev || {} });
      if (out) { await waitForFrame(s, frameAt); return updateFromRelay(s, out, trace); }
    }
    const out = await azure.execInSandbox(s.userId, 'browser_session', { sessionId:s.id, action:'input', event:ev || {} });
    return await updateFromVm(s, out, trace);
  } finally {
    s.working = false;
    broadcast(s, { state:s.userControl ? 'user' : 'idle', url:s.url });
  }
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
  if (s.toolKey && toolSessions.get(s.toolKey) === s) toolSessions.delete(s.toolKey);
  if (!sessions.size && sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
  try { if (s.relay && s.relay.readyState === 1) await sendRelayCommand(s, 'stop', {}, 3000).catch(() => {}); } catch {}
  try { s.relay?.close(); } catch {}
  rejectPending(s, Object.assign(new Error('Browser live session ended.'), { code: 'BROWSER_SESSION_ENDED' }));
  for (const ws of s.viewers) { try { ws.close(); } catch {} }
  s.viewers.clear();
  if (typeof azure.stopBrowserRelay === 'function') await azure.stopBrowserRelay(s.userId, s.id).catch(() => {});
  await azure.releaseLease(s.userId, { leaseId: s.id });
}

module.exports = {
  start, forTool, navigate, content, screenshot, input, agentInput, takeOver, get, owned, stop,
  relayUrlFor, relayAuthorized, attachRelay, relayClosed, onRelayMessage,
};
