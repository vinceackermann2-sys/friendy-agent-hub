const assert = require('node:assert/strict');
const { configureWallet } = require('../scripts/configure-privy-wallet.cjs');
const env = { PRIVY_APP_ID: 'fixture-app', PRIVY_APP_SECRET: 'private-fixture', SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SECRET_KEY: 'service-fixture' };
(async () => {
  let stored = JSON.stringify({ PRIVY_EARN_ENABLED: 'false', PRIVY_BASE_RPC_URL: 'https://rpc.example' }), writes = 0;
  const makeClient = (url, key, options) => {
    assert.equal(url, env.SUPABASE_URL); assert.equal(key, env.SUPABASE_SECRET_KEY);
    assert.equal(options.auth.persistSession, false);
    return { rpc: async (name, params) => {
      assert.equal(params.p_name, 'privy_wallet_config');
      if (name === 'put_server_secret') { writes++; stored = params.p_secret; return { data: 'id' }; }
      assert.equal(name, 'get_server_secret'); return { data: stored };
    } };
  };
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://api.privy.io/v1/users?limit=1');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Basic ' + Buffer.from('fixture-app:private-fixture').toString('base64'));
    return new Response('{}', { status: 200 });
  };
  assert.deepEqual(await configureWallet({ env, makeClient, fetchImpl }), { saved: true, destination: 'Supabase Vault', configuration: 'privy_wallet_config' });
  assert.equal(writes, 1); assert.equal(JSON.parse(stored).PRIVY_APP_SECRET, env.PRIVY_APP_SECRET);
  assert.equal(JSON.parse(stored).PRIVY_BASE_RPC_URL, 'https://rpc.example');
  await assert.rejects(configureWallet({ env, makeClient, fetchImpl: async () => new Response('{}', { status: 401 }) }), /Nothing was saved/);
  assert.equal(writes, 1, 'invalid provider credentials cannot overwrite Vault');
  await assert.rejects(configureWallet({ env: { ...env, PRIVY_APP_SECRET: '****masked' }, makeClient, fetchImpl }), /real Privy app secret/);
  assert.equal(writes, 1);
  const earnEnv={...env,PRIVY_EARN_ENABLED:'true',PRIVY_EARN_VAULT_ID:'vault-verified',PRIVY_EARN_FEE_PERCENT:'10',PRIVY_BANK_WITHDRAWALS_ENABLED:'true'};
  const verifiedFetch=async(url,options)=>url.includes('/earn/')?new Response(JSON.stringify({id:'vault-verified',provider:'aave',caip2:'eip155:8453',asset:{address:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',decimals:6}}),{status:200}):fetchImpl(url,options);
  await configureWallet({env:earnEnv,makeClient,fetchImpl:verifiedFetch});
  assert.equal(writes,2);assert.equal(JSON.parse(stored).PRIVY_EARN_ENABLED,'true');assert.equal(JSON.parse(stored).PRIVY_EARN_FEE_PERCENT,'10');
  assert.equal(JSON.parse(stored).PRIVY_BANK_WITHDRAWALS_ENABLED,'true');
  await assert.rejects(configureWallet({env:earnEnv,makeClient,fetchImpl:async(url,opts)=>url.includes('/earn/')?new Response(JSON.stringify({id:'vault-verified',provider:'aave',caip2:'eip155:1',asset:{}})):fetchImpl(url,opts)}),/Nothing was saved/);
  assert.equal(writes,2,'a mismatched vault cannot be enabled');
  console.log('Wallet configuration: private service-only storage, credential validation, masked-key rejection and readback passed');
})().catch(() => { console.error('Wallet configuration regression failed.'); process.exitCode = 1; });
