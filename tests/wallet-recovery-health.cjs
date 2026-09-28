const assert=require('node:assert/strict');
const {createBelnaWalletStore}=require('../server/belna-wallet-store');

(async()=>{
  const now=Date.now();
  let enabled='true',health={ok:true,environment:'live',platformAccountId:'biz_owner',checkedAt:new Date(now-60000).toISOString()},failure=false;
  const client={rpc:async(name,args)=>{
    assert.equal(name,'get_server_secret');
    if(failure)throw Error('Database unavailable');
    return {data:args.p_name==='wallet_recovery_enabled'?enabled:JSON.stringify(health)};
  }};
  const store=createBelnaWalletStore({supa:()=>client,ensureProfile:async()=>{}});
  const ready=()=>store.walletRecoveryReady('biz_owner','live',now);
  assert.equal(await ready(),true);
  enabled='false';assert.equal(await ready(),false,'dormant schedule cannot enable checkout');enabled='true';
  health.ok=false;assert.equal(await ready(),false,'worker failure immediately blocks checkout');health.ok=true;
  health.checkedAt=new Date(now-180000).toISOString();assert.equal(await ready(),false,'stale worker blocks checkout');
  health.checkedAt=new Date(now+60000).toISOString();assert.equal(await ready(),false,'future timestamps cannot bypass freshness');
  health.checkedAt=new Date(now-60000).toISOString();
  assert.equal(await store.walletRecoveryReady('biz_other','live',now),false,'health belongs to one platform');
  assert.equal(await store.walletRecoveryReady('biz_owner','sandbox',now),false,'live health cannot enable sandbox cards');
  health=null;assert.equal(await ready(),false,'malformed health blocks checkout');
  failure=true;assert.equal(await ready(),false,'database failure blocks checkout');
  const esm=await import('../src/lingon-server/belna-wallet-store.js');
  failure=false;health={ok:true,environment:'live',platformAccountId:'biz_owner',checkedAt:new Date(now).toISOString()};
  assert.equal(await esm.createBelnaWalletStore({supa:()=>client}).walletRecoveryReady('biz_owner','live',now),true,'Lovable mirror has same health gate');
  console.log('Wallet recovery health: activation, freshness, failure, account/environment isolation and ESM parity passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
