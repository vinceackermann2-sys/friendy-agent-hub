-- Lingon migration 2: billing + hardened RLS. Run in SQL Editor AFTER schema.sql.
-- Plans: free $0 ($10 credit) / pro $30 was $50 ($20 credit + $50 gift) /
-- max $50 was $100 ($50 credit + $100 gift). No fake charges: upgrades are requests.

create table if not exists subscriptions (
  user_id text primary key references profiles(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','pro','max')),
  status text not null default 'active',
  updated_at timestamptz default now()
);

create table if not exists api_usage (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  model text default 'gemini-2.5-flash',
  prompt_tokens int default 0,
  candidates_tokens int default 0,
  total_tokens int default 0,
  cost_usd numeric default 0,
  created_at timestamptz default now()
);
create index if not exists usage_user_idx on api_usage(user_id, created_at desc);

create table if not exists gift_cards (
  code text primary key,
  amount_usd numeric not null,
  from_user text,
  to_user text,
  redeemed_by text,
  redeemed_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists upgrade_requests (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  plan text not null,
  status text not null default 'requested',
  created_at timestamptz default now()
);

alter table subscriptions enable row level security;
alter table api_usage enable row level security;
alter table gift_cards enable row level security;
alter table upgrade_requests enable row level security;

-- Tighten profiles: drop the permissive dev policy, require auth owner.
do $$ begin
  if exists (select 1 from pg_policies where policyname = 'own rows' and tablename = 'profiles') then
    drop policy "own rows" on profiles;
  end if;
end $$;
create policy "profiles owner" on profiles for all
  using (auth.uid()::text = id) with check (auth.uid()::text = id);

-- Owner-only policies for user tables (backend service_role bypasses RLS).
drop policy if exists "memories owner" on memories;
create policy "memories owner" on memories for all
  using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
drop policy if exists "secrets owner" on vault_secrets;
create policy "secrets owner" on vault_secrets for all
  using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
drop policy if exists "subs owner" on subscriptions;
create policy "subs owner" on subscriptions for all
  using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
drop policy if exists "usage owner" on api_usage;
create policy "usage owner" on api_usage for all
  using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
drop policy if exists "upgrades owner" on upgrade_requests;
create policy "upgrades owner" on upgrade_requests for all
  using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
-- Gift cards: anyone authed can read a code to redeem; redeem is server-checked.
drop policy if exists "gifts readable" on gift_cards;
create policy "gifts readable" on gift_cards for select using (auth.role() = 'authenticated');
