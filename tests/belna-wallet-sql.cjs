const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
  const db=new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role; create table public.profiles(id text primary key); insert into public.profiles values ('u1'),('u2');");
    await db.exec(fs.readFileSync('supabase/migrations/20260927190808_belna_wallets.sql','utf8'));
    await db.exec("insert into belna_wallets(user_id,owner_email,setup_key,card_request_key,country,environment,account_id) values('u1','a@example.com','setup1','card1','SE','live','biz_a');");
    await assert.rejects(db.exec("insert into belna_wallets(user_id,owner_email,setup_key,card_request_key,country,environment,account_id) values('u2','b@example.com','setup2','card2','SE','live','biz_a');"),/unique/,'two owners cannot share the same provider wallet');
    await db.exec("insert into belna_wallets(user_id,owner_email,setup_key,card_request_key,country,environment,account_id) values('u2','b@example.com','setup2','card2','SE','live','biz_b');");
    await db.exec("insert into public.belna_wallet_transfers(id,user_id,recipient_email,destination_id,amount) values('q1','u1','b@example.com','biz_b',30),('q2','u1','b@example.com','biz_b',25),('q3','u2','a@example.com','biz_a',10);");
    const begin=(owner,id)=>db.query('select public.begin_belna_wallet_transfer($1,$2) as result',[owner,id]);
    await assert.rejects(begin('u2','q1'),/QUOTE_NOT_FOUND/);
    assert.equal((await begin('u1','q1')).rows[0].result.status,'processing');
    assert.equal((await begin('u1','q1')).rows[0].result.status,'processing','retry reuses reservation');
    await assert.rejects(begin('u1','q2'),/TRANSFER_LIMIT/);
    await db.exec("update public.belna_wallet_transfers set created_at=now()-interval '2 days' where id='q1';");
    await assert.rejects(begin('u1','q2'),/TRANSFER_LIMIT/,'unresolved sends never release at midnight');
    await db.exec("update public.belna_wallet_transfers set status='failed' where id='q1';");
    assert.equal((await begin('u1','q2')).rows[0].result.status,'processing');
    await db.exec("update public.belna_wallet_transfers set created_at=now()-interval '11 minutes' where id='q3';");
    await assert.rejects(begin('u2','q3'),/QUOTE_EXPIRED/);
    const permissions=await db.query("select has_table_privilege('authenticated','public.belna_wallets','SELECT') as readable, has_function_privilege('authenticated','public.begin_belna_wallet_transfer(text,text)','EXECUTE') as executable;");
    assert.equal(permissions.rows[0].readable,false);assert.equal(permissions.rows[0].executable,false);
    console.log('Belna wallet SQL: ownership, expired approvals, rolling allowance, reservation retries and service-only access passed');
  }finally{await db.close();}
})().catch(e=>{console.error(e);process.exit(1);});
