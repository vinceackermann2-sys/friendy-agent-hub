const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(fs.readFileSync('supabase/migrations/20260928095256_wallet_webhook_queue.sql','utf8'));
    const permissions = (await db.query(`select
      has_table_privilege('anon','belna_wallet_webhook_events','SELECT') as anon_read,
      has_table_privilege('authenticated','belna_wallet_webhook_events','INSERT') as user_write,
      has_function_privilege('authenticated','claim_belna_wallet_webhook_events(integer)','EXECUTE') as user_claim`)).rows[0];
    assert.deepEqual(permissions,{anon_read:false,user_write:false,user_claim:false});
    await db.query("insert into belna_wallet_webhook_events(id,account_id,card_id) values($1,$2,$3)",['msg_one','biz_owner','icrd_purchase']);
    await assert.rejects(db.query("insert into belna_wallet_webhook_events(id,account_id,card_id) values($1,$2,$3)",['msg_one','biz_owner','icrd_purchase']),/duplicate key/);
    const claimed=(await db.query('select * from claim_belna_wallet_webhook_events(5)')).rows;
    assert.equal(claimed.length,1);
    assert.equal(claimed[0].attempt_count,1);
    assert.equal((await db.query('select * from claim_belna_wallet_webhook_events(5)')).rows.length,0,'leased event is not claimed twice');
    await db.exec("update belna_wallet_webhook_events set locked_until=now()-interval '1 second';");
    assert.equal((await db.query('select * from claim_belna_wallet_webhook_events(5)')).rows[0].attempt_count,2,'expired lease can retry');
    await db.exec('update belna_wallet_webhook_events set processed_at=now();');
    assert.equal((await db.query('select * from claim_belna_wallet_webhook_events(5)')).rows.length,0,'processed event is final');
    console.log('Whop wallet webhook queue: service-only access, deduplication, lease retry and completion passed');
  } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exit(1);});
