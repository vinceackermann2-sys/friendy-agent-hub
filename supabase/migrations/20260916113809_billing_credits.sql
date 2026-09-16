-- Belna billing migration: credits ledger + Stripe columns.
-- Run once in Supabase Dashboard > SQL Editor. Safe to re-run (all IF NOT EXISTS).
--
-- What it does:
--   1. Adds Stripe columns to subscriptions (monthly Pro/Max tracking).
--   2. Creates credit_grants (free starter, monthly subscription, gift redeem).
--   3. Adds api_usage.credits_charged (usage with our margin built in).
--   4. Creates stripe_events (webhook idempotency).
-- Gift cards keep their dollar face value ($50/$100) and redeem into credits
-- at 2 credits per $1. Users only ever see credits — never raw API costs.

-- 1. Stripe columns on subscriptions
alter table if exists subscriptions add column if not exists stripe_customer_id text;
alter table if exists subscriptions add column if not exists stripe_subscription_id text;
alter table if exists subscriptions add column if not exists current_period_end timestamptz;
alter table if exists subscriptions add column if not exists gift_issued boolean not null default false;
create index if not exists subs_customer_idx on subscriptions(stripe_customer_id);

-- 2. Credit grants ledger
create table if not exists credit_grants (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  credits double precision not null default 0,
  reason text not null default 'grant',
  ref text,
  created_at timestamptz default now()
);
create index if not exists grants_user_idx on credit_grants(user_id, created_at desc);

-- 3. Usage margin column (older rows without it are honored at face rate)
alter table if exists api_usage add column if not exists credits_charged double precision;

-- 4. Webhook idempotency
create table if not exists stripe_events (
  id text primary key,
  created_at timestamptz default now()
);

-- Fresh installs that never created these: full definitions live in schema.sql.
-- These two may already exist from the old backend; create if missing.
create table if not exists gift_cards (
  code text primary key,
  amount_usd double precision not null,
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

alter table credit_grants enable row level security;
alter table stripe_events enable row level security;
alter table gift_cards enable row level security;
alter table upgrade_requests enable row level security;
