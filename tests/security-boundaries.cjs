const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const express = require('express');
const { once } = require('node:events');
const { requestBodyLimit } = require('../server/request-limits');

function authFor(file) {
  const source = fs.readFileSync(file, 'utf8')
    .replace("import { createClient } from '@supabase/supabase-js';", "const { createClient } = require('@supabase/supabase-js');")
    .replace('export {', 'module.exports = {');
  const context = {
    module: { exports: {} },
    process: { env: { SUPABASE_URL: 'https://auth.example', SUPABASE_ANON_KEY: 'test-key' } },
    require: () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) } }) }),
  };
  vm.runInNewContext(source, context, { filename: file });
  return context.module.exports.requireAuth;
}

async function transport(app, edge) {
  if (edge) return { send: (path, init) => app.handle(new Request('https://app.example' + path, init)), close: async () => {} };
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    send: (path, init) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { ...init, redirect: 'manual', signal: AbortSignal.timeout(5000) }),
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

async function oauthRoutes(app, edge, helpers) {
  const file = edge ? 'src/lingon-server/index.js' : 'server/index.js';
  const source = fs.readFileSync(file, 'utf8');
  const routes = source.slice(source.indexOf('const OAUTH_STATE ='), source.indexOf('// Email one-time code'));
  let exchanges = 0;
  vm.runInNewContext(routes, {
    app, crypto, require, URLSearchParams, ...helpers,
    process: { env: { GOOGLE_CLIENT_ID: 'test-id', GOOGLE_CLIENT_SECRET: 'test-secret', SITE_URL: 'https://app.example' } },
    TERMS_VERSION: 'test-terms', termsAccepted: value => value === 'test-terms',
    rateLimit: () => (_req, _res, next) => next(),
    fetch: async url => {
      if (String(url).includes('/token')) { exchanges++; return Response.json({ access_token: 'google-token' }); }
      return Response.json({ email: 'owner@example.com', email_verified: true, sub: 'google-owner' });
    },
    adminClient: () => ({ auth: { admin: {
      createUser: async () => ({}),
      generateLink: async () => ({ data: { properties: { email_otp: '123456' } } }),
    } } }),
    pubClient: () => ({ auth: { verifyOtp: async () => ({ data: { session: { access_token: 'session-access', refresh_token: 'session-refresh' } } }) } }),
  }, { filename: file });
  const http = await transport(app, edge);
  const begin = async next => {
    const res = await http.send('/api/auth/oauth-url?' + new URLSearchParams({ terms_version: 'test-terms', next }));
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /^__Host-belna_oauth_/);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(cookie.includes(flag));
    assert.equal(res.headers.get('cache-control'), 'no-store');
    return { state: new URL((await res.json()).url).searchParams.get('state'), cookie: cookie.split(';')[0] };
  };
  const callback = (flow, cookie = flow.cookie) => http.send('/api/auth/google/callback?' + new URLSearchParams({ code: 'code', state: flow.state }), { headers: { cookie } });
  try {
    const flow = await begin('/settings?panel=billing');
    const other = await begin('/wallet');
    for (const cookie of ['', other.cookie, flow.cookie + '; ' + flow.cookie]) {
      const rejected = await callback(flow, cookie);
      assert.match(rejected.headers.get('location'), /^\/\?auth_error=/);
      assert.equal(exchanges, 0, 'wrong browser must not exchange or consume the code');
    }
    const success = await callback(flow);
    assert.equal(success.headers.get('location'), '/settings#access_token=session-access&refresh_token=session-refresh');
    assert.match(success.headers.get('set-cookie'), /Max-Age=0/);
    assert.match((await callback(flow)).headers.get('location'), /^\/\?auth_error=/, 'callback cannot be replayed');
    assert.equal(exchanges, 1);
    assert.match((await callback(other)).headers.get('location'), /^\/wallet#access_token=/, 'parallel tabs retain independent state');
    for (const malicious of ['/\\attacker.example', '//attacker.example', '/one/..//attacker.example', '/\t/attacker.example', 'https://attacker.example']) {
      const res = await callback(await begin(malicious));
      const location = res.headers.get('location');
      assert.equal(new URL(location, 'https://app.example').origin, 'https://app.example', malicious);
      assert.match(location, /^\/#access_token=/);
    }
  } finally { await http.close(); }
}

async function requests(app, edge) {
  const requireAuth = authFor(edge ? 'src/lingon-server/auth.js' : 'server/auth.js');
  if (!edge) app.use((req, res, next) => express.json({ limit: requestBodyLimit(req.method, req.path) })(req, res, next));
  app.post('/api/auth/signin', (req, res) => res.json({ length: req.body.value?.length }));
  app.post('/api/chat', requireAuth((req, res) => res.json({ user: req.user.id, length: req.body.value?.length })));
  app.get('/fail', requireAuth(async () => { await Promise.resolve(); throw new Error('database password must stay private'); }));
  app.get('/ok', requireAuth((_req, res) => res.json({ ok: true })));
  if (!edge) {
    // Exercise the actual application's terminal error middleware.
    const source = fs.readFileSync('server/index.js', 'utf8');
    const start = source.indexOf('app.use((error, req, res, next) =>');
    vm.runInNewContext(source.slice(start, source.indexOf("const { WebSocketServer }", start)), { app, console: { error() {} } });
  }
  const http = await transport(app, edge);
  const headers = { 'content-type': 'application/json', authorization: 'Bearer signed.jwt.token' };
  try {
    const response = await http.send('/fail', { headers });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Something went wrong. Please try again.' });
    assert.equal((await http.send('/ok', { headers })).status, 200, 'process remains responsive after rejected handler');
    assert.equal((await http.send('/ok')).status, 401);
    const body = JSON.stringify({ value: 'x'.repeat(2 * 1024 * 1024) });
    assert.equal((await http.send('/api/auth/signin', { method: 'POST', headers, body })).status, 413);
    const upload = await http.send('/api/chat', { method: 'POST', headers, body });
    assert.equal(upload.status, 200, 'legitimate attachment allowance is preserved');
    assert.equal((await upload.json()).length, 2 * 1024 * 1024);
    assert.equal((await http.send('/api/auth/signin', { method: 'POST', headers, body: '{invalid' })).status, 400);
    assert.equal((await http.send('/api/auth/signin', { method: 'POST', headers, body: 'null' })).status, 400);
    assert.equal((await http.send('/api/auth/signin', { method: 'POST', headers, body: JSON.stringify({ value: 'é'.repeat(600000) }) })).status, 413, 'limits count bytes, not characters');
  } finally { await http.close(); }
}

async function edgeStreams(createApp) {
  const app = createApp();
  const requireAuth = authFor('src/lingon-server/auth.js');
  app.post('/api/chat', requireAuth((_req, res) => res.json({ ok: true })));
  app.post('/limited', (_req, res, _next) => res.status(429).json({ error: 'rate limited' }));
  app.post('/api/auth/signin', (_req, res) => res.json({ ok: true }));
  app.post('/api/mail/webhook', (req, res) => res.send(req.rawText));
  app.post('/api/composio/webhook', (req, res) => res.send(req.rawText));
  for (const [path, status] of [['/api/chat', 401], ['/limited', 429], ['/missing', 404]]) {
    let pulls = 0, cancelled = false;
    const body = new ReadableStream({ pull() { pulls++; throw new Error('body should not be read'); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const res = await app.handle(new Request('https://app.example' + path, { method: 'POST', body, duplex: 'half' }));
    assert.equal(res.status, status);
    assert.equal(pulls, 0, 'reject before consuming untrusted body');
    assert.equal(cancelled, true);
  }
  for (const length of [null, '1', String(2 * 1024 * 1024)]) {
    let pulls = 0, cancelled = false;
    const body = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(256 * 1024)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const headers = length === null ? {} : { 'content-length': length };
    const res = await app.handle(new Request('https://app.example/api/auth/signin', { method: 'POST', body, headers, duplex: 'half' }));
    assert.equal(res.status, 413, 'chunked and false Content-Length cannot bypass limits');
    assert.ok(pulls <= 5, 'stops reading promptly at byte limit');
    assert.equal(cancelled, true);
  }
  const raw = '{ "signed" : "payload",\n "n": 1 }';
  const webhook = await app.handle(new Request('https://app.example/api/mail/webhook', { method: 'POST', body: raw }));
  assert.equal(await webhook.text(), raw, 'signature verification gets the unmodified payload');
  for (const path of ['/api/mail/webhook', '/api/composio/webhook']) {
    assert.equal((await app.handle(new Request('https://app.example' + path, { method: 'POST', body: 'x'.repeat(300 * 1024) }))).status, 413);
  }
  // Mounted conversation handlers must receive their parsed body and begin SSE
  // immediately, even while the authenticated handler is still running.
  let finish, requestSignal;
  const pending = new Promise(resolve => { finish = resolve; });
  app.use('/api/agent/conversation', requireAuth(async (req, res) => {
    requestSignal = req.signal;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify(req.body) + '\n\n');
    await pending;
    res.end();
  }));
  let timer;
  try {
    const response = await Promise.race([
      app.handle(new Request('https://app.example/api/agent/conversation', {
        method: 'POST', headers: { authorization: 'Bearer signed.jwt.token' }, body: '{"prompt":"hello"}',
      })),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('SSE headers were buffered')), 2000); }),
    ]);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    const reader = response.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: {"prompt":"hello"}\n\n');
    await reader.cancel();
    assert.equal(requestSignal.aborted, true, 'disconnect still cancels work after deferred body parsing');
  } finally { clearTimeout(timer); finish(); }
}

async function encryption() {
  const stores = [require('../server/store'), await import('../src/lingon-server/store.js')];
  const previous = process.env.ENCRYPTION_KEY;
  try {
    for (const store of stores) {
      delete process.env.ENCRYPTION_KEY;
      assert.throws(() => store.sealSecret('sensitive-token'), error => error.code === 'NOT_ENCRYPTED');
      process.env.ENCRYPTION_KEY = 'short';
      assert.throws(() => store.sealSecret('sensitive-token'), error => error.code === 'NOT_ENCRYPTED');
      process.env.ENCRYPTION_KEY = 'unit-test-encryption-key';
      const encrypted = store.sealSecret('sensitive-token');
      assert.equal(encrypted.alg, 'aes-256-gcm');
      assert.equal(store.openSecret(encrypted), 'sensitive-token');
      assert.ok(!JSON.stringify(encrypted).includes('sensitive-token'));
      assert.equal(store.openSecret({ alg: 'b64', data: Buffer.from('legacy').toString('base64') }), 'legacy', 'existing records remain readable for migration');
    }
  } finally { previous === undefined ? delete process.env.ENCRYPTION_KEY : process.env.ENCRYPTION_KEY = previous; }
}

async function main() {
  const { createApp } = await import('../src/lingon-server/express-shim.js');
  for (const edge of [false, true]) {
    const helpers = edge ? await import('../src/lingon-server/oauth-security.js') : require('../server/oauth-security');
    await oauthRoutes(edge ? createApp() : express(), edge, helpers);
    await requests(edge ? createApp() : express(), edge);
  }
  await edgeStreams(createApp);
  await encryption();
  console.log('security boundaries: OAuth, authentication errors, bounded requests, encryption: ok (Node + edge)');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
