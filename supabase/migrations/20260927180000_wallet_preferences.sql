create table if not exists public.belna_wallet_preferences (
 user_id text primary key references public.profiles(id) on delete cascade,
 active_method text check(active_method in ('belna_wallet','existing_card')),
 merchant_enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table public.belna_wallet_preferences enable row level security;
revoke all on public.belna_wallet_preferences from anon,authenticated;
grant all on public.belna_wallet_preferences to service_role;
create table if not exists public.belna_existing_purchases (
 user_id text not null references public.profiles(id) on delete cascade,
 approval_key text not null,
 merchant text not null,
 amount numeric(12,2) not null check(amount>0),
 currency text not null,
 status text not null default 'awaiting_confirmation',
 created_at timestamptz not null default now(),
 primary key(user_id,approval_key)
);
alter table public.belna_existing_purchases enable row level security;
revoke all on public.belna_existing_purchases from anon,authenticated;
grant all on public.belna_existing_purchases to service_role;
