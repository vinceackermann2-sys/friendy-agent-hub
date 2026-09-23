const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.profiles(id text primary key);
    insert into public.profiles values ('u1'), ('u2');
    create table public.credit_grants(id text primary key, user_id text references public.profiles(id),
      credits double precision, reason text, ref text, created_at timestamptz default now());
    create table public.gift_cards(code text primary key, amount_usd double precision,
      from_user text, to_user text, redeemed_by text, redeemed_at timestamptz, created_at timestamptz default now());
    create table public.api_usage(id text primary key, user_id text references public.profiles(id),
      model text, cost_usd double precision, credits_charged double precision);
    create table public.agent_vm_instances(user_id text primary key, power_state text);
    insert into public.credit_grants(id,user_id,credits,reason,ref) values
      ('g1','u1',20,'free_starter','free'), ('g2','u1',20,'free_starter','free');
    insert into public.gift_cards(code,amount_usd,from_user) values ('LNG-TEST',50,'stripe:cs_1');
  `);
  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20260923084323_billing_atomicity_and_vm_metering.sql'), 'utf8'));
  const q = async (sql) => (await db.query(sql)).rows;
  assert.equal((await q("select sum(credits) as n from public.credit_grants where user_id='u1'"))[0].n, 20);
  assert.equal((await q("select count(*)::integer as n from public.credit_grants where reason='duplicate_starter'"))[0].n, 1);
  const first = await q("select * from public.redeem_gift_card('u1','LNG-TEST')");
  assert.equal(first[0].ok, true);
  assert.equal(first[0].credits, 100);
  const second = await q("select * from public.redeem_gift_card('u2','LNG-TEST')");
  assert.equal(second[0].ok, false);
  assert.equal((await q("select count(*)::integer as n from public.credit_grants where ref='LNG-TEST'"))[0].n, 1);
  await db.exec("insert into public.agent_vm_instances(user_id,power_state,last_metered_at) values ('u1','running',now()-interval '1 hour')");
  const metered = await q("select public.meter_agent_vm_runtime('u1',0.06,false) as credits");
  assert.ok(metered[0].credits >= 1.19 && metered[0].credits < 1.3);
  const stopped = await q("select public.meter_agent_vm_runtime('u1',0.06,true) as credits");
  assert.ok(stopped[0].credits < 0.01);
  assert.equal((await q("select last_metered_at from public.agent_vm_instances where user_id='u1'"))[0].last_metered_at, null);
  await db.close();
  console.log('billing SQL: atomic gifts, deduped starters and VM meter: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
