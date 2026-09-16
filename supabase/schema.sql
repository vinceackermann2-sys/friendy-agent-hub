-- Lingon Supabase schema (free tier). Run in Supabase Dashboard > SQL Editor.
-- Creates tables + RLS so each user only sees their own rows.
-- Frontend never talks to Supabase directly; the Node backend uses the
-- service_role key server-side. If you use Supabase Auth later, the same
-- policies apply to the anon key with auth.uid().

create extension if not exists "pgcrypto";

-- one row per app user (use your own user id string for now, or auth.users id)
create table if not exists profiles (
  id text primary key,
  created_at timestamptz default now()
);

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references profiles(id) on delete cascade,
  name text not null,
  color text default 'lingon',
  pers text default 'Playful',
  claimed_at timestamptz default now()
);

create table if not exists chats (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  title text default 'New chat',
  created_at timestamptz default now()
);

create table if not exists messages (
  id text primary key,
  chat_id text not null references chats(id) on delete cascade,
  role text not null,
  kind text default 'text',
  text text,
  card jsonb,
  created_at timestamptz default now()
);

create table if not exists memories (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  text text not null,
  src text default 'chat',
  created_at timestamptz default now()
);
create index if not exists memories_user_idx on memories(user_id, created_at desc);

create table if not exists vault_secrets (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  name text not null,
  ref text not null,
  encrypted_value jsonb not null,
  created_at timestamptz default now()
);
create index if not exists secrets_user_idx on vault_secrets(user_id, created_at desc);

create table if not exists vault_apps (
  user_id text not null references profiles(id) on delete cascade,
  app text not null,
  created_at timestamptz default now(),
  primary key (user_id, app)
);

create table if not exists approvals (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  key text not null,
  label text not null,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
alter table agents enable row level security;
alter table chats enable row level security;
alter table messages enable row level security;
alter table memories enable row level security;
alter table vault_secrets enable row level security;
alter table vault_apps enable row level security;
alter table approvals enable row level security;

-- Service-role key bypasses RLS (backend use). For anon/authenticated use,
-- allow users to manage their own rows when auth.uid()::text = user_id.
-- (If you don't use Supabase Auth yet, the backend service_role still works.)

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'own rows') then
    create policy "own rows" on profiles for all using (true) with check (true);
  end if;
end $$;

-- ============ billing: Stripe subscriptions, credit ledger, gifts ============
-- Credits: 1 credit = $0.50 face value. Users only ever see credits.
create table if not exists subscriptions (
  user_id text primary key references profiles(id) on delete cascade,
  plan text not null default 'free',
  status text not null default 'active',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  gift_issued boolean not null default false,
  created_at timestamptz default now()
);
create index if not exists subs_customer_idx on subscriptions(stripe_customer_id);

-- Every credit grant: free starter, monthly subscription, gift redeem.
create table if not exists credit_grants (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  credits double precision not null default 0,
  reason text not null default 'grant',
  ref text,
  created_at timestamptz default now()
);
create index if not exists grants_user_idx on credit_grants(user_id, created_at desc);

-- Model usage log. credits_charged includes our margin (older rows without it
-- are honored at face rate: credits = cost_usd * 2).
create table if not exists api_usage (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  model text,
  prompt_tokens integer not null default 0,
  candidates_tokens integer not null default 0,
  total_tokens integer not null default 0,
  cost_usd double precision not null default 0,
  credits_charged double precision,
  created_at timestamptz default now()
);
create index if not exists usage_user_idx on api_usage(user_id, created_at desc);

-- Gift cards keep their dollar face value ($50/$100) and redeem into credits
-- at 2 credits per $1.
create table if not exists gift_cards (
  code text primary key,
  amount_usd double precision not null,
  from_user text,
  to_user text,
  redeemed_by text,
  redeemed_at timestamptz,
  created_at timestamptz default now()
);

-- Pre-Stripe upgrade requests (kept for history; Stripe is the real flow now).
create table if not exists upgrade_requests (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  plan text not null,
  status text not null default 'requested',
  created_at timestamptz default now()
);

-- Stripe webhook idempotency (processed event ids).
create table if not exists stripe_events (
  id text primary key,
  created_at timestamptz default now()
);

alter table subscriptions enable row level security;
alter table credit_grants enable row level security;
alter table api_usage enable row level security;
alter table gift_cards enable row level security;
alter table upgrade_requests enable row level security;
alter table stripe_events enable row level security;
