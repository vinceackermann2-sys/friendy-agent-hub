// Install a privately supplied app secret in the service-only Supabase Vault.
// Both the local preview and Lovable backend read this same configuration.
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

async function configureWallet({ env = process.env, fetchImpl = fetch, makeClient = createClient } = {}) {
  const appId = String(env.PRIVY_APP_ID || '').trim();
  const appSecret = String(env.PRIVY_APP_SECRET || '').trim();
  const url = String(env.SUPABASE_URL || '').trim();
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '').trim();
  if (!appId || !appSecret || appSecret.includes('*')) throw Error('Add the real Privy app secret to .env.wallet.local first.');
  if (!url || !serviceKey) throw Error('The Supabase server connection is missing.');

  // Verify the credential with a read-only request before storing it.
  const response = await fetchImpl('https://api.privy.io/v1/users?limit=1', {
    headers: { 'privy-app-id': appId, Authorization: 'Basic ' + Buffer.from(appId + ':' + appSecret).toString('base64') },
    redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  await response.body?.cancel();
  if (!response.ok) throw Error('Privy did not accept this app secret. Nothing was saved.');

  const earnEnabled = env.PRIVY_EARN_ENABLED;
  const vaultId = String(env.PRIVY_EARN_VAULT_ID || '').trim();
  if (earnEnabled === 'true') {
    if (!/^[a-zA-Z0-9_-]+$/.test(vaultId)) throw Error('Choose a verified Earn vault. Nothing was saved.');
    const check = await fetchImpl('https://api.privy.io/v1/earn/ethereum/vaults/' + encodeURIComponent(vaultId), {
      headers: { 'privy-app-id': appId, Authorization: 'Basic ' + Buffer.from(appId + ':' + appSecret).toString('base64') },
      redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    const vault = await check.json();
    if (!check.ok || vault.id !== vaultId || vault.provider !== 'aave' || vault.caip2 !== 'eip155:8453' || vault.asset?.decimals !== 6 || vault.asset?.address?.toLowerCase() !== '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
      throw Error('The Aave USDC vault could not be verified. Nothing was saved.');
  }

  const db = makeClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const saved = await db.rpc('get_server_secret', { p_name: 'privy_wallet_config' });
  if (saved.error) throw Error('Could not read the private wallet configuration.');
  let config = {};
  if (saved.data) {
    try { config = JSON.parse(saved.data); } catch { throw Error('The stored wallet configuration needs review.'); }
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error('The stored wallet configuration needs review.');
  }
  Object.assign(config, { PRIVY_APP_ID: appId, PRIVY_APP_SECRET: appSecret, PRIVY_AUTH_MODE: 'email' });
  if (earnEnabled === 'true') Object.assign(config, { PRIVY_EARN_ENABLED: 'true', PRIVY_EARN_VAULT_ID: vaultId });
  if (earnEnabled === 'true' && env.PRIVY_EARN_FEE_PERCENT !== undefined) {
    const fee = String(env.PRIVY_EARN_FEE_PERCENT);
    if (!/^\d+(\.\d+)?$/.test(fee) || Number(fee) > 100) throw Error('The Earn fee needs review. Nothing was saved.');
    config.PRIVY_EARN_FEE_PERCENT = fee;
  }
  if (earnEnabled === 'false') config.PRIVY_EARN_ENABLED = 'false';
  if (['true', 'false'].includes(env.PRIVY_BANK_WITHDRAWALS_ENABLED)) config.PRIVY_BANK_WITHDRAWALS_ENABLED = env.PRIVY_BANK_WITHDRAWALS_ENABLED;
  if (!Object.hasOwn(config, 'PRIVY_EARN_ENABLED')) config.PRIVY_EARN_ENABLED = 'false';
  const result = await db.rpc('put_server_secret', { p_name: 'privy_wallet_config', p_secret: JSON.stringify(config) });
  if (result.error) throw Error('Could not save the private wallet configuration.');
  const check = await db.rpc('get_server_secret', { p_name: 'privy_wallet_config' });
  if (check.error || check.data !== JSON.stringify(config)) throw Error('Could not confirm the private wallet configuration.');
  return { saved: true, destination: 'Supabase Vault', configuration: 'privy_wallet_config' };
}

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env.wallet.local') });
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
  configureWallet().then(() => console.log('Privy credential verified and saved in the service-only Supabase Vault. Restart the preview; Lovable uses the same Vault configuration.'))
    .catch(() => { console.error('Wallet configuration was not completed. Check the private app secret and Supabase server settings; no credential values were printed.'); process.exitCode = 1; });
}
module.exports = { configureWallet };
