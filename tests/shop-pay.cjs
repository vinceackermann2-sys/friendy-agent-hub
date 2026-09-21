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

  console.log('shop pay: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
