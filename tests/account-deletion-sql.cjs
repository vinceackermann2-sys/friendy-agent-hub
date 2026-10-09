const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

// Account deletion purges profiles and relies on every owner table cascading from there.
// The wallet references below are copied from their original migrations, so the test
// first shows the purge failing on them, then applies the fix and deletes for real.
(async () => {
  const db = new PGlite(), alice = crypto.randomUUID(), bob = crypto.randomUUID();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.profiles(id text primary key);
      create table public.agent_chat_tasks(id text primary key,user_id text,state jsonb);
      create table public.agent_vm_instances(user_id text primary key, vm_name text not null unique, power_state text);
      create table public.agent_vm_leases(id text primary key, user_id text not null references public.agent_vm_instances(user_id) on delete cascade);
      create table public.belna_wallets(user_id text primary key references public.profiles(id) on delete cascade, card_id text);
      create table public.belna_wallet_transfers(id text primary key, user_id text not null references public.profiles(id) on delete cascade);
      create table public.belna_wallet_payment_requests(id text primary key, user_id text not null references public.profiles(id) on delete cascade);
      alter table public.belna_wallet_transfers add column if not exists payment_request_id text unique references public.belna_wallet_payment_requests(id);
      create table public.belna_wallet_purchases(id text primary key, user_id text not null references public.belna_wallets(user_id), status text);
    `);
    await db.exec(fs.readFileSync('supabase/migrations/20261004133503_apple_device_connections.sql', 'utf8'));
    const seed = async () => {
      await db.query('insert into auth.users values($1),($2) on conflict do nothing', [alice, bob]);
      await db.query('insert into profiles values($1),($2) on conflict do nothing', [alice, bob]);
      await db.query('insert into belna_wallets values($1,$2),($3,$4) on conflict do nothing', [alice, 'icrd_a', bob, 'icrd_b']);
      await db.query("insert into belna_wallet_purchases values('p1',$1,'closed') on conflict do nothing", [alice]);
      await db.query("insert into belna_wallet_payment_requests values('req1',$1) on conflict do nothing", [alice]);
      await db.query("insert into belna_wallet_transfers values('t1',$1,'req1') on conflict do nothing", [bob]);
      await db.query("insert into agent_vm_instances values($1,'lingon-sb-a','deallocated'),($2,'lingon-sb-b','running') on conflict do nothing", [alice, bob]);
      await db.query("insert into agent_vm_leases values('lease-a',$1) on conflict do nothing", [alice]);
    };
    await seed();
    await assert.rejects(db.query('select delete_belna_account_data($1)', [alice]), /foreign key/,
      'the original references block deleting an owner with a card purchase');
    assert.equal((await db.query('select count(*)::int n from profiles where id=$1', [alice])).rows[0].n, 1);

    await db.exec(fs.readFileSync('supabase/migrations/20261008120000_account_deletion_foreign_keys.sql', 'utf8'));
    await db.query('select delete_belna_account_data($1)', [alice]);
    for (const [table, column] of [['profiles', 'id'], ['belna_wallets', 'user_id'], ['belna_wallet_purchases', 'user_id'],
      ['belna_wallet_payment_requests', 'user_id'], ['agent_vm_instances', 'user_id'], ['agent_vm_leases', 'user_id']]) {
      assert.equal((await db.query(`select count(*)::int n from ${table} where ${column}=$1`, [alice])).rows[0].n, 0, `${table} is purged`);
    }
    const transfer = (await db.query("select user_id, payment_request_id from belna_wallet_transfers where id='t1'")).rows[0];
    assert.deepEqual(transfer, { user_id: bob, payment_request_id: null }, 'the payer keeps their transfer; only the link is cleared');
    for (const table of ['profiles', 'belna_wallets', 'agent_vm_instances']) {
      assert.equal((await db.query(`select count(*)::int n from ${table} where ${table === 'profiles' ? 'id' : 'user_id'}=$1`, [bob])).rows[0].n, 1, `another account keeps ${table}`);
    }
    assert.equal((await db.query("select has_function_privilege('anon','delete_belna_account_data(uuid)','EXECUTE') allowed")).rows[0].allowed, false);
    assert.equal((await db.query("select has_function_privilege('service_role','delete_belna_account_data(uuid)','EXECUTE') allowed")).rows[0].allowed, true);
    console.log('account deletion SQL: card purchases and paid requests no longer block the purge, other accounts keep their data: ok');
  } finally { await db.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
