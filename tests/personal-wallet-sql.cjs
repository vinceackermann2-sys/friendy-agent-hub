const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
 const db=new PGlite();try{
  await db.exec("create role anon;create role authenticated;create role service_role;create table profiles(id text primary key);insert into profiles values('a'),('b'),('c');");
  for(const file of ['20260927150000_belna_wallets.sql','20260927160000_wallet_purchase_cards.sql','20260928110000_wallet_webhook_queue.sql','20260928120000_wallet_connection_recovery.sql','20260929180000_personal_whop_wallets.sql','20260929193000_personal_wallet_application_transition.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  const connect=(id,whop)=>db.query('select connect_personal_whop_wallet($1,$2::jsonb)',[id,JSON.stringify({whop_user_id:whop,owner_email:id+'@example.test',country:'SE',environment:'live',setup_key:id+'setup',card_request_key:id+'card',encrypted_tokens:{v:1},expires_at:new Date(Date.now()+3600000).toISOString()})]);
  await db.exec("insert into belna_wallets(user_id,owner_email,setup_key,card_request_key,country,environment,account_id,owner_provider_id)values('a','a@example.test','oldsetup','oldcard','SE','live','biz_old','user_a');");
  await db.exec("insert into belna_wallet_transfers(id,user_id,recipient_email,destination_id,amount,status)values('pending','a','b@example.test','biz_b',5,'processing');");
  await assert.rejects(connect('a','user_a'),/LEGACY_WALLET_OPERATIONS_PENDING/);
  await db.exec("update belna_wallet_transfers set status='failed';");
  await db.exec("update belna_wallets set application_status='connection_issuance_pending' where user_id='a';");
  await assert.rejects(connect('a','user_a'),/LEGACY_WALLET_OPERATIONS_PENDING/,'uncertain card issuance still blocks migration');
  await db.exec("update belna_wallets set application_status='connection_pending' where user_id='a';");
  await connect('a','user_a');
  const wallet=(await db.query("select * from belna_wallets where user_id='a'")).rows[0];assert.equal(wallet.wallet_kind,'personal');assert.equal(wallet.account_id,'user_a');assert.equal(wallet.legacy_account_id,'biz_old');assert.equal(wallet.card_id,null);
  assert.equal((await db.query("select wallet->>'account_id' as id from belna_wallet_legacy_accounts where user_id='a'")).rows[0].id,'biz_old');
  await assert.rejects(connect('a','user_b'),/PERSONAL_IDENTITY_ALREADY_BOUND/);
  await assert.rejects(connect('b','user_a'),/unique/);assert.equal((await db.query("select count(*) as n from belna_wallets where user_id='b'")).rows[0].n,0,'duplicate binding rolls back wallet and tokens');
  await connect('a','user_a');assert.equal((await db.query("select version from belna_whop_wallet_auth where user_id='a'")).rows[0].version,2);
  await connect('b','user_b');
  await db.exec("insert into belna_whop_wallet_oauth values('a','hash','{}','live',now()+interval '10 minutes');");
  assert.equal((await db.query("select consume_whop_wallet_oauth('b','hash','live') as value")).rows[0].value,null);
  assert.equal((await db.query("select consume_whop_wallet_oauth('a','hash','sandbox') as value")).rows[0].value,null);
  assert.equal((await db.query("select consume_whop_wallet_oauth('a','hash','live') as value")).rows[0].value.user_id,'a');
  assert.equal((await db.query("select consume_whop_wallet_oauth('a','hash','live') as value")).rows[0].value,null);
  assert.equal((await db.query("select claim_whop_wallet_refresh('a',2,'lease1') as ok")).rows[0].ok,true);
  assert.equal((await db.query("select claim_whop_wallet_refresh('a',2,'lease2') as ok")).rows[0].ok,false);
  await assert.rejects(db.query("select finish_whop_wallet_refresh('a','lease2','{}')"),/REFRESH_LEASE_LOST/);
  await db.query('select finish_whop_wallet_refresh($1,$2,$3::jsonb)',['a','lease1',JSON.stringify({encrypted_tokens:{v:2},expires_at:new Date(Date.now()+3600000).toISOString()})]);
  assert.equal((await db.query("select version from belna_whop_wallet_auth where user_id='a'")).rows[0].version,3);
  for(const table of ['belna_whop_wallet_auth','belna_whop_wallet_oauth','belna_wallet_payment_requests','belna_wallet_legacy_accounts'])assert.equal((await db.query("select has_table_privilege('authenticated',$1,'SELECT') as allowed",[table])).rows[0].allowed,false);
  assert.equal((await db.query("select has_function_privilege('anon','connect_personal_whop_wallet(text,jsonb)','EXECUTE') as allowed")).rows[0].allowed,false);
  console.log('Personal wallet SQL: migration, atomic identity binding, legacy balance retention, pending-payment guard, callback ownership, refresh leases and service-only access passed');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
