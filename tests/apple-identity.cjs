const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {createAppleIdentity}=require('../server/apple-identity');
const {unseal}=require('../server/apple-devices');
(async()=>{
  process.env.ENCRYPTION_KEY='ab'.repeat(32);
  const {privateKey,publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const environment=()=>({APPLE_TEAM_ID:'6XD78664VT',APPLE_CLIENT_ID:'se.belna.app',APPLE_SIGN_IN_KEY_ID:'TESTKEY001',APPLE_SIGN_IN_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'})});
  const saved=new Map(),requests=[];let rejected=false;
  const client=()=>({from:table=>{
    assert.equal(table,'apple_identity_tokens');
    return {upsert:async row=>{saved.set(row.user_id,row);return{};},select:()=>({eq:(column,id)=>{assert.equal(column,'user_id');return {maybeSingle:async()=>({data:saved.get(id)||null})};}})};
  }});
  const identity=createAppleIdentity({client,environment,now:()=>1800000000000,fetchImpl:async(url,init)=>{
    requests.push({url,form:init.body});
    const jwt=init.body.get('client_secret').split('.');
    assert.equal(crypto.verify('sha256',Buffer.from(jwt[0]+'.'+jwt[1]),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(jwt[2],'base64url')),true);
    const claims=JSON.parse(Buffer.from(jwt[1],'base64url'));
    assert.equal(claims.sub,'se.belna.app');assert.equal(claims.iss,'6XD78664VT');assert.equal(claims.exp-claims.iat,300);
    assert.equal(claims.aud,'https://appleid.apple.com');assert.equal(init.signal.aborted,false);
    return {ok:!rejected,json:async()=>({id_token:'provider.verified.jwt',refresh_token:'secret-owner-token'})};
  }});
  const tokens=await identity.exchange('one-use-code');assert.equal(tokens.identityToken,'provider.verified.jwt');
  assert.equal(requests[0].form.get('grant_type'),'authorization_code');
  await identity.save('owner',tokens.refreshToken);
  assert.doesNotMatch(JSON.stringify(saved.get('owner')),/secret-owner-token/);
  assert.equal(unseal(saved.get('owner').token,'apple-identity:owner').refreshToken,'secret-owner-token');
  assert.throws(()=>unseal(saved.get('owner').token,'apple-identity:other'));
  await identity.revoke({id:'owner',identities:[{provider:'apple'}]});
  assert.equal(requests[1].url,'https://appleid.apple.com/auth/revoke');assert.equal(requests[1].form.get('token'),'secret-owner-token');
  await assert.rejects(identity.revoke({id:'other',app_metadata:{providers:['apple']}}),error=>error.code==='APPLE_REAUTH_REQUIRED');
  const count=requests.length;await identity.revoke({id:'email-user'});assert.equal(requests.length,count);
  rejected=true;await assert.rejects(identity.revoke({id:'owner'}),error=>error.code==='UNAVAILABLE');
  assert.ok(saved.has('owner'),'failed deletion keeps an encrypted token for retry');
  const db=new PGlite();
  try{
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);');
    await db.exec(fs.readFileSync('supabase/migrations/20261004141615_apple_identity_tokens.sql','utf8'));
    const result=(await db.query("select relrowsecurity,has_table_privilege('anon','apple_identity_tokens','SELECT') as anon_read,has_table_privilege('authenticated','apple_identity_tokens','SELECT') as account_read,has_table_privilege('service_role','apple_identity_tokens','SELECT') as server_read from pg_class where relname='apple_identity_tokens'" )).rows[0];
    assert.deepEqual(result,{relrowsecurity:true,anon_read:false,account_read:false,server_read:true});
    const id=crypto.randomUUID();await db.query('insert into auth.users values ($1)',[id]);
    await db.query('insert into apple_identity_tokens (user_id,token) values ($1,$2)',[id,JSON.stringify(saved.get('owner').token)]);
    await db.query('delete from auth.users where id=$1',[id]);assert.equal((await db.query('select * from apple_identity_tokens')).rows.length,0);
  }finally{await db.close();}
  console.log('Apple identity: signed code exchange, encrypted account isolation, token revocation, failure recovery and service-only SQL passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
