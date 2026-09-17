/* Live browser sessions — the ACTUAL browser, streamed, interruptible.
   - One headless Chromium page per session (self-hosted sandbox).
   - Frames: CDP Page.startScreencast → JPEG frames fanned out to WS viewers.
   - Input: viewers send mouse/keyboard; applied ONLY while that session is in
     user-control (takeover). Agent navigation waits while the user holds it.
   - Idle sessions are reaped (90s) so browsers never leak.
*/
const { hostAllowed } = require('./sandbox');
const { entry } = require('./tracing');

const sessions = new Map(); // id -> { browser, page, cdp, userId, url, title, working, userControl, viewers:Set, lastActive, fail }
const IDLE_MS = 90000;
let sweepTimer = null;

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
function sweep() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastActive > IDLE_MS || s.fail) {
      try { s.cdp && s.cdp.detach().catch(() => {}); } catch {}
      try { s.browser && s.browser.close().catch(() => {}); } catch {}
      sessions.delete(id);
    }
  }
  if (!sessions.size && sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
}
function ensureSweep() {
  if (!sweepTimer) sweepTimer = setInterval(sweep, 15000);
}

async function start({ userId, trace }) {
  if (process.env.BROWSER_TOOL === 'off') throw Object.assign(new Error('browser tool disabled'), { code: 'DISABLED' });
  const puppeteer = require('puppeteer');
  const id = 'live_' + uid();
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const target = request.url();
    if (target === 'about:blank' || target.startsWith('data:') || hostAllowed(target)) request.continue().catch(() => {});
    else request.abort('blockedbyclient').catch(() => {});
  });
  const s = { id, browser, page, cdp: null, userId, url: 'about:blank', title: '', working: false, userControl: false, viewers: new Set(), lastActive: Date.now(), fail: false };
  try {
    s.cdp = await page.createCDPSession();
    s.cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      s.lastActive = Date.now();
      const msg = JSON.stringify({ frame: data });
      for (const ws of s.viewers) {
        try { ws.readyState === 1 && ws.send(msg); } catch {}
      }
      s.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await s.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 55, everyNthFrame: 2 });
  } catch (e) {
    s.fail = true;
    throw e;
  }
  sessions.set(id, s);
  ensureSweep();
  trace && trace(entry('globe', `live session ${id.slice(0, 12)} started (headless Chromium, streamed)`));
  return s;
}

function broadcast(s, obj) {
  const msg = JSON.stringify(obj);
  for (const ws of s.viewers) {
    try { ws.readyState === 1 && ws.send(msg); } catch {}
  }
}
async function navigate(s, url, trace) {
  if (!hostAllowed(url)) throw Object.assign(new Error('host blocked by sandbox allowlist'), { code: 'HOST_BLOCKED' });
  s.working = true;
  s.lastActive = Date.now();
  broadcast(s, { state: 'working', url });
  try {
    await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Takeover window: the user may grab control while the page settles.
    // The agent reads WHATEVER page is current afterwards — including where
    // the user navigated it. Honest handoff, not theater.
    for (let i = 0; i < 6 && s.userControl; i++) await new Promise((r) => setTimeout(r, 1000));
    if (s.userControl) trace && trace(entry('alert', 'user still holds control — agent continues with the current page'));
    await new Promise((resolve) => setTimeout(resolve, 800));
    s.url = s.page.url();
    s.title = await s.page.title().catch(() => '');
    trace && trace(entry('globe', `live navigate: ${new URL(s.url).hostname} · “${String(s.title).slice(0, 60)}”`));
    return s;
  } finally {
    s.working = false;
    s.lastActive = Date.now();
    broadcast(s, { state: s.userControl ? 'user' : 'idle', url: s.url, title: s.title });
  }
}

async function content(s) {
  s.lastActive = Date.now();
  const text = await s.page.evaluate(() => (document.body ? document.body.innerText.slice(0, 4000) : '')).catch(() => '');
  const links = await s.page.evaluate(() => [...document.querySelectorAll('a[href]')].slice(0, 10).map((a) => ({ t: a.innerText.slice(0, 80), h: a.href.slice(0, 200) }))).catch(() => []);
  return { url: s.url, title: s.title, text, links };
}

async function input(s, ev) {
  s.lastActive = Date.now();
  if (!s.userControl) throw Object.assign(new Error('agent holds control — take over first'), { code: 'NO_CONTROL' });
  const { page } = s;
  if (ev.type === 'move') await page.mouse.move(ev.x, ev.y).catch(() => {});
  else if (ev.type === 'click') {
    await page.mouse.move(ev.x, ev.y).catch(() => {});
    await page.mouse.click(ev.x, ev.y, { button: ev.button === 2 ? 'right' : 'left' }).catch(() => {});
  } else if (ev.type === 'key') {
    await page.keyboard.press(ev.key).catch(() => {});
  } else if (ev.type === 'type') {
    await page.keyboard.type(String(ev.text || '').slice(0, 200)).catch(() => {});
  } else if (ev.type === 'scroll') {
    await page.mouse.wheel(0, ev.dy || 0).catch(() => {});
  }
  s.url = page.url();
  s.title = await page.title().catch(() => s.title);
  return { url: s.url, title: s.title };
}

function takeOver(s, on) {
  s.userControl = !!on;
  s.lastActive = Date.now();
  broadcast(s, { state: s.userControl ? 'user' : (s.working ? 'working' : 'idle') });
  return { userControl: s.userControl };
}

function get(id) {
  return sessions.get(id) || null;
}
function owned(id, userId) {
  const s = sessions.get(id);
  return s && s.userId === userId ? s : null;
}
async function stop(s) {
  sessions.delete(s.id);
  try { await s.cdp.detach().catch(() => {}); } catch {}
  try { await s.browser.close().catch(() => {}); } catch {}
}

module.exports = { start, navigate, content, input, takeOver, get, owned, stop };
