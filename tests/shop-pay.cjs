const assert = require('node:assert/strict');
const sandbox = require('../server/agents/sandbox');
const realPinnedFetch = sandbox.pinnedFetch;
// Merchant HTTP uses the same response fixtures as provider HTTP in this test.
sandbox.pinnedFetch = (url, init) => global.fetch(url, init);
const shoppay = require('../server/shoppay');
sandbox.pinnedFetch = realPinnedFetch;
const { pickTools } = require('../server/agents/tools');
// Connections must use encrypted token storage, including in test fixtures.
process.env.ENCRYPTION_KEY = 'shop-pay-test-key';

async function main() {
  assert.equal(shoppay.configured(), false);
  const profile = shoppay.platformProfile('https://belna.se');
  assert.equal(profile.ucp.version, '2026-08-25');
  assert.ok(profile.ucp.capabilities['dev.ucp.shopping.checkout']);
  assert.ok(profile.ucp.capabilities['dev.ucp.common.identity_linking']);
  assert.ok(profile.ucp.payment_handlers['dev.shopify.shop_pay']);
  assert.ok(!JSON.stringify(profile).includes('secret'));
  assert.ok(!JSON.stringify(profile).includes('access_token'));

  assert.equal(shoppay.merchantHost('https://snowdevil.myshopify.com/products/x'), 'snowdevil.myshopify.com');
  assert.throws(() => shoppay.merchantHost('http://evil.test'), /https/);
  assert.throws(() => shoppay.merchantHost('https://user:pass@shop.example'), /Invalid/);
  assert.throws(() => shoppay.merchantHost('localhost'), /Invalid/);
  assert.throws(() => shoppay.merchantHost('gid://shopify/Shop/1'), /domain/);

  const pub = shoppay.publicCheckout({
    id: 'chk_1',
    status: 'ready_for_complete',
    currency: 'USD',
    line_items: [{ id: 'li_1', quantity: 1, item: { title: 'Hat', price: 2500 } }],
    totals: [{ type: 'total', amount: 2500, display_text: 'Total' }],
    payment: { instruments: [{ credential: { token: 'SECRET_TOKEN' } }] },
    continue_url: 'https://snowdevil.myshopify.com/checkouts/1',
  }, 'snowdevil.myshopify.com');
  assert.equal(pub.merchant, 'snowdevil.myshopify.com');
  assert.equal(pub.lineItems[0].title, 'Hat');
  assert.equal(pub.totals[0].amount.amount, 25);
  assert.ok(!JSON.stringify(pub).includes('SECRET_TOKEN'));
  assert.ok(!JSON.stringify(pub).includes('credential'));
  const smallUsd = shoppay.publicCheckout({ id: 'chk_small', currency: 'USD', totals: [{ type: 'total', amount: 99 }] }, 'snowdevil.myshopify.com');
  assert.equal(smallUsd.totals[0].amount.amount, 0.99);
  assert.equal(smallUsd.totals[0].amount.minor, 99);
  const yen = shoppay.publicCheckout({ id: 'chk_yen', currency: 'JPY', totals: [{ type: 'total', amount: 99 }] }, 'snowdevil.myshopify.com');
  assert.equal(yen.totals[0].amount.amount, 99);

  const product = shoppay.publicProduct({
    id: 'gid://shopify/p/1',
    title: 'Trail shoe',
    variants: [{ id: 'gid://shopify/ProductVariant/9', title: '10', price: { amount: 8999, currency: 'USD' }, seller: { name: 'Run', domain: 'run.myshopify.com' } }],
  });
  assert.equal(product.seller.domain, 'run.myshopify.com');
  assert.equal(product.variants[0].price.amount, 89.99);
  assert.equal(product.url, null);
  // The catalog links variants, not products, to the merchant's store: the product takes the first link.
  const linked = shoppay.publicProduct({
    id: 'gid://shopify/p/2', title: 'Road shoe', rating: { value: 4.9, count: 94 }, media: [{ url: 'https://cdn.shopify.com/road.jpg' }],
    variants: [{ id: 'v1', price: { amount: 123000, currency: 'SEK' } }, { id: 'v2', url: 'https://run.example.com/products/road?variant=2', price: { amount: 123000, currency: 'SEK' } }],
  });
  assert.equal(linked.url, 'https://run.example.com/products/road?variant=2');
  assert.deepEqual(linked.rating, { value: 4.9, count: 94 });
  const { resultCard } = require('../server/agents/cards');
  const card = resultCard('shop_search', { products: [linked] }, { query: 'road shoes' });
  const { price, ...shown } = card.items[0];
  assert.match(price, /^SEK\s1,230\.00$/);
  assert.deepEqual(shown, { title: 'Road shoe', subtitle: '', meta: '★ 4.9 (94)', image: 'https://cdn.shopify.com/road.jpg', url: 'https://run.example.com/products/road?variant=2' });
  assert.equal(resultCard('shop_search', { products: [] }, { query: 'nothing' }), null, 'no matches, no empty card');
  assert.equal(card.subtitle, undefined);
  assert.match(resultCard('shop_search', { products: [linked], maxPrice: 1500, currency: 'SEK' }, { query: 'road shoes' }).subtitle, /^1 under SEK\s1,500\.00$/, 'the budget shows on the card');

  try {
    await shoppay.completePurchase('user_test', { merchant: 'run.myshopify.com', checkoutId: 'chk_1', confirm: false });
    assert.fail('expected confirm gate');
  } catch (e) {
    assert.equal(e.code, 'NEED_CONFIRM');
  }
  await assert.rejects(shoppay.completePurchase('user_test', { merchant: 'run.myshopify.com', checkoutId: 'chk_1', confirm: true }), (e) => e.code === 'NEED_CONFIRM');

  const names = pickTools('buy headphones with shop pay').map((t) => t.name);
  assert.ok(names.includes('shop_status'));
  assert.ok(names.includes('shop_search'));
  assert.ok(names.includes('shop_purchase'));
  assert.equal(pickTools('buy headphones with shop pay').find((t) => t.name === 'shop_purchase').approval, true);

  const snap = shoppay.publicAccount(null);
  assert.equal(snap.connected, false);
  assert.equal(snap.handler, 'dev.shopify.shop_pay');
  assert.ok(!JSON.stringify(snap).includes('token'));

  const verifier = shoppay.pkceVerifier();
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  assert.equal(shoppay.pkceChallenge(verifier).length > 20, true);

  // A stale deployment env pair must not override the registered OAuth pair
  // stored on the server. Unknown clients must fail before browser redirect.
  const store = require('../server/store');
  const originalFetch = global.fetch;
  const originalUpsert = store.upsertShopPayAccount;
  const envNames = ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET', 'SHOP_PAY_CLIENT_ID', 'SHOP_PAY_CLIENT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  try {
    process.env.SHOPIFY_CLIENT_ID = 'stale-catalog-client';
    process.env.SHOPIFY_CLIENT_SECRET = 'stale-catalog-secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    store.upsertShopPayAccount = async () => ({});
    global.fetch = async (url, init = {}) => {
      const href = String(url);
      if (href.endsWith('/rpc/get_server_secret')) {
        const { p_name } = JSON.parse(init.body);
        return Response.json(p_name === 'shopify_client_id' ? 'registered-shop-client' : 'registered-shop-secret');
      }
      if (href.endsWith('/.well-known/oauth-authorization-server')) {
        return Response.json({ authorization_endpoint: 'https://accounts.shop.app/oauth/authorize', token_endpoint: 'https://accounts.shop.app/oauth/token' });
      }
      if (href.endsWith('/oauth/token')) {
        const id = new URLSearchParams(init.body).get('client_id');
        return Response.json({ error: id === 'registered-shop-client' ? 'invalid_grant' : 'invalid_client' }, { status: 400 });
      }
      throw new Error('Unexpected request: ' + href);
    };
    const connect = await shoppay.startConnect('user_test', { origin: 'https://belna.se' });
    assert.equal(new URL(connect.url).searchParams.get('client_id'), 'registered-shop-client');
    process.env.SHOP_PAY_CLIENT_ID = 'unregistered-shop-client';
    process.env.SHOP_PAY_CLIENT_SECRET = 'unregistered-shop-secret';
    await assert.rejects(shoppay.startConnect('user_test', { origin: 'https://belna.se' }), (e) => e.code === 'SHOP_CONFIG' && /does not recognize/.test(e.message));
  } finally {
    global.fetch = originalFetch;
    store.upsertShopPayAccount = originalUpsert;
    for (const name of envNames) originalEnv[name] === undefined ? delete process.env[name] : process.env[name] = originalEnv[name];
  }

  // A budget in the owner's currency reaches the catalog as US cents (its filters use dollars),
  // and results priced in that currency are held to it exactly.
  const catalogCalls = [];
  try {
    process.env.SHOPIFY_CLIENT_ID = 'catalog-client';
    process.env.SHOPIFY_CLIENT_SECRET = 'catalog-secret';
    global.fetch = async (url, init = {}) => {
      const href = String(url);
      if (href === 'https://api.shopify.com/auth/access_token') return Response.json({ access_token: 'app-token', expires_in: 3600 });
      if (href === 'https://catalog.shopify.com/api/ucp/mcp') {
        catalogCalls.push(JSON.parse(init.body).params.arguments.catalog);
        const item = (title, amount, currency) => ({ id: title, title, variants: [{ id: `${title}-v`, url: `https://shop.example/${title}`, price: { amount, currency } }] });
        return Response.json({ result: { structuredContent: { products: [item('cheap', 45600, 'SEK'), item('pricey', 195000, 'SEK'), item('euro', 12000, 'EUR')] } } });
      }
      throw new Error('Unexpected request: ' + href);
    };
    const budgeted = await shoppay.searchCatalog(null, { query: 'trail running shoes', country: 'SE', maxPrice: 1500 });
    assert.deepEqual(catalogCalls[0].filters, { price: { max: 14250 } });
    assert.equal(catalogCalls[0].context.address_country, 'SE');
    assert.deepEqual(budgeted.products.map((p) => p.title), ['cheap', 'euro']);
    assert.equal(budgeted.products[0].url, 'https://shop.example/cheap');
    assert.equal(budgeted.currency, 'SEK');
    const open = await shoppay.searchCatalog(null, { query: 'trail running shoes', country: 'DE' });
    assert.equal(catalogCalls[1].filters, undefined, 'no budget, no price filter');
    assert.equal(open.products.length, 3);
    await shoppay.searchCatalog(null, { query: 'trail running shoes', country: 'DE', maxPrice: 100 });
    assert.deepEqual(catalogCalls[2].filters, { price: { max: 11000 } }, 'euro countries budget in euros');
  } finally {
    global.fetch = originalFetch;
    for (const name of envNames) originalEnv[name] === undefined ? delete process.env[name] : process.env[name] = originalEnv[name];
  }

  // The approved quote is bound to the merchant, items and total. Only the
  // server-side Shop Pay instrument is sent to complete_checkout.
  const original = {
    fetch: global.fetch,
    get: store.getShopPayAccount,
    open: store.openSecret,
    seal: store.sealSecret,
    upsert: store.upsertShopPayAccount,
    reserve: store.reserveShopPaySpend,
    update: store.updateShopPayOrder,
  };
  const previousShopEnv = { id: process.env.SHOP_PAY_CLIENT_ID, secret: process.env.SHOP_PAY_CLIENT_SECRET };
  const calls = [];
  let status = 'ready_for_complete';
  let total = 2500;
  let withInstrument = true;
  let refreshes = 0;
  try {
    process.env.SHOP_PAY_CLIENT_ID = 'shop-client';
    process.env.SHOP_PAY_CLIENT_SECRET = 'shop-secret';
    let account = { encryptedShopToken: 'sealed', scopes: 'openid dev.ucp.shopping.checkout:manage', connectedAt: Date.now(), dailyLimitUsd: 200 };
    store.getShopPayAccount = async () => account;
    store.openSecret = (value) => value === 'sealed-refresh' ? 'refresh-token' : value === 'sealed-new' ? 'new-shop-token' : 'shop-access-token';
    store.sealSecret = () => 'sealed-new';
    store.upsertShopPayAccount = async (_user, patch) => { account = { ...account, ...patch }; return account; };
    store.reserveShopPaySpend = async () => ({ id: 'spo_1', status: 'authorized' });
    store.updateShopPayOrder = async (_user, _id, patch) => patch;
    global.fetch = async (url, init = {}) => {
      const href = String(url);
      if (href.endsWith('/.well-known/oauth-protected-resource')) return Response.json({ authorization_servers: ['https://shopify.com/authentication/123'] });
      if (href === 'https://shopify.com/.well-known/oauth-authorization-server/authentication/123') return Response.json({ token_endpoint: 'https://shopify.com/authentication/123/oauth/token' });
      if (href.endsWith('/.well-known/oauth-authorization-server')) return Response.json({ token_endpoint: href.includes('accounts.shop.app') ? 'https://accounts.shop.app/oauth/token' : 'https://api.shopify.com/auth/access_token' });
      if (href === 'https://accounts.shop.app/oauth/token') {
        if (new URLSearchParams(init.body).get('grant_type') === 'refresh_token') { refreshes++; return Response.json({ access_token: 'new-shop-token', expires_in: 3600 }); }
        return Response.json({ access_token: 'buyer-grant' });
      }
      if (href === 'https://shopify.com/authentication/123/oauth/token') return Response.json({ access_token: 'buyer-token' });
      if (href.endsWith('/api/ucp/mcp')) {
        const call = JSON.parse(init.body);
        calls.push(call);
        if (call.params.name === 'get_checkout') return Response.json({ result: { structuredContent: {
          id: 'chk_1', status, currency: 'USD', line_items: [{ id: 'li_1', quantity: 1, item: { title: 'Hat', price: total } }],
          totals: [{ type: 'total', amount: total }], continue_url: 'https://shop.example/checkout',
          payment: { instruments: withInstrument ? [{ id: 'pay_1', handler_id: 'shop_pay', type: 'shop_pay', credential: { type: 'shop_token', token: 'secret-shop-token' } }] : [] },
        } } });
        if (call.params.name === 'complete_checkout') return Response.json({ result: { structuredContent: {
          id: 'chk_1', status: 'completed', currency: 'USD', order: { id: 'order_1', permalink_url: 'https://shop.example/orders/1' },
        } } });
      }
      throw new Error('Unexpected request: ' + href);
    };
    const quote = await shoppay.purchaseQuote('user_test', { merchant: 'shop.example', checkoutId: 'chk_1' });
    assert.equal(quote.amount, 25);
    assert.ok(!JSON.stringify(quote).includes('secret-shop-token'));
    total = 2600;
    await assert.rejects(shoppay.completePurchase('user_test', { merchant: 'shop.example', checkoutId: 'chk_1', confirm: true, approvedQuote: JSON.stringify(quote) }), (e) => e.code === 'NEED_CONFIRM');
    assert.equal(calls.filter((call) => call.params.name === 'complete_checkout').length, 0);
    total = 2500;
    const placed = await shoppay.completePurchase('user_test', { merchant: 'shop.example', checkoutId: 'chk_1', confirm: true, approvedQuote: JSON.stringify(quote) });
    assert.equal(placed.status, 'completed');
    assert.equal(placed.orderId, 'order_1');
    const completion = calls.find((call) => call.params.name === 'complete_checkout');
    assert.equal(completion.params.arguments.checkout.payment.instruments[0].credential.token, 'secret-shop-token');
    assert.match(completion.params.arguments.meta['idempotency-key'], /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    assert.ok(!JSON.stringify(placed).includes('secret-shop-token'));
    status = 'requires_escalation';
    const escalatedQuote = await shoppay.purchaseQuote('user_test', { merchant: 'shop.example', checkoutId: 'chk_1' });
    const handoff = await shoppay.completePurchase('user_test', { merchant: 'shop.example', checkoutId: 'chk_1', confirm: true, approvedQuote: JSON.stringify(escalatedQuote) });
    assert.equal(handoff.status, 'needs_buyer');
    assert.equal(handoff.continueUrl, 'https://shop.example/checkout');
    assert.equal(calls.filter((call) => call.params.name === 'complete_checkout').length, 1);
    status = 'ready_for_complete';
    withInstrument = false;
    const buyerQuote = await shoppay.purchaseQuote('user_test', { merchant: 'shop.example', checkoutId: 'chk_1' });
    const buyerHandoff = await shoppay.completePurchase('user_test', { merchant: 'shop.example', checkoutId: 'chk_1', confirm: true, approvedQuote: JSON.stringify(buyerQuote) });
    assert.equal(buyerHandoff.status, 'needs_buyer');
    assert.equal(calls.filter((call) => call.params.name === 'complete_checkout').length, 1);
    account = { ...account, encryptedRefreshToken: 'sealed-refresh', shopTokenExpiresAt: Date.now() - 1000 };
    await shoppay.purchaseQuote('user_test', { merchant: 'shop.example', checkoutId: 'chk_1' });
    assert.equal(refreshes, 1, 'an expiring linked Shop session refreshes when a refresh token exists');
  } finally {
    global.fetch = original.fetch;
    store.getShopPayAccount = original.get;
    store.openSecret = original.open;
    store.sealSecret = original.seal;
    store.upsertShopPayAccount = original.upsert;
    store.reserveShopPaySpend = original.reserve;
    store.updateShopPayOrder = original.update;
    for (const [key, value] of Object.entries(previousShopEnv)) {
      const name = key === 'id' ? 'SHOP_PAY_CLIENT_ID' : 'SHOP_PAY_CLIENT_SECRET';
      value === undefined ? delete process.env[name] : process.env[name] = value;
    }
  }

  console.log('shop pay: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
