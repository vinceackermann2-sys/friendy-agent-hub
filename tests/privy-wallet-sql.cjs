const assert = require('node:assert/strict'),
  fs = require('fs');
const { PGlite } = require('@electric-sql/pglite');
(async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user_id',true),'')::uuid$$;",
    );
    await db.exec(
      fs.readFileSync('supabase/migrations/20261008140306_privy_user_wallets.sql', 'utf8'),
    );
    await db.exec(fs.readFileSync('supabase/migrations/20261008203000_privy_bank_withdrawals.sql', 'utf8'));
    const a = '10000000-0000-4000-8000-000000000001',
      b = '10000000-0000-4000-8000-000000000002';
    await db.query('insert into auth.users values ($1),($2)', [a, b]);
    await db.query(
      "insert into belna_privy_wallets(user_id,wallet_id,privy_user_id,address,owner_email,country) values($1,'wa','did:privy:a',$3,'a@example.com','SE'),($2,'wb','did:privy:b',$4,'b@example.com','SE')",
      [a, b, '0x' + '1'.repeat(40), '0x' + '2'.repeat(40)],
    );
    const ids = Array.from(
      { length: 5 },
      (_, i) => '20000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
    );
    const add = async (id, amount = 30) =>
      db.query(
        "insert into belna_privy_wallet_intents(id,user_id,wallet_id,kind,recipient,destination_address,amount,status,expires_at) values($1,$2,'wa','send','bob',$3,$4,'quoted',now()+interval '10 minutes')",
        [id, a, '0x' + '2'.repeat(40), amount],
      );
    await add(ids[0]);
    await add(ids[1], 25);
    await add(ids[2], 10);
    await add(ids[3], 1);
    await add(ids[4], 1);
    const begin = (user, id) =>
      db.query('select row_to_json(begin_privy_wallet_intent($1,$2)) as result', [user, id]);
    await assert.rejects(begin(b, ids[0]), /unavailable/);
    assert.equal((await begin(a, ids[0])).rows[0].result.status, 'processing');
    assert.equal((await begin(a, ids[0])).rows[0].result.status, 'processing');
    assert.equal(
      (
        await db.query(
          "update belna_privy_wallet_intents set status='canceled' where id=$1 and status in ('quoted','awaiting_owner') returning id",
          [ids[0]],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "update belna_privy_wallet_intents set status='awaiting_owner' where id=$1 and status='quoted' returning id",
          [ids[0]],
        )
      ).rows.length,
      0,
    );
    await assert.rejects(begin(a, ids[1]), /pending wallet action/);
    await db.query(
      "update belna_privy_wallet_intents set started_at=now()-interval '2 days' where id=$1",
      [ids[0]],
    );
    await assert.rejects(
      begin(a, ids[1]),
      /pending wallet action/,
      'uncertain actions never release at midnight',
    );
    await db.query(
      "update belna_privy_wallet_intents set status='succeeded',started_at=now() where id=$1",
      [ids[0]],
    );
    await assert.rejects(begin(a, ids[1]), /allowance exceeded/);
    const bankId='30000000-0000-4000-8000-000000000001';
    await db.query("insert into belna_privy_wallet_intents(id,user_id,wallet_id,kind,recipient,fiat_account_id,amount,status,expires_at) values($1,$2,'wa','bank_withdraw','Bank ····3000 · EUR','bank_alice',25,'quoted',now()+interval '10 minutes')",[bankId,a]);
    await assert.rejects(begin(a,bankId),/allowance exceeded/,'bank payouts share the rolling owner limit');
    await assert.rejects(db.query("update belna_privy_wallet_intents set fiat_account_id=null where id=$1",[bankId]),/constraint/);
    await db.query('update belna_privy_wallets set paused=true where user_id=$1', [a]);
    await assert.rejects(begin(a, ids[2]), /paused/);
    await db.query('update belna_privy_wallets set paused=false where user_id=$1', [a]);
    await db.query(
      "update belna_privy_wallet_intents set expires_at=now()-interval '1 second' where id=$1",
      [ids[3]],
    );
    await assert.rejects(begin(a, ids[3]), /expired/);
    await db.query("update belna_privy_wallet_intents set status='canceled' where id=$1", [ids[4]]);
    await assert.rejects(begin(a, ids[4]), /expired/);
    await db.query("select set_config('test.user_id',$1,false)", [a]);
    await db.exec('set role authenticated');
    assert.equal((await db.query('select * from belna_privy_wallets')).rows.length, 1);
    await assert.rejects(
      db.query('update belna_privy_wallets set daily_limit_usd=50'),
      /permission denied/,
    );
    await assert.rejects(begin(a, ids[2]), /permission denied/);
    await db.exec('reset role;set role anon');
    await assert.rejects(db.query('select * from belna_privy_wallets'), /permission denied/);
    await db.exec('reset role');
    await db.query('delete from auth.users where id=$1', [a]);
    assert.equal((await db.query('select * from belna_privy_wallet_intents')).rows.length, 0);
    console.log(
      'Privy SQL: owner RLS, service-only mutations, reservations, daily allowance, pause, expiry and account deletion passed',
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
