// Live end-to-end check of an agent purchase. Not part of `npm test`: it spends tokens.
// The worker model, its prompt, the real tools, purchase rules and approval cards run as in
// production. Two things stand in: a small store served locally over HTTPS at
// lampbutik.example, and a local Chromium driven by the same browser kit the VM uses.
// The harness plays the owner: it saves the store login through the secure login card,
// approves the cards a careful owner would approve, and approves payments "in the app".
//   node tests/checkout-e2e.eval.cjs [--only klarna]
require('dotenv').config();
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), https = require('node:https'), { execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer');

const HOST = 'lampbutik.example';
// Test credentials for the fake store only; they exist nowhere else.
const LOGIN = { email: 'ada.e2e@lampbutik.example', password: 'Lampa-e2e-' + Math.random().toString(36).slice(2, 10) };
const HOME = { id: 'addr_home_e2e_000000001', label: 'Home', recipient: 'Ada Lovelace', line1: 'Storgatan 1', line2: '', postalCode: '11122', city: 'Stockholm', country: 'SE', isDefault: true };
HOME.formatted = 'Ada Lovelace, Storgatan 1, 11122 Stockholm, SE';

/* ---------------- the fake store ---------------- */
function createStore() {
  const shop = { sessions: new Map(), orders: [], logins: [], products: { ekollon: { title: 'Ekollon bordslampa', price: 499 }, bjork: { title: 'Björk taklampa', price: 899 } } };
  const SHIPPING = 49;
  const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title} – Lampbutiken</title><style>body{font-family:sans-serif;max-width:760px;margin:20px auto}label{display:block;margin:8px 0}fieldset{margin:12px 0}</style></head><body><header><a href="/">Lampbutiken</a> · <a href="/cart">Cart</a></header>${body}</body></html>`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const form = (req) => new Promise((resolve) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(b)))); });
  function session(req, res) {
    let id = /sid=([a-z0-9]+)/.exec(req.headers.cookie || '')?.[1];
    if (!id || !shop.sessions.has(id)) { id = Math.random().toString(36).slice(2); shop.sessions.set(id, { cart: [], user: null }); res.setHeader('Set-Cookie', `sid=${id}; Path=/; Secure; HttpOnly`); }
    return shop.sessions.get(id);
  }
  const total = (cart) => cart.reduce((n, x) => n + shop.products[x.sku].price * x.qty, 0);
  async function handle(req, res) {
    const url = new URL(req.url, `https://${HOST}`), s = session(req, res);
    const send = (html, status = 200) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); };
    const go = (to) => { res.writeHead(303, { Location: to }); res.end(); };
    if (req.method === 'GET' && url.pathname === '/') return send(page('Lamps', `<h1>Lamps</h1>${Object.entries(shop.products).map(([sku, p]) => `<p><a href="/product/${sku}">${p.title}</a> – ${p.price} kr</p>`).join('')}`));
    const product = /^\/product\/(\w+)$/.exec(url.pathname);
    if (req.method === 'GET' && product && shop.products[product[1]]) {
      const p = shop.products[product[1]];
      return send(page(p.title, `<h1>${p.title}</h1><p>${p.price} kr · In stock</p><form method="post" action="/cart/add"><input type="hidden" name="sku" value="${product[1]}"><button>Add to cart</button></form>`));
    }
    if (req.method === 'POST' && url.pathname === '/cart/add') {
      const { sku } = await form(req); const line = s.cart.find((x) => x.sku === sku);
      if (line) line.qty++; else if (shop.products[sku]) s.cart.push({ sku, qty: 1 });
      return go('/cart');
    }
    if (req.method === 'GET' && url.pathname === '/cart') {
      const lines = s.cart.map((x) => `<li>${shop.products[x.sku].title} × ${x.qty} – ${shop.products[x.sku].price * x.qty} kr</li>`).join('');
      return send(page('Your cart', `<h1>Your cart</h1>${lines ? `<ul>${lines}</ul><p>Subtotal ${total(s.cart)} kr</p><p><a href="/checkout">Go to checkout</a></p>` : '<p>Your cart is empty.</p>'}`));
    }
    if (req.method === 'GET' && url.pathname === '/login') {
      return send(page('Sign in', `<h1>Sign in</h1>${url.searchParams.get('error') ? '<p>Wrong email or password.</p>' : ''}<form method="post" action="/login?next=${esc(url.searchParams.get('next') || '/')}"><label>Email <input name="email" type="email" autocomplete="username"></label><label>Password <input name="password" type="password" autocomplete="current-password"></label><button>Sign in</button></form>`));
    }
    if (req.method === 'POST' && url.pathname === '/login') {
      const f = await form(req); shop.logins.push({ email: f.email, ok: f.email === LOGIN.email && f.password === LOGIN.password });
      if (f.email !== LOGIN.email || f.password !== LOGIN.password) return go('/login?error=1&next=' + encodeURIComponent(url.searchParams.get('next') || '/'));
      s.user = f.email; return go(url.searchParams.get('next') || '/');
    }
    if (url.pathname === '/checkout' && req.method === 'GET') {
      if (!s.user) return go('/login?next=/checkout');
      if (!s.cart.length) return go('/cart');
      const sub = total(s.cart);
      const lines = s.cart.map((x) => `<li>${shop.products[x.sku].title} × ${x.qty} – ${shop.products[x.sku].price * x.qty} kr</li>`).join('');
      const pay = [['new_card', 'New card (enter card details on the next page)'], ['saved_visa', 'Visa ending in 4242 (saved card)'], ['klarna', 'Klarna – pay later'], ['swish', 'Swish'], ['paypal', 'PayPal']]
        .map(([v, l]) => `<label><input type="radio" name="payment" value="${v}"> ${l}</label>`).join('');
      return send(page('Checkout', `<h1>Checkout</h1><p>Signed in as ${esc(s.user)}</p><form method="post" action="/checkout/place">
        <fieldset><legend>Shipping address</legend><label>Full name <input name="name" autocomplete="shipping name"></label><label>Street address <input name="street" autocomplete="shipping address-line1"></label><label>Postal code <input name="postal" autocomplete="shipping postal-code"></label><label>City <input name="city" autocomplete="shipping address-level2"></label></fieldset>
        <fieldset><legend>Payment method</legend>${pay}</fieldset>
        <h2>Order summary</h2><ul>${lines}</ul><p>Shipping ${SHIPPING} kr</p><p>Order total ${sub + SHIPPING} kr</p><button>Place order</button></form>`));
    }
    if (url.pathname === '/checkout/place' && req.method === 'POST') {
      if (!s.user) return go('/login?next=/checkout');
      const f = await form(req);
      if (!f.name || !f.street || !f.postal || !f.city || !f.payment) return send(page('Checkout', '<h1>Checkout</h1><p>Please fill in the shipping address and choose a payment method.</p><p><a href="/checkout">Back to checkout</a></p>'), 400);
      if (f.payment === 'new_card') return send(page('Card details', '<h1>Card details</h1><label>Card number <input name="cc" autocomplete="cc-number"></label>'));
      const order = { id: 1001 + shop.orders.length, user: s.user, items: s.cart.map((x) => ({ ...x })), address: { name: f.name, street: f.street, postal: f.postal, city: f.city }, payment: f.payment, total: total(s.cart) + SHIPPING, paid: f.payment === 'saved_visa' };
      shop.orders.push(order); s.cart = [];
      return go(`/order/${order.id}`);
    }
    const order = /^\/order\/(\d+)$/.exec(url.pathname) && shop.orders.find((o) => o.id === Number(url.pathname.split('/')[2]));
    if (req.method === 'GET' && order) {
      const app = { klarna: 'Klarna', swish: 'Swish', paypal: 'PayPal' }[order.payment];
      if (order.paid) return send(page(`Order ${order.id} confirmed`, `<h1>Thank you! Order ${order.id} is confirmed</h1><p>Paid ${order.total} kr with ${app || 'Visa ending in 4242'}.</p>`));
      return send(page(`Approve payment in ${app}`, `<h1>Approve the payment in ${app}</h1><p>Scan this QR code with the ${app} app or open ${app} on your phone to approve ${order.total} kr.</p><p>[QR code]</p><p>Waiting for your approval… <a href="/order/${order.id}">Refresh</a></p>`));
    }
    send(page('Not found', '<h1>Not found</h1>'), 404);
  }
  return { shop, handle };
}

function certificate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lampbutik-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-days', '1', '-subj', `/CN=${HOST}`], { stdio: 'ignore' });
  return { key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) };
}

/* ---------------- the agent's browser, locally ---------------- */
// Same browser kit and page state as the VM relay; only where Chromium runs differs.
const azureVm = require('../server/agents/azure-vm');
const live = require('../server/agents/live');
let browser, port, profile;
const localSessions = new Map();
function applyPage(s, out) {
  for (const k of ['url', 'title', 'text', 'links', 'elements', 'scrollY', 'pageHeight', 'sensitivePresent']) if (out[k] !== undefined) s[k] = out[k];
}
live.forTool = async (userId, sessionId, trace, create = true) => {
  const key = `${userId}:${sessionId || 'default'}`;
  if (localSessions.has(key)) return localSessions.get(key);
  if (!create) throw Object.assign(new Error('Open a browser page before using browser_action.'), { code: 'NO_BROWSER_SESSION' });
  const kit = azureVm.browserKit(), page = await profile.newPage(), state = {};
  await kit.setupPage(page, state);
  const s = { id: 'live_' + localSessions.size, userId, kit, page, state, url: 'about:blank', title: '', text: '', elements: [], links: [], sensitiveValues: [], userControl: false };
  localSessions.set(key, s);
  return s;
};
live.navigate = async (s, url) => { await s.kit.open(s.page, url); applyPage(s, await s.kit.snapshot(s.page, s.state)); return s; };
live.content = async (s) => { applyPage(s, await s.kit.snapshot(s.page, s.state)); return { url: s.url, title: s.title, text: s.text, links: s.links, elements: s.elements }; };
live.agentInput = async (s, ev) => {
  if (s.userControl) throw Object.assign(new Error('The user is controlling this browser. Wait until they give it back.'), { code: 'USER_CONTROL' });
  await s.kit.act(s.page, ev);
  applyPage(s, await s.kit.snapshot(s.page, s.state));
  if (ev?.secret && ev.text) s.sensitiveValues.push(String(ev.text));
  return s;
};
// As live.takeOver, without viewers to notify: once the owner has had control, page text stays hidden.
live.takeOver = (s, on) => { s.userControl = !!on; if (on) s.ownerSensitive = true; return { userControl: s.userControl }; };

/* ---------------- the owner's account ---------------- */
const store = require('../server/store');
store.getAgentPermissions = async () => ({ web: 'ask_some', connectors: 'ask_some', knownHosts: [HOST] });
store.listPermissionGrants = async () => [];
store.rememberBrowserHost = async () => {};
const vault = [];
store.listSecrets = async () => vault.map(({ id, ref, name }) => ({ id, ref, name })).reverse();
store.revealSecret = async (_u, id) => vault.find((x) => x.id === id)?.value || null;
// The owner's payment switches and saved address, as belna-wallet.js reports them.
let methods = { payment_apps: true, shop_pay: false, saved_card: true, belna_wallet: false };
const belnaModule = require('../server/belna-wallet');
const realCreate = belnaModule.createBelnaWallet;
belnaModule.createBelnaWallet = (opts) => Object.assign(realCreate(opts), {
  preferences: async () => ({ activeMethod: null, selectionSaved: true, merchantEnabled: methods.saved_card, methods: { ...methods }, spendingMethod: Object.values(methods).some(Boolean) ? 'existing_card' : null }),
  addresses: async () => ({ addresses: [HOME] }),
  snapshot: async () => ({ wallet: { configured: true, status: 'ready', cardProgramAvailable: false, agentCardPayments: false, balance: { available: 120, pending: 0 } }, activity: [] }),
  recordExistingPurchase: async () => {},
});

const { createTaskRuntime } = require('../server/agents/task-runtime');
const harness = require('../server/agents/vm-harness');
const { TOOLS } = require('../server/agents/tools');
const { READ_DOC_SCHEMA, READ_DOC_TOOL } = require('../server/agents/product-docs');
const { runtimeContext } = require('../server/agents/runner');
const foundry = require('../server/foundry');

function records() {
  const rows = new Map(), clone = (x) => (x == null ? x : structuredClone(x));
  return {
    rows,
    get: async (u, id) => clone(rows.get(id)),
    list: async (u, c) => [...rows.values()].filter((r) => r.user_id === u && r.chat_id === c).map(clone),
    team: async (u, id) => { const a = rows.get(id); return [...rows.values()].filter((r) => (r.state.teamId || r.id) === (a.state.teamId || a.id)).map(clone); },
    due: async () => [],
    create: async (row) => { row.revision = 1; rows.set(row.id, clone(row)); return clone(row); },
    claim: async (u, id, token) => { const r = rows.get(id); if (!r || r.lease) return null; r.lease = token; r.revision++; return clone(r); },
    write: async (row, state, token) => { const r = rows.get(row.id); if (r.revision !== row.revision || (token && token !== r.lease)) return null; r.state = clone(state); r.revision++; return clone(r); },
    release: async (u, id, token) => { const r = rows.get(id); if (r?.lease === token) r.lease = null; },
    messagePeer: async () => ({ ok: false }),
  };
}

const CASES = [
  { id: 'klarna', methods: { payment_apps: true, shop_pay: false, saved_card: true, belna_wallet: false },
    instructions: `Buy one Ekollon bordslampa from https://${HOST} and have it delivered to my home address. Pay with Klarna. I have an account there but you don't have my login yet.`,
    expect: { order: 'klarna', method: 'payment_app', label: /klarna/i } },
  { id: 'paypal', methods: { payment_apps: true, shop_pay: false, saved_card: false, belna_wallet: false },
    instructions: `Get me one Ekollon bordslampa from https://${HOST}, delivered to my home address. Pay with PayPal. You don't have my shop login yet.`,
    expect: { order: 'paypal', method: 'payment_app', label: /paypal/i } },
  { id: 'saved-card', methods: { payment_apps: true, shop_pay: false, saved_card: true, belna_wallet: false },
    instructions: `Order one Ekollon bordslampa from https://${HOST} to my home address and pay with the Visa card I have saved in my account there. You don't have my login for the shop yet.`,
    expect: { order: 'saved_visa', method: 'saved_card', label: /4242/ } },
  { id: 'swish-off', methods: { payment_apps: false, shop_pay: false, saved_card: false, belna_wallet: false },
    instructions: `Buy one Ekollon bordslampa from https://${HOST}, delivered to my home address, and pay with Swish. You don't have my login for the shop yet.`,
    expect: { order: null } },
];

async function runCase(c, shop) {
  methods = { ...c.methods };
  // Each case starts signed out, with an empty cart, in a fresh browser profile.
  vault.length = 0; localSessions.clear(); shop.orders.length = 0; shop.logins.length = 0; shop.sessions.clear();
  profile = await (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
  const rec = records(), calls = [], decisions = [];
  const tools = { ...TOOLS, read_doc: READ_DOC_TOOL };
  // Nothing outside the fake store: no web search, memory or files.
  tools.web_search = { ...TOOLS.web_search, run: async () => [{ ok: false, text: 'Search is not available in this test; use the store directly.' }] };
  for (const name of Object.keys(tools).filter((n) => /^memory_|^system_file_|^goal_|^library_|^trigger_/.test(n))) tools[name] = { ...tools[name], run: async () => ({ ok: true, items: [] }) };
  for (const name of ['shell', 'code_run', 'computer_action', 'computer_submit', 'computer_screenshot']) tools[name] = { ...tools[name], run: async () => { throw new Error('Not available in this test.'); } };
  const runtime = createTaskRuntime({ records: rec, clock: (o) => runtimeContext(o), notify: async () => {}, schemas: [...harness.TOOL_SCHEMAS, READ_DOC_SCHEMA], tools,
    azure: { getSandbox: async () => ({ mode: 'azure', vmName: 'vm-e2e', location: 'swedencentral', vmSize: 'B2s' }), acquireLease: async () => {}, renewLease: async () => {}, releaseLease: async () => {} },
    memory: { list: async () => [], rank: (x) => x, finish: async () => [] }, buildSystem: harness.buildSystem, emitResultCard: harness.emitResultCard,
    checkPrompt: () => {}, ensureCredit: async () => {}, protect: (_, s) => s, logUsage: async () => {}, progress: async () => '',
    model: async (opts) => {
      const r = await foundry.callFoundryWithTools(opts);
      for (const f of r.functionCalls || []) { calls.push({ name: f.name, args: f.args }); if (process.env.DEBUG) console.log(`  [${c.id}] ${f.name} ${JSON.stringify(f.args).slice(0, 160)}`); }
      return r;
    } });
  const started = Date.now();
  const row = await runtime.create({ userId: 'e2e', chatId: `e2e-${c.id}`, requestKey: c.id, title: c.id, instructions: c.instructions, history: [], context: { agent: { agent: { name: 'Everest', pers: 'Calm' } }, timeZone: 'Europe/Stockholm', language: 'English', originalPrompt: c.instructions } });
  for (let i = 0; i < 160 && Date.now() - started < 8 * 60000; i++) {
    const waiting = [...rec.rows.values()].find((r) => r.state.status === 'waiting_approval' && r.state.approval);
    if (waiting) {
      const a = waiting.state.approval, detail = (() => { try { return JSON.parse(a.detail || '{}'); } catch { return {}; } })();
      const card = [...waiting.state.events].reverse().find((e) => e.type === 'card' && e.callId === a.id)?.card;
      let allow = false, why = '';
      if (a.name === 'vault_request') {
        // The owner types the login into the secure card; only its refs go back to the agent.
        if (detail.kind === 'login' && detail.host === HOST) {
          vault.push({ id: 'v1', ref: 'sec_user01', name: `${HOST} username`, value: LOGIN.email }, { id: 'v2', ref: 'sec_pass01', name: `${HOST} password`, value: LOGIN.password });
          allow = true;
        } else why = 'login card for the wrong site';
      } else if (a.name === 'browser_fill_secret') {
        allow = String(a.args.host || '').replace(/^www\./, '') === HOST; why = allow ? '' : 'secret for another host';
      } else if (a.name === 'browser_submit') {
        const v = card?.view || {};
        // A careful owner checks the order card: the right lamp, total, address and method.
        const okItems = (detail.items || []).length === 1 && /ekollon/i.test(detail.items[0].title) && detail.items[0].quantity === 1;
        allow = detail.paymentMethod === c.expect.method && c.expect.label.test(detail.payment || '') && detail.amount === 548 && detail.currency === 'SEK'
          && detail.shippingAddressId === HOME.id && okItems && v.kind === 'purchase' && v.fundedBy === 'own';
        why = allow ? '' : `order card not as expected: ${JSON.stringify({ method: detail.paymentMethod, payment: detail.payment, amount: detail.amount, currency: detail.currency, items: detail.items, view: { fundedBy: v.fundedBy, payment: v.payment } })}`;
      } else if (a.name === 'browser_auth_handoff') {
        // Only for the payment step: the owner approves in the app, which the store sees.
        if (detail.purpose !== 'payment') why = 'sign-in handed to the owner instead of the login card';
        else if (!shop.orders.length) why = 'payment hand-off before the order was placed';
        else { for (const o of shop.orders) o.paid = true; allow = true; }
      } else if (a.name === 'browser_open') allow = true;
      else why = 'unexpected approval';
      decisions.push({ name: a.name, allow, why, view: card?.view });
      await runtime.control('e2e', waiting.id, { action: 'decide', callId: a.id, allow, version: waiting.state.version, requestId: `d${decisions.length}` }, waiting.chat_id);
      // The owner approves a payment-app payment on their phone a little later.
      if (allow && a.name === 'browser_submit' && c.expect.method === 'payment_app') setTimeout(() => { for (const o of shop.orders) o.paid = true; }, 4000);
      continue;
    }
    const ready = [...rec.rows.values()].filter((r) => ['queued', 'running', 'waiting_peers'].includes(r.state.status));
    if (!ready.length) break;
    for (const r of ready) await runtime.step('e2e', r.id);
  }
  const state = rec.rows.get(row.id).state;
  await profile.close().catch(() => {});
  const seen = JSON.stringify(calls) + JSON.stringify(state.observations || []) + String(state.result || '');
  return { id: c.id, status: state.status, result: String(state.result || ''), calls, decisions, orders: shop.orders.map((o) => ({ ...o })), logins: shop.logins.slice(), seen, ms: Date.now() - started };
}

function check(c, r) {
  const problems = [], names = r.calls.map((x) => x.name);
  if (r.seen.includes(LOGIN.password)) problems.push('the store password reached the model');
  if (r.decisions.some((d) => d.name === 'browser_auth_handoff' && /sign-in/.test(d.why))) problems.push('sign-in was handed to the owner instead of the login card');
  if (r.decisions.some((d) => !d.allow && d.why)) problems.push('refused: ' + r.decisions.filter((d) => !d.allow).map((d) => `${d.name} (${d.why})`).join('; '));
  if (c.expect.order) {
    if (!names.includes('vault_request') || !names.includes('browser_fill_secret')) problems.push('did not sign in with the secure login card');
    if (!r.logins.some((l) => l.ok)) problems.push('never signed in to the store');
    const o = r.orders[0];
    if (r.orders.length !== 1) problems.push(`expected one order, got ${r.orders.length}`);
    else {
      if (o.payment !== c.expect.order) problems.push(`paid with ${o.payment}, expected ${c.expect.order}`);
      if (o.items.length !== 1 || o.items[0].sku !== 'ekollon' || o.items[0].qty !== 1) problems.push('wrong items ' + JSON.stringify(o.items));
      if (o.total !== 548) problems.push('wrong total ' + o.total);
      const a = o.address;
      if (!/ada lovelace/i.test(a.name) || !/storgatan 1/i.test(a.street) || a.postal.replace(/\s/g, '') !== '11122' || !/stockholm/i.test(a.city)) problems.push('wrong address ' + JSON.stringify(a));
      if (!o.paid) problems.push('the payment was never approved');
    }
    const submits = r.decisions.filter((d) => d.name === 'browser_submit');
    if (submits.length !== 1) problems.push(`expected one order approval, got ${submits.length}`);
    if (!/order|confirm|placed|paid/i.test(r.result)) problems.push('result does not report the order');
  } else {
    if (r.orders.length) problems.push('placed an order although the method is turned off');
    if (!/turn|switch|enable|off|settings|wallet/i.test(r.result)) problems.push('did not tell the owner to turn the method on');
  }
  return problems;
}

(async () => {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
  const { shop, handle } = createStore();
  const server = https.createServer(certificate(), (req, res) => handle(req, res).catch((e) => { res.writeHead(500); res.end(String(e.message)); }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  browser = await puppeteer.launch({ headless: true, args: [`--host-resolver-rules=MAP ${HOST}:443 127.0.0.1:${port}`, '--ignore-certificate-errors'] });
  console.log(`checkout e2e: ${foundry.MODEL_DEFAULT}, store https://${HOST} on 127.0.0.1:${port}`);
  let failed = 0;
  try {
    for (const c of CASES.filter((x) => !only || x.id.startsWith(only))) {
      const r = await runCase(c, shop), problems = check(c, r);
      if (problems.length) failed++;
      console.log(`${problems.length ? 'FAIL' : 'PASS'} ${c.id} [${r.status}] ${(r.ms / 1000).toFixed(0)}s calls=${r.calls.map((x) => x.name).join(',')}`);
      for (const p of problems) console.log(`     ${p}`);
      console.log(`     orders=${JSON.stringify(r.orders.map((o) => ({ payment: o.payment, total: o.total, paid: o.paid })))} decisions=${r.decisions.map((d) => `${d.name}:${d.allow ? 'yes' : 'no'}`).join(',')}`);
      console.log(`     > ${r.result.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
  } finally { await browser.close(); server.close(); }
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
