create table if not exists public.agent_wallets (
  user_id text primary key references public.profiles(id) on delete cascade,
  privy_wallet_id text unique,
  address text,
  external_id text unique,
  chain text not null default 'base',
  card jsonb not null default '{"status":"none"}'::jsonb,
  daily_limit_usd double precision not null default 50,
  envelopes jsonb not null default '[]'::jsonb,
  stripe_cardholder_id text,
  created_at timestamptz not null default now()
);
create table if not exists public.agent_wallet_tx (
  id text primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  kind text not null default 'transfer',
  asset text not null default 'usdc',
  amount double precision not null default 0,
  to_address text,
  status text not null default 'pending',
  tx_hash text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists agent_wallet_tx_user_idx on public.agent_wallet_tx(user_id, created_at desc);
alter table public.agent_wallets enable row level security;
alter table public.agent_wallet_tx enable row level security;
revoke all on public.agent_wallets, public.agent_wallet_tx from anon, authenticated;
grant all on public.agent_wallets, public.agent_wallet_tx to service_role;
