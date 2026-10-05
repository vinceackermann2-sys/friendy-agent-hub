const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const express = require('express');
const { once } = require('node:events');

// Route-level checks for the 2026-10-05 security review fixes, run against the Node
// server and the edge port: Shop Pay connect bound to its browser, sign-in code checks
// that secure a first confirmation and hold a durable limit, the public withdrawal form,
// and GitHub diff parameters. Each route is loaded from the real source with stubs.

function slice(file, from, to) {
  const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const a = source.indexOf(from), b = source.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `${file}: ${from}`);
  return source.slice(a, b);
}

async function transport(app, edge) {
  if (edge) return { send: (path, init) => app.handle(new Request('https://app.example' + path, init)), close: async () => {} };
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    send: (path, init) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { ...init, redirect: 'manual', signal: AbortSignal.timeout(5000) }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function withApp(edge, createApp, file, from, to, context, run) {
  const app = edge ? createApp() : express();
  if (!edge) app.use(express.json());
  vm.runInNewContext(slice(file, from, to), { app, URLSearchParams, URL, Date, console, rateLimit: () => (_req, _res, next) => next(), ...context }, { filename: file });
  const http = await transport(app, edge);
  try { await run(http); } finally { await http.close(); }
}

async function shopPay(edge, createApp, file, helpers) {
  const finished = [];
  const state = crypto.randomBytes(24).toString('hex');
  const context = {
    ...helpers,
    requireAuth: (handler) => async (req, res) => { req.user = { id: 'attacker' }; await req.readBody?.(); return handler(req, res); },
    siteOrigin: () => 'https://app.example',
    shopPayErr: () => 500,
    shoppay: {
      startConnect: async (userId, { origin }) => ({ url: `https://shop.example/oauth?state=${state}&origin=${encodeURIComponent(origin)}&for=${userId}` }),
      finishConnect: async (query) => { finished.push(query.state); return { userId: 'attacker' }; },
    },
  };
  await withApp(edge, createApp, file, "app.post('/api/shop-pay/connect'", "app.post('/api/shop-pay/disconnect'", context, async (http) => {
    const started = await http.send('/api/shop-pay/connect', json({}));
    assert.equal(started.status, 200);
    const cookie = started.headers.get('set-cookie');
    assert.match(cookie, new RegExp(`^__Host-belna_shop_${state}=`));
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax']) assert.ok(cookie.includes(flag));
    const callback = (headers = {}) => http.send(`/api/shop-pay/callback?code=c&state=${state}`, { headers });
    // The victim opens the attacker's link: their browser has no cookie for this flow.
    for (const other of ['', `__Host-belna_shop_${state}=forged.value`, `__Host-belna_oauth_${state}=${cookie.split(';')[0].split('=')[1]}`]) {
      const res = await callback(other ? { cookie: other } : {});
      assert.match(res.headers.get('location'), /shop_pay=error/);
      assert.match(decodeURIComponent(res.headers.get('location')), /in this browser/);
    }
    assert.deepEqual(finished, [], 'no Shop token is stored on the attacker account');
    const ok = await callback({ cookie: cookie.split(';')[0] });
    assert.equal(ok.headers.get('location'), '/app?shop_pay=connected');
    assert.match(ok.headers.get('set-cookie'), /Max-Age=0/);
    assert.deepEqual(finished, [state]);
  });
}

async function verifyCode(edge, createApp, file) {
  let limited = false, secureFails = false;
  const calls = [];
  const context = {
    durableLimited: async (limits) => { calls.push(['limits', JSON.parse(JSON.stringify(limits.map(([key, max, windowSeconds]) => [key.replace(/:[^:]*$/, ''), max, windowSeconds])))]); return limited; },
    normalEmail: (value) => String(value || '').trim().toLowerCase(),
    TOO_MANY_ATTEMPTS: 'Too many attempts.',
    pubClient: () => ({ auth: { verifyOtp: async (input) => { calls.push(['verify', input.email]); return { data: { session: { access_token: 'access', refresh_token: 'refresh' }, user: { id: 'u1', email: input.email } } }; } } }),
    adminClient: () => ({ admin: true }),
    authEmail: {
      wasUnconfirmed: async (email) => { calls.push(['unconfirmed?', email]); return true; },
      secureFirstSignIn: async (_admin, user, options) => {
        calls.push(['secure', user.id, JSON.parse(JSON.stringify(options))]);
        if (secureFails) throw Object.assign(new Error('We couldn’t finish securing your account.'), { status: 503 });
        return true;
      },
    },
  };
  await withApp(edge, createApp, file, "app.post('/api/auth/verify'", '// ---------- billing', context, async (http) => {
    const ok = await http.send('/api/auth/verify', json({ email: 'a@example.com', token: '123456', password: 'chosen-password' }));
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).access_token, 'access');
    assert.deepEqual(calls[0], ['limits', [['verify:ip', 30, 600], ['verify:email', 10, 900]]]);
    assert.deepEqual(calls.slice(1).map((c) => c[0]), ['unconfirmed?', 'verify', 'secure']);
    assert.deepEqual(calls[3][2], { wasUnconfirmed: true, password: 'chosen-password' });
    // If the account cannot be secured, no session is handed out.
    secureFails = true;
    const failed = await http.send('/api/auth/verify', json({ email: 'a@example.com', token: '123456' }));
    assert.equal(failed.status, 503);
    assert.doesNotMatch(await failed.text(), /access/);
    secureFails = false;
    // Over the durable limit, the code is not even checked.
    limited = true; calls.length = 0;
    const blocked = await http.send('/api/auth/verify', json({ email: 'a@example.com', token: '000000' }));
    assert.equal(blocked.status, 429);
    assert.equal(calls.some((c) => c[0] === 'verify'), false);
  });
}

async function withdrawal(edge, createApp, file) {
  let recent = 0, limited = false;
  const inserted = [], sent = [];
  const admin = {
    from: () => ({
      select: (_cols, opts) => opts?.head
        ? { eq: () => ({ gte: async () => ({ count: recent, error: null }) }) }
        : null,
      insert: (row) => { inserted.push(row); return { select: () => ({ single: async () => ({ data: { id: 'wr_1', received_at: '2026-10-05T12:00:00Z' }, error: null }) }) }; },
      update: () => ({ eq: async () => ({}) }),
    }),
  };
  const context = {
    durableLimited: async () => limited,
    TOO_MANY_ATTEMPTS: 'Too many attempts.',
    adminClient: () => admin,
    process: { env: { RESEND_API_KEY: 're_test' } },
    fetch: async (_url, init) => { sent.push(JSON.parse(init.body)); return new Response('{}'); },
  };
  await withApp(edge, createApp, file, "app.post('/api/legal/withdrawal'", '// ---------- auth (proxy', context, async (http) => {
    const body = { email: 'victim@example.com', purchase_kind: 'other', purchase_reference: 'URGENT: your account is locked, visit https://evil.example' };
    const ok = await http.send('/api/legal/withdrawal', json(body));
    assert.equal(ok.status, 202);
    assert.equal(inserted[0].purchase_reference, body.purchase_reference, 'staff still see the reference');
    assert.equal(sent.length, 1);
    assert.doesNotMatch(sent[0].text, /evil\.example|URGENT/, 'text typed into the form is not emailed to the address it names');
    assert.match(sent[0].text, /wr_1/);
    recent = 3;
    assert.equal((await http.send('/api/legal/withdrawal', json(body))).status, 429, 'at most three receipts a day per address');
    recent = 0; limited = true;
    assert.equal((await http.send('/api/legal/withdrawal', json(body))).status, 429);
    assert.equal(sent.length, 1);
  });
}

async function githubDiff(edge, createApp, file) {
  const fetched = [];
  const context = {
    requireAuth: (handler) => async (req, res) => { req.user = { id: 'u1' }; return handler(req, res); },
    requestSignal: () => undefined,
    fetchAllowlisted: async (url) => { fetched.push(url); return new Response('diff --git a b'); },
  };
  await withApp(edge, createApp, file, "app.get('/api/github/diff'", 'function shopPayErr', context, async (http) => {
    const get = (repo, number) => http.send('/api/github/diff?' + new URLSearchParams({ repo, number }), { headers: { 'x-github-token': 'ghp_test' } });
    assert.equal((await get('owner/repo', '12')).status, 200);
    for (const [repo, number] of [['owner/repo/../../user', '1'], ['../user', '1'], ['owner/..', '1'], ['owner', '1'], ['owner/repo?x=1', '1'], ['owner/repo', '1/files'], ['owner/repo', '-1']]) {
      assert.equal((await get(repo, number)).status, 400, `${repo} ${number}`);
    }
    assert.deepEqual(fetched, ['https://api.github.com/repos/owner/repo/pulls/12']);
  });
}

async function main() {
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'unit-test-service-key';
  const { createApp } = await import('../src/lingon-server/express-shim.js');
  for (const edge of [false, true]) {
    const file = edge ? 'src/lingon-server/index.js' : 'server/index.js';
    const helpers = edge ? await import('../src/lingon-server/oauth-security.js') : require('../server/oauth-security');
    await shopPay(edge, createApp, file, helpers);
    await verifyCode(edge, createApp, file);
    await withdrawal(edge, createApp, file);
    await githubDiff(edge, createApp, file);
  }
  console.log('security fixes: Shop Pay browser binding, secured first confirmation, durable sign-in limits, withdrawal receipts, GitHub paths: ok (Node + edge)');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
