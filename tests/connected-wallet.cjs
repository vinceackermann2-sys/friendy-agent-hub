const assert=require('node:assert/strict');
const {createBelnaWallet}=require('../server/belna-wallet');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
  let row={user_id:'alice',wallet_kind:'personal',account_id:'user_alice'},creates=0,configReads=0;
  const calls=[];
  const store={supaConfigured:()=>true,getBelnaWallet:async()=>row,
    getConnectedWalletConfiguration:async()=>{configReads++;return {WHOP_COMPANY_API_KEY:'connected-key',WHOP_PLATFORM_ACCOUNT_ID:'biz_platform',WHOP_SANDBOX:'false'};},
    claimConnectedBelnaWallet:async(id,fields)=>row={user_id:id,...fields},
    saveBelnaWallet:async(id,fields)=>Object.assign(row,fields),listBelnaWalletTransfers:async()=>[]};
  const wallet=createBelnaWallet({store,env:{WHOP_COMPANY_API_KEY:'obsolete-key',WHOP_PLATFORM_ACCOUNT_ID:'biz_wrong'},fetchImpl:async(url,init)=>{
    const u=new URL(url);calls.push(u.pathname);
    assert.equal(u.hostname,'api.whop.com');assert.equal(init.headers.Authorization,'Bearer connected-key');
    let data;
    if(u.pathname==='/api/v1/accounts/biz_platform')data={id:'biz_platform'};
    else if(u.pathname==='/api/v1/accounts'){creates++;const body=JSON.parse(init.body);assert.equal(body.email,'alice@example.test');assert.equal(body.metadata.external_id,'alice');data={id:'biz_alice',owner:{id:'user_alice'},parent_account:{id:'biz_platform'}};}
    else if(u.pathname==='/api/v1/accounts/biz_alice')data={id:'biz_alice',parent_account:{id:'biz_platform'},balances:[{symbol:'USD',breakdown:{available:'0',pending:'0'}}]};
    else if(u.pathname==='/api/v1/financial_activity')data={data:[]};else throw Error('Unexpected provider request');
    return {ok:true,json:async()=>data};
  }});
  const before=await wallet.snapshot('alice');assert.equal(before.wallet.kind,'connected');assert.equal(before.wallet.status,'not_created');assert.equal(before.wallet.previousPersonalWallet,true);assert.equal(creates,0);
  await assert.rejects(wallet.finishConnect({id:'alice'},{}),/previous personal wallet cannot issue cards/);
  await assert.rejects(wallet.setup({id:'alice',email:'alice@example.test'},{country:'SE'}),/Confirm your email/);
  const user={id:'alice',email:'alice@example.test',email_confirmed_at:'2026-09-30'};
  const after=await wallet.setup(user,{country:'SE'});assert.equal(after.wallet.kind,'connected');assert.equal(row.wallet_kind,'business');assert.equal(row.account_id,'biz_alice');
  await wallet.setup(user,{country:'SE'});assert.equal(creates,1,'retries reuse the saved sub-account');assert.equal(configReads,1);assert.ok(!calls.some(p=>/oauth|users\/me|cards/.test(p)));
  const personalRecord=async()=>({user_id:'alice',wallet_kind:'personal',account_id:'user_alice'});
  const missingStore={...store,getBelnaWallet:personalRecord,claimConnectedBelnaWallet:undefined,claimBelnaWallet:async()=>{throw Error('Old personal setup must never run');}};
  await assert.rejects(createBelnaWallet({store:missingStore,env:{}}).setup(user,{country:'SE'}),/Wallet setup is not configured/);
  const incorrectStore={...store,getBelnaWallet:personalRecord,claimConnectedBelnaWallet:personalRecord};
  await assert.rejects(createBelnaWallet({store:incorrectStore,env:{}}).setup(user,{country:'SE'}),/connected wallet setup could not be confirmed/);
  const productionStore=await import('../src/lingon-server/store.js');
  assert.equal(typeof productionStore.getConnectedWalletConfiguration,'function','production API exports the connected-account configuration loader');
  assert.equal(typeof productionStore.claimConnectedBelnaWallet,'function','production API exports the connected-account claim instead of reusing personal setup');

  const db=new PGlite();try{
    await db.exec("create role anon;create role authenticated;create role service_role;create table profiles(id text primary key);insert into profiles values('a');");
    for(const file of ['20260927190808_belna_wallets.sql','20260927190810_wallet_purchase_cards.sql','20260928095256_wallet_webhook_queue.sql','20260928100947_wallet_connection_recovery.sql','20260929180000_personal_whop_wallets.sql','20260930152346_connected_whop_wallets.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
    await db.exec("insert into belna_wallets(user_id,owner_email,country,environment,setup_key,card_request_key,wallet_kind,account_id,owner_provider_id)values('a','a@example.test','SE','live','old-setup','old-card','personal','user_a','user_a');insert into belna_wallet_legacy_accounts values('a','{\"account_id\":\"biz_old\"}');insert into belna_whop_wallet_auth(user_id,whop_user_id,environment,encrypted_tokens,expires_at)values('a','user_a','live','{}',now());insert into belna_wallet_transfers(id,user_id,recipient_email,destination_id,amount,status)values('pending','a','b@example.test','user_b',5,'processing');");
    const prepare=()=>db.query('select prepare_connected_whop_wallet($1,$2::jsonb) as wallet',['a',JSON.stringify({owner_email:'a@example.test',country:'SE',environment:'live',setup_key:'new-setup',card_request_key:'new-card',daily_card_limit:50})]);
    await assert.rejects(prepare(),/PREVIOUS_WALLET_OPERATIONS_PENDING/);assert.equal((await db.query('select count(*)::int as n from belna_wallet_connection_history')).rows[0].n,0);
    await db.exec("update belna_wallet_transfers set status='failed';");
    const result=(await prepare()).rows[0].wallet;assert.equal(result.wallet_kind,'business');assert.equal(result.account_id,null);
    assert.equal((await db.query("select wallet->>'account_id' as id from belna_wallet_connection_history")).rows[0].id,'user_a');
    assert.equal((await db.query("select wallet->>'account_id' as id from belna_wallet_legacy_accounts")).rows[0].id,'biz_old');
    assert.equal((await db.query('select count(*)::int as n from belna_whop_wallet_auth')).rows[0].n,1,'old tokens are retained for balance recovery');
    await db.exec("update belna_wallets set account_id='biz_new',owner_provider_id='user_a';");assert.equal((await prepare()).rows[0].wallet.account_id,'biz_new','duplicate setup preserves the provider mapping');
    assert.equal((await db.query("select has_table_privilege('authenticated','belna_wallet_connection_history','SELECT') as allowed")).rows[0].allowed,false);
    assert.equal((await db.query("select has_function_privilege('anon','prepare_connected_whop_wallet(text,jsonb)','EXECUTE') as allowed")).rows[0].allowed,false);
  }finally{await db.close();}
  console.log('Connected wallets: server configuration, explicit setup, owner mapping, idempotency, pending-payment guard and preserved former balances passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
