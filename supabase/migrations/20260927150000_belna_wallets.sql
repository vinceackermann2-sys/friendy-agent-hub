-- Separate from usage-token wallets and the retired crypto wallet schema.
create table if not exists public.belna_wallets (
  user_id text primary key references public.profiles(id) on delete cascade,
  owner_email text not null unique,
  setup_key text not null unique,
  account_id text unique,
  owner_provider_id text,
  country text not null,
  environment text not null check (environment in ('sandbox', 'live')),
  card_id text unique,
  card_last4 text,
  card_status text,
  card_request_key text not null unique,
  application_status text,
  daily_card_limit numeric(12,2) not null default 50 check (daily_card_limit > 0 and daily_card_limit <= 2000),
  created_at timestamptz not null default now()
);
alter table public.belna_wallets enable row level security;
revoke all on public.belna_wallets from anon, authenticated;
grant all on public.belna_wallets to service_role;

create table if not exists public.belna_wallet_transfers (
  id text primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  recipient_email text not null,
  destination_id text not null,
  amount numeric(12,2) not null check (amount > 0 and amount <= 50),
  status text not null default 'quoted' check (status in ('quoted','processing','succeeded','failed')),
  provider_id text,
  created_at timestamptz not null default now()
);
alter table public.belna_wallet_transfers enable row level security;
revoke all on public.belna_wallet_transfers from anon, authenticated;
grant all on public.belna_wallet_transfers to service_role;

create or replace function public.begin_belna_wallet_transfer(p_user_id text, p_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.belna_wallet_transfers%rowtype; v_spent numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id, 492118));
  select * into v_row from public.belna_wallet_transfers where id=p_id and user_id=p_user_id for update;
  if not found then raise exception 'QUOTE_NOT_FOUND'; end if;
  if v_row.status <> 'quoted' then return to_jsonb(v_row); end if;
  if v_row.created_at < now() - interval '10 minutes' then raise exception 'QUOTE_EXPIRED'; end if;
  -- A rolling 24-hour window retains unresolved reservations across midnight.
  select coalesce(sum(amount),0) into v_spent from public.belna_wallet_transfers
    where user_id=p_user_id and status in ('processing','succeeded')
      and (status='processing' or created_at >= now() - interval '24 hours');
  if v_spent + v_row.amount > 50 then raise exception 'TRANSFER_LIMIT'; end if;
  update public.belna_wallet_transfers set status='processing' where id=p_id returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.begin_belna_wallet_transfer(text,text) from public, anon, authenticated;
grant execute on function public.begin_belna_wallet_transfer(text,text) to service_role;
