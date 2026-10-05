// Browser steps over the live channel, on real Chrome: the server's step goes out as a signed
// broadcast, the VM's live streamer (the real serialized code) runs it in the page it holds and
// reports to a private blob, and the server returns the page state and screenshot. Realtime,
// Azure management and Blob storage are faked in memory; Chrome and the page are real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((file) => fs.existsSync(file));
if (!chrome) { console.log('browser steps: skipped (local Chrome unavailable)'); process.exit(0); }

const envNames = ['AZURE_TENANT_ID','AZURE_CLIENT_ID','AZURE_CLIENT_SECRET','AZURE_SUBSCRIPTION_ID','AZURE_RESOURCE_GROUP','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
const beforeEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
Object.assign(process.env, { AZURE_TENANT_ID:'tenant', AZURE_CLIENT_ID:'client', AZURE_CLIENT_SECRET:'secret', AZURE_SUBSCRIPTION_ID:'sub', AZURE_RESOURCE_GROUP:'rg', SUPABASE_URL:'https://db.test', SUPABASE_SERVICE_ROLE_KEY:'service' });
const azure = require('../server/agents/azure-vm');
const puppeteer = require('puppeteer-core');

const live = { url:'wss://abcdefghijklmnop.supabase.co/realtime/v1/websocket', key:'k'.repeat(30), topic:`live-${'a'.repeat(40)}`, cmdKey:crypto.randomBytes(32).toString('hex') };
// Realtime: sockets the streamer opens, and REST broadcasts delivered to them. Like the real
// service (Elixir), it forwards objects with their keys sorted, not in the order they were sent.
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const sockets = [];
class FakeSocket {
  constructor() { this.handlers = {}; this.readyState = 1; this.topic = ''; sockets.push(this); setImmediate(() => this.emit('open')); }
  on(event, fn) { (this.handlers[event] ||= []).push(fn); }
  emit(event, ...args) { for (const fn of this.handlers[event] || []) fn(...args); }
  send(raw) {
    const m = JSON.parse(raw);
    if (m.event === 'phx_join') { this.topic = m.topic; setImmediate(() => this.emit('message', JSON.stringify({ event:'phx_reply', ref:'1', payload:{ status:'ok' } }))); }
  }
}
// Blob storage with Put Blob's create-only condition.
const blobs = new Map();
let failClaims = 0;
const calls = { broadcasts:0, runCommands:0 };
const reply = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const realFetch = global.fetch;
global.fetch = async (input, options = {}) => {
  const url = String(input), method = String(options.method || 'GET');
  if (url.startsWith('https://db.test/rest/v1/account_deletions?')) return reply([]);
  if (url.includes('login.microsoftonline.com')) return reply({ access_token:'token', expires_in:3600 });
  if (url.endsWith('/realtime/v1/api/broadcast')) {
    calls.broadcasts++;
    for (const message of JSON.parse(options.body).messages) {
      for (const socket of sockets) if (socket.topic === `realtime:${message.topic}`) socket.emit('message', JSON.stringify({ event:'broadcast', payload:{ event:message.event, payload:sortKeys(message.payload) } }));
    }
    return reply({}, 202);
  }
  if (/\.blob\.core\.windows\.net\//.test(url)) {
    const key = new URL(url).pathname;
    if (method === 'PUT') {
      const headers = options.headers || {};
      if ((headers['If-None-Match'] || headers['if-none-match']) === '*' && failClaims > 0) { failClaims--; throw new TypeError('fetch failed'); }
      if ((headers['If-None-Match'] || headers['if-none-match']) === '*' && blobs.has(key)) return reply('exists', 412);
      blobs.set(key, Buffer.from(options.body instanceof Uint8Array ? options.body : String(options.body)));
      return reply('', 201);
    }
    if (method === 'DELETE') { blobs.delete(key); return reply('', 202); }
    return blobs.has(key) ? new Response(blobs.get(key), { status:200 }) : reply('missing', 404);
  }
  if (url.includes('/listKeys')) return reply({ keys:[{ value:Buffer.from('storage-key').toString('base64') }] });
  if (url.includes('Microsoft.Storage')) return reply({ id:'storage' });
  if (url.includes('/runCommand?')) {
    calls.runCommands++;
    // The VM's browser step uploads its screenshot, as the real script does.
    const payload = JSON.parse(Buffer.from(/LINGON_BROWSER_PAYLOAD='([^']+)'/.exec(JSON.parse(options.body).script[0])[1], 'base64').toString('utf8'));
    blobs.set(new URL(payload.uploadUrl).pathname, Buffer.from('jpeg'));
    return reply({ value:[{ code:'ComponentStatus/StdOut/succeeded', message:JSON.stringify({ ok:true, url:'about:blank', title:'Run Command', elements:[], text:'' }) }] });
  }
  return realFetch(input, options);
};

(async () => {
  const tempRoot = path.resolve(__dirname, '..', '.tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(tempRoot, 'steps-test-'));
  const runtime = azure.browserProfileRuntime(root, require);
  let browser;
  try {
    browser = await runtime.connectOrLaunch(puppeteer, chrome);
    const { page } = await runtime.session(browser, 'live_steps');
    await page.setContent('<title>Form</title><button onclick="document.title=\'clicked\';this.textContent=\'Done\';window.clicks=(window.clicks||0)+1">Press</button>');
    // The streamer as the VM runs it, with its modules and process supplied.
    const fakeProcess = { exit() {}, stderr:{ write() {} }, pid:process.pid, platform:process.platform };
    const load = (name) => name === 'process' ? fakeProcess : name.endsWith('/ws') ? FakeSocket : name.endsWith('/puppeteer-core') ? puppeteer : require(name);
    azure.liveStreamer(azure.browserKit(), runtime, { ...live, sessionId:'live_steps', root }, load);
    for (let i = 0; i < 50 && !sockets.some((s) => s.topic); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(sockets.some((s) => s.topic === `realtime:${live.topic}`), 'the streamer joined its channel');

    const step = (tool, args) => azure.execInSandbox('user-1', tool, { sessionId:'chat-1', live, ...args }, { alreadyRunning:true });
    let t = Date.now();
    const seen = await step('browser_session', { action:'inspect' });
    assert.match(seen.elements.join('\n'), /\[1\] button "Press"/);
    assert.match(seen.screenshot, /^data:image\/jpeg;base64,/, 'the screenshot comes back through the private blob');
    // An event with several fields: the channel re-sorts its keys, and the signature still holds.
    const clicked = await step('browser_action', { event:{ type:'click', ref:1, agent:true } });
    const ms = Date.now() - t;
    assert.equal(clicked.title, 'clicked');
    assert.match(clicked.text, /Done/);
    assert.equal(await page.evaluate(() => window.clicks), 1, 'the click ran once');
    assert.equal(calls.runCommands, 0, 'no VM command for either step');
    assert.ok(ms < 15000, `two steps took ${ms}ms`);
    assert.deepEqual([...blobs.keys()], [], 'step blobs are cleaned up');
    // A step the page refuses fails as it would in a VM command.
    await assert.rejects(step('browser_open', { url:'http://10.0.0.5/admin' }), /Only public http and https pages/);

    // Forged, replayed or given-up steps never run.
    const clicksBefore = await page.evaluate(() => window.clicks);
    const socket = sockets.find((s) => s.topic === `realtime:${live.topic}`);
    const blobUrl = (name) => `https://belnatest.blob.core.windows.net/browser-shots/${name}?sv=x`;
    const signed = (extra) => {
      const p = { id:crypto.randomUUID(), action:'input', url:'', event:{ type:'click', ref:1, agent:true }, uploadUrl:blobUrl(`${extra.name}.jpg`), resultUrl:blobUrl(`${extra.name}.json`), exp:Date.now() + 30000 };
      const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
      p.sig = crypto.createHmac('sha256', extra.key || live.cmdKey).update(canon([p.id, p.action, p.url, p.event, p.uploadUrl, p.resultUrl, p.exp])).digest('hex');
      return p;
    };
    const deliver = (p) => socket.emit('message', JSON.stringify({ event:'broadcast', payload:{ event:'step', payload:p } }));
    deliver(signed({ name:'forged', key:crypto.randomBytes(32).toString('hex') }));
    blobs.set(new URL(blobUrl('cancelled.json')).pathname, Buffer.from('{"cancelled":true}'));
    deliver(signed({ name:'cancelled' }));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(await page.evaluate(() => window.clicks), clicksBefore, 'a forged step and one the server gave up on do not run');
    assert.equal(blobs.has(new URL(blobUrl('forged.json')).pathname), false);
    const once = signed({ name:'once' });
    deliver(once); deliver(once);
    for (let i = 0; i < 100 && !String(blobs.get(new URL(blobUrl('once.json')).pathname) || '').includes('done'); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await page.evaluate(() => window.clicks), clicksBefore + 1, 'a replayed step runs once');

    // With no streamer on the channel, the step runs as a VM command after a short wait.
    t = Date.now();
    const fallback = await step('browser_session', { action:'inspect', live:{ ...live, topic:`live-${'b'.repeat(40)}` } });
    assert.equal(fallback.title, 'Run Command');
    assert.equal(calls.runCommands, 1);
    assert.ok(Date.now() - t < 5000, 'the fallback waits about 2.5 s, not the full step time');
    // A claim lost to a network error is tried again, not taken as the streamer owning the step.
    failClaims = 1; t = Date.now();
    const retried = await step('browser_session', { action:'inspect', live:{ ...live, topic:`live-${'c'.repeat(40)}` } });
    assert.equal(retried.title, 'Run Command');
    assert.equal(calls.runCommands, 2);
    assert.ok(Date.now() - t < 7000, 'a failed claim retries after a second, not the full step time');
    console.log('browser steps: over the live channel on real Chrome, signed and single-run, blob results, VM command fallback: ok');
  } finally {
    const pid = fs.existsSync(runtime.pidFile) ? fs.readFileSync(runtime.pidFile, 'utf8').trim() : '';
    if (browser) {
      if (process.platform === 'win32' && pid) {
        await browser.disconnect();
        const run = (cmd, args) => { try { return require('node:child_process').execFileSync(cmd, args, { encoding:'utf8' }); } catch { return ''; } };
        run('taskkill', ['/pid', pid, '/T', '/F']);
        for (let i = 0; i < 120 && run('tasklist', ['/FI', `PID eq ${pid}`, '/NH']).includes(` ${pid} `); i++) await new Promise((resolve) => setTimeout(resolve, 500));
      } else await browser.close().catch(() => {});
    }
    global.fetch = realFetch;
    for (const name of envNames) { if (beforeEnv[name] === undefined) delete process.env[name]; else process.env[name] = beforeEnv[name]; }
    if (root.startsWith(tempRoot + path.sep)) fs.rmSync(root, { recursive:true, force:true, maxRetries:process.platform === 'win32' ? 80 : 8, retryDelay:500 });
  }
  process.exit(process.exitCode || 0);
})().catch((error) => { console.error(error); process.exit(1); });
