const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

// Recreates the legacy schema2.sql policies with Supabase's default table grants, shows
// that a signed-in user could read every gift code and edit their own subscription, then
// applies the migration and checks that both are closed while the service role still works.
(async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.profiles(id text primary key);
    create table public.subscriptions(user_id text primary key, plan text not null default 'free', status text not null default 'active',
      stripe_customer_id text, stripe_subscription_id text, current_period_end timestamptz);
    create table public.gift_cards(code text primary key, amount_usd double precision, from_user text, redeemed_by text);
    create table public.api_usage(id serial primary key, user_id text, cost_usd double precision);
    create table public.vault_secrets(id text primary key, user_id text, encrypted_value jsonb);
    alter table public.profiles enable row level security;
    alter table public.subscriptions enable row level security;
    alter table public.gift_cards enable row level security;
    alter table public.api_usage enable row level security;
    alter table public.vault_secrets enable row level security;
    create policy "profiles owner" on public.profiles for all using (auth.uid()::text = id) with check (auth.uid()::text = id);
    create policy "subs owner" on public.subscriptions for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
    create policy "usage owner" on public.api_usage for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
    create policy "secrets owner" on public.vault_secrets for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
    create policy "gifts readable" on public.gift_cards for select using (auth.role() = 'authenticated');
    grant all on all tables in schema public to anon, authenticated, service_role;
    grant all on all sequences in schema public to anon, authenticated, service_role;
    insert into public.profiles values ('11111111-1111-1111-1111-111111111111');
    insert into public.subscriptions(user_id) values ('11111111-1111-1111-1111-111111111111');
    insert into public.gift_cards values ('LNG-SECRET', 100, 'stripe:cs_paid_by_someone_else', null);
  `);
  const asUser = async (sql) => {
    await db.exec(`set request.jwt.sub = '11111111-1111-1111-1111-111111111111'; set role authenticated;`);
    try { return (await db.query(sql)).rows; } finally { await db.exec('reset role;'); }
  };
  const denied = async (sql) => assert.rejects(asUser(sql), /permission denied/);

  // The exposure the migration closes.
  assert.deepEqual((await asUser('select code from public.gift_cards')).map(r => r.code), ['LNG-SECRET']);
  await asUser("update public.subscriptions set plan = 'max', status = 'active'");
  assert.equal((await db.query('select plan from public.subscriptions')).rows[0].plan, 'max');
  await db.exec("update public.subscriptions set plan = 'free'");

  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20261005120000_close_legacy_table_access.sql'), 'utf8'));

  await denied('select code from public.gift_cards');
  await denied("update public.subscriptions set plan = 'max', status = 'active'");
  await denied("insert into public.api_usage(user_id, cost_usd) values ('11111111-1111-1111-1111-111111111111', -100)");
  await denied('select * from public.vault_secrets');
  await denied('select * from public.profiles');
  assert.equal((await db.query('select plan from public.subscriptions')).rows[0].plan, 'free');
  assert.equal((await db.query("select count(*)::int as n from pg_policies where schemaname = 'public'")).rows[0].n, 0);
  // Tables created later by the same role do not regain anon/authenticated access.
  await db.exec('create table public.later_table(id text primary key)');
  await denied('select * from public.later_table');
  // The server's service role keeps full access.
  await db.exec('set role service_role;');
  assert.equal((await db.query('select count(*)::int as n from public.gift_cards')).rows[0].n, 1);
  await db.exec("update public.subscriptions set plan = 'pro'; reset role;");
  // Running it twice is harmless.
  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20261005120000_close_legacy_table_access.sql'), 'utf8'));
  await db.close();
  console.log('table access SQL: legacy policies and anon/authenticated grants closed: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
