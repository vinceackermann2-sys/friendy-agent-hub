const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role; create table public.profiles(id text primary key); insert into public.profiles values ('u1'), ('u2');");
  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20260918180000_agent_wallets.sql'), 'utf8'));
  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20260919110000_wallet_spend_reservations.sql'), 'utf8'));
  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20260921180000_shop_pay.sql'), 'utf8'));
  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20260923110000_shop_pay_checkout_idempotency.sql'), 'utf8'));
  const retired = await db.query("select to_regprocedure('public.reserve_agent_wallet_spend(text,text,text,text,numeric,text,numeric,text)') as old_rpc");
  assert.equal(retired.rows[0].old_rpc, null, 'old wallet spending RPC is retired');
  assert.equal((await db.query('select count(*)::int as n from public.agent_wallets')).rows[0].n, 0, 'historical wallet table remains available');
  const reserve = async (user, id, checkout, amount) => (await db.query(
    "select public.reserve_shop_pay_spend($1,$2,'shop.example',$3,null,$4,'USD','Hat',200,'authorized') as order",
    [user, id, checkout, amount],
  )).rows[0].order;
  const first = await reserve('u1', 'spo_1', 'chk_1', 25);
  const repeat = await reserve('u1', 'spo_2', 'chk_1', 25);
  assert.equal(repeat.id, first.id, 'retries reuse the first reservation');
  assert.equal((await db.query("select count(*)::int as n from public.shop_pay_orders where user_id='u1'")).rows[0].n, 1);
  await assert.rejects(reserve('u1', 'spo_3', 'chk_1', 26), /CHECKOUT_CHANGED/);
  await assert.rejects(reserve('u1', 'spo_4', 'chk_2', 180), /DAILY_LIMIT/);
  const otherUser = await reserve('u2', 'spo_5', 'chk_1', 25);
  assert.equal(otherUser.user_id, 'u2');
  await db.close();
  console.log('shop pay SQL: idempotent spend reservation and account limits: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
