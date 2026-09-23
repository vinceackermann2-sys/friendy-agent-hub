const assert = require('node:assert/strict');
const { pickTools } = require('../server/agents/tools');
const shoppay = require('../server/shoppay');

async function main() {
  assert.equal(shoppay.configured(), false);
  const profile = shoppay.platformProfile('https://belna.se');
  assert.equal(profile.ucp.version, '2026-08-25');
  assert.ok(profile.ucp.capabilities['dev.ucp.shopping.checkout']);
  assert.ok(profile.ucp.capabilities['dev.ucp.common.identity_linking']);
  assert.ok(profile.ucp.payment_handlers['com.shopify.shop_pay']);
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

  const product = shoppay.publicProduct({
    id: 'gid://shopify/p/1',
    title: 'Trail shoe',
    variants: [{ id: 'gid://shopify/ProductVariant/9', title: '10', price: { amount: 8999, currency: 'USD' }, seller: { name: 'Run', domain: 'run.myshopify.com' } }],
  });
  assert.equal(product.seller.domain, 'run.myshopify.com');
  assert.equal(product.variants[0].price.amount, 89.99);

  try {
    await shoppay.completePurchase('user_test', { merchant: 'run.myshopify.com', checkoutId: 'chk_1', confirm: false });
    assert.fail('expected confirm gate');
  } catch (e) {
    assert.equal(e.code, 'NEED_CONFIRM');
  }

  const names = pickTools('buy headphones with shop pay').map((t) => t.name);
  assert.ok(names.includes('shop_status'));
  assert.ok(names.includes('shop_search'));
  assert.ok(names.includes('shop_purchase'));
  assert.equal(pickTools('buy headphones with shop pay').find((t) => t.name === 'shop_purchase').approval, true);
  assert.equal(typeof require('../server/privy').configured, 'function');
  assert.equal(typeof require('../server/issuing').configured, 'function');

  const snap = shoppay.publicAccount(null);
  assert.equal(snap.connected, false);
  assert.equal(snap.handler, 'com.shopify.shop_pay');
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

  console.log('shop pay: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
