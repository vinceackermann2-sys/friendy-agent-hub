const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { publicUrlProblem } = require('../server/agents/sandbox');

function fixture(edge, options = {}) {
  const calls = [], writes = [];
  const linked = options.linked !== false;
  const account = linked ? { encryptedShopToken: 'sealed', scopes: 'openid dev.ucp.shopping.checkout:manage', shopTokenExpiresAt: Date.now() + 60000 } : null;
  const store = {
    secretsEncrypted: () => options.encrypted !== false,
    getShopPayAccount: async () => account,
    findShopPayByOAuthState: async () => ({ ...account, userId: 'owner', oauthExp: Date.now() + 60000, oauthRedirect: 'https://app.example/api/shop-pay/callback', oauthVerifier: 'verifier' }),
    openSecret: () => 'shop-access-token',
    sealSecret: value => ({ alg: 'aes-256-gcm', data: 'encrypted-' + value }),
    upsertShopPayAccount: async (_user, patch) => { writes.push(patch); return patch; },
  };
  const respond = async (input, init = {}, pinned = false) => {
    const url = new URL(input);
    calls.push({ url, init, pinned });
    assert.equal(init.redirect, 'manual', 'credential and discovery requests must not follow redirects');
    if (url.host === 'accounts.shop.app' && url.pathname.includes('/.well-known/')) {
      return Response.json({ authorization_endpoint: 'https://accounts.shop.app/oauth/authorize', token_endpoint: 'https://accounts.shop.app/oauth/token' });
    }
    if (url.pathname === '/.well-known/oauth-protected-resource') {
      return Response.json({ authorization_servers: [options.issuer || 'https://shopify.com/authentication/123'] });
    }
    if (url.host === 'shopify.com' && url.pathname.includes('/.well-known/')) {
      return Response.json({ token_endpoint: options.tokenEndpoint || 'https://shopify.com/authentication/123/oauth/token' });
    }
    if (url.href === 'https://accounts.shop.app/oauth/token') {
      const fields = new URLSearchParams(init.body);
      if (fields.get('code') === 'lingon-client-check') return Response.json({ error: 'invalid_grant' }, { status: 400 });
      if (options.providerRedirect) return new Response(null, { status: 307, headers: { location: 'https://attacker.example/tokens' } });
      if (fields.get('grant_type') === 'authorization_code') return Response.json({ access_token: 'connected-token', refresh_token: 'refresh-token' });
      assert.equal(fields.get('audience'), options.merchant || 'custom.example', 'buyer grant must be scoped to the requested merchant');
      return Response.json({ access_token: 'merchant-grant' });
    }
    if (url.href === 'https://shopify.com/authentication/123/oauth/token') {
      assert.equal(new URLSearchParams(init.body).get('assertion'), 'merchant-grant');
      return Response.json({ access_token: 'merchant-token' });
    }
    if (url.href === 'https://api.shopify.com/auth/access_token') return Response.json({ access_token: 'global-app-token', expires_in: 3600 });
    if (url.pathname === '/api/ucp/mcp') {
      if (options.merchantRedirect) return new Response(null, { status: 307, headers: { location: 'https://attacker.example/collect' } });
      return Response.json({ result: { structuredContent: { id: 'checkout', status: 'incomplete', currency: 'USD' } } });
    }
    throw new Error('Unexpected network destination: ' + url.href);
  };
  const pinnedFetch = (url, init) => respond(url, init, true);
  const file = edge ? 'src/lingon-server/shoppay.js' : 'server/shoppay.js';
  const source = fs.readFileSync(file, 'utf8').replace(/^import .+;\r?\n/gm, '').replace(/^export \{/m, 'module.exports = {');
  const context = {
    module: { exports: {} }, crypto, store, publicUrlProblem,
    currencyFor: () => 'USD', USD_RATE: {},
    require: name => {
      if (name === 'crypto') return crypto;
      if (name === './store') return store;
      if (name === './agents/product-search') return { currencyFor: () => 'USD', USD_RATE: {} };
      if (name === './agents/sandbox') return { publicUrlProblem, pinnedFetch };
      throw new Error('Unexpected import: ' + name);
    },
    process: { env: { SHOPIFY_CLIENT_ID: 'test-client', SHOPIFY_CLIENT_SECRET: 'test-secret' } },
    fetch: respond, URL, URLSearchParams, AbortController, AbortSignal, Buffer, setTimeout, clearTimeout,
  };
  // CJS declares its own bindings; the ESM imports removed above use the injected ones.
  vm.runInNewContext(source, context, { filename: file });
  return { shop: context.module.exports, calls, writes };
}

const checkout = (shop, merchant = 'custom.example') => shop.createCheckout('owner', { merchant, items: [{ id: 'variant', quantity: 1 }] });
async function run(edge) {
  for (const merchant of ['attacker.example', 'shop.myshopify.com.attacker.example']) {
    const { shop, calls } = fixture(edge, { linked: false });
    await assert.rejects(checkout(shop, merchant), error => error.code === 'NO_SHOP_LINK');
    assert.equal(calls.length, 0, 'arbitrary merchant must not get a shared app token');
  }
  {
    const { shop, calls } = fixture(edge, { linked: false });
    assert.equal((await checkout(shop, 'store.myshopify.com')).id, 'checkout', 'canonical Shopify app-token checkout still works');
    const sent = calls.find(call => call.url.pathname === '/api/ucp/mcp');
    assert.equal(sent.url.host, 'store.myshopify.com');
    assert.equal(sent.init.headers.Authorization, 'Bearer global-app-token');
  }
  {
    const { shop, calls } = fixture(edge);
    assert.equal((await checkout(shop)).id, 'checkout', 'buyer-linked checkout works on custom merchant domains');
    const sent = calls.find(call => call.url.pathname === '/api/ucp/mcp');
    assert.equal(sent.init.headers.Authorization, 'Bearer merchant-token');
    assert.equal(sent.url.host, 'custom.example');
    if (!edge) assert.equal(sent.pinned, true, 'custom merchant connections use DNS-pinned transport');
    assert.ok(!calls.some(call => call.url.href === 'https://api.shopify.com/auth/access_token'), 'no global-token fallback');
  }
  for (const options of [
    { issuer: 'https://attacker.example' },
    { issuer: 'https://api.shopify.com' },
    { issuer: 'https://shopify.com.attacker.example/authentication/123' },
    { tokenEndpoint: 'https://attacker.example/token' },
    { tokenEndpoint: 'https://shopify.com/authentication/456/oauth/token' },
    { tokenEndpoint: 'https://api.shopify.com/auth/access_token' },
  ]) {
    const { shop, calls } = fixture(edge, options);
    await assert.rejects(checkout(shop), error => error.code === 'SHOP_CONFIG');
    assert.ok(calls.every(call => !call.init.body && !call.init.headers.Authorization), 'hostile discovery must not receive tokens, grants, or client secrets');
  }
  for (const options of [{ providerRedirect: true }, { merchantRedirect: true }, { linked: false, merchantRedirect: true }]) {
    const { shop, calls } = fixture(edge, options);
    await assert.rejects(checkout(shop, options.linked === false ? 'store.myshopify.com' : 'custom.example'), error => error.code === 'SHOP_HTTP');
    assert.ok(calls.every(call => call.url.host !== 'attacker.example'), '307 cannot forward credentials');
  }
  {
    const { shop, calls, writes } = fixture(edge, { encrypted: false });
    await assert.rejects(shop.startConnect('owner', { origin: 'https://app.example' }), error => error.code === 'SHOP_CONFIG');
    await assert.rejects(shop.finishConnect({ state: 'state', code: 'code' }), error => error.code === 'SHOP_CONFIG');
    await assert.rejects(checkout(shop), error => error.code === 'SHOP_CONFIG');
    assert.equal(calls.length, 0, 'missing encryption fails before sending tokens');
    assert.equal(writes.length, 0, 'missing encryption never writes credentials');
  }
  {
    const { shop, writes } = fixture(edge);
    await shop.startConnect('owner', { origin: 'https://app.example' });
    await shop.finishConnect({ state: 'state', code: 'code' });
    assert.equal(writes[1].encryptedShopToken.alg, 'aes-256-gcm');
    assert.equal(writes[1].encryptedRefreshToken.alg, 'aes-256-gcm');
  }
  for (const host of ['service.internal', 'localhost', '127.0.0.1', '169.254.169.254']) {
    const { shop, calls } = fixture(edge);
    await assert.rejects(checkout(shop, host), error => error.code === 'BAD_INPUT');
    assert.equal(calls.length, 0);
  }
}
async function main() {
  await run(false);
  await run(true);
  console.log('Shop Pay credential destinations, redirects, merchant scoping, encryption: ok (Node + edge)');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
