import crypto from 'node:crypto';
import { adminClient } from './auth.js';
import { seal, unseal } from './apple-devices.js';

// Apple's code exchange is needed to revoke the Apple identity on deletion.
// Neither the signing key nor the refresh token is exposed to the web client.
function createAppleIdentity({ client = adminClient, fetchImpl = fetch, now = Date.now, environment = () => process.env } = {}) {
  const unavailable = () => Object.assign(new Error('Apple account authentication is unavailable.'), {code:'UNAVAILABLE'});
  function configuration() {
    const env = environment();
    const read = name => String(env[name] || env['LINGON_' + name] || '').trim();
    const team = read('APPLE_TEAM_ID'), keyId = read('APPLE_SIGN_IN_KEY_ID'), privateKey = read('APPLE_SIGN_IN_PRIVATE_KEY').replace(/\\n/g,'\n');
    const clientId = read('APPLE_CLIENT_ID');
    if (!/^[A-Z0-9]{10}$/.test(team) || !/^[A-Z0-9]{10}$/.test(keyId) || clientId !== 'se.belna.app' || !privateKey.includes('PRIVATE KEY')) throw unavailable();
    return {team,keyId,privateKey,clientId};
  }
  function clientSecret(config) {
    const seconds = Math.floor(now()/1000);
    const header = Buffer.from(JSON.stringify({alg:'ES256',kid:config.keyId})).toString('base64url');
    const claims = Buffer.from(JSON.stringify({iss:config.team,iat:seconds,exp:seconds+300,aud:'https://appleid.apple.com',sub:config.clientId})).toString('base64url');
    const input = header+'.'+claims;
    const signature = crypto.sign('sha256',Buffer.from(input),{key:config.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
    return input+'.'+signature;
  }
  async function request(path, values) {
    const config = configuration();
    const response = await fetchImpl('https://appleid.apple.com/auth/'+path,{method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:config.clientId,client_secret:clientSecret(config),...values}),
      signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw unavailable();
    return response;
  }
  async function exchange(code) {
    const response = await request('token',{code,grant_type:'authorization_code'});
    const tokens = await response.json();
    if (typeof tokens.id_token !== 'string' || !tokens.id_token.length || typeof tokens.refresh_token !== 'string' || !tokens.refresh_token.length || tokens.refresh_token.length > 10000) throw unavailable();
    return {identityToken:tokens.id_token,refreshToken:tokens.refresh_token};
  }
  async function save(userId, refreshToken) {
    const db = client(); if(!db) throw unavailable();
    const {error} = await db.from('apple_identity_tokens').upsert({user_id:userId,token:seal({refreshToken},'apple-identity:'+userId)},{onConflict:'user_id'});
    if(error) throw unavailable();
  }
  async function revoke(user) {
    const db = client(); if(!db) throw unavailable();
    const {data,error} = await db.from('apple_identity_tokens').select('token').eq('user_id',user.id).maybeSingle();
    if(error) throw unavailable();
    const usesApple = (user.identities || []).some(identity => identity.provider === 'apple') || (user.app_metadata?.providers || []).includes('apple');
    if(!data) {
      if(usesApple) throw Object.assign(new Error('Sign in with Apple again before deleting your account.'),{code:'APPLE_REAUTH_REQUIRED'});
      return;
    }
    const {refreshToken} = unseal(data.token,'apple-identity:'+user.id);
    await request('revoke',{token:refreshToken,token_type_hint:'refresh_token'});
    // Keep the encrypted token until account deletion succeeds, so retries
    // repeat Apple's idempotent revocation without losing the recovery record.
  }
  return {exchange,save,revoke};
}
const appleIdentity = createAppleIdentity();
export {createAppleIdentity,appleIdentity};
