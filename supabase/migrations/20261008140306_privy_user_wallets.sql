-- New wallet mappings do not replace, move or delete previous Whop balances.
create table if not exists public.belna_privy_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  wallet_id text not null unique,
  privy_user_id text not null unique,
  address text not null unique check (address ~ '^0x[0-9a-f]{40}$'),
  owner_email text not null,
  country text not null check (country ~ '^[A-Z]{2}$'),
  daily_limit_usd numeric(10,2) not null default 50 check (daily_limit_usd > 0 and daily_limit_usd <= 50),
  paused boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.belna_privy_wallet_intents (
  id uuid primary key,
  user_id uuid not null references public.belna_privy_wallets(user_id) on delete cascade,
  wallet_id text not null references public.belna_privy_wallets(wallet_id),
  kind text not null check (kind in ('send','withdraw','earn_deposit','earn_withdraw')),
  recipient text not null,
  destination_address text check (destination_address ~ '^0x[0-9a-f]{40}$'),
  vault_id text,
  amount numeric(10,2) not null check (amount > 0 and amount <= 2000),
  status text not null check (status in ('quoted','awaiting_owner','processing','succeeded','failed','rejected','canceled')),
  provider_action_id text unique,
  transaction_hash text check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  check ((kind in ('send','withdraw') and destination_address is not null and vault_id is null) or (kind in ('earn_deposit','earn_withdraw') and vault_id is not null and destination_address is null))
);
create index if not exists privy_wallet_intents_owner_time on public.belna_privy_wallet_intents(user_id,created_at desc);
create table if not exists public.belna_privy_wallet_balances (
  user_id uuid not null references public.belna_privy_wallets(user_id) on delete cascade,
  day date not null,
  available numeric(24,6) not null check (available >= 0),
  primary key (user_id,day)
);
alter table public.belna_privy_wallets enable row level security;
alter table public.belna_privy_wallet_intents enable row level security;
alter table public.belna_privy_wallet_balances enable row level security;
revoke all on public.belna_privy_wallets,public.belna_privy_wallet_intents,public.belna_privy_wallet_balances from anon,authenticated;
grant select on public.belna_privy_wallets,public.belna_privy_wallet_intents,public.belna_privy_wallet_balances to authenticated;
grant all on public.belna_privy_wallets,public.belna_privy_wallet_intents,public.belna_privy_wallet_balances to service_role;
create policy privy_wallet_owner_read on public.belna_privy_wallets for select to authenticated using (user_id=auth.uid());
create policy privy_intents_owner_read on public.belna_privy_wallet_intents for select to authenticated using (user_id=auth.uid());
create policy privy_balances_owner_read on public.belna_privy_wallet_balances for select to authenticated using (user_id=auth.uid());
create or replace function public.begin_privy_wallet_intent(p_user_id uuid,p_id uuid)
returns public.belna_privy_wallet_intents
language plpgsql security definer set search_path=public,pg_temp as $$
declare w public.belna_privy_wallets; i public.belna_privy_wallet_intents; used numeric;
begin
  -- Serialize requests and limit changes for this owner, across all app workers.
  select * into w from public.belna_privy_wallets where user_id=p_user_id for update;
  if not found then raise exception 'wallet unavailable'; end if;
  select * into i from public.belna_privy_wallet_intents where id=p_id and user_id=p_user_id for update;
  if not found or i.wallet_id<>w.wallet_id then raise exception 'intent unavailable'; end if;
  if i.status in ('succeeded','failed','rejected') then return i; end if;
  -- Same idempotency key may be retried after a timeout. Never release an
  -- uncertain reservation: it may already have caused an onchain transaction.
  if i.status='processing' then return i; end if;
  if w.paused then raise exception 'wallet requests paused'; end if;
  if i.status not in ('quoted','awaiting_owner') or i.expires_at<=now() then raise exception 'intent expired'; end if;
  if exists (select 1 from public.belna_privy_wallet_intents where user_id=p_user_id and id<>p_id and status='processing') then raise exception 'check pending wallet action first'; end if;
  if i.kind<>'earn_withdraw' then
    select coalesce(sum(amount),0) into used from public.belna_privy_wallet_intents
      where user_id=p_user_id and kind<>'earn_withdraw' and id<>p_id
      and started_at>now()-interval '24 hours' and status in ('processing','succeeded');
    if used+i.amount>w.daily_limit_usd then raise exception 'daily wallet allowance exceeded'; end if;
  end if;
  update public.belna_privy_wallet_intents set status='processing',started_at=now() where id=p_id returning * into i;
  return i;
end; $$;
revoke all on function public.begin_privy_wallet_intent(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_privy_wallet_intent(uuid,uuid) to service_role;
