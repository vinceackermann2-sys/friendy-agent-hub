-- Owner-scoped card interest and observed balances. These never grant card access.
create table if not exists public.belna_card_waitlist (
  user_id text primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.belna_card_waitlist enable row level security;
revoke all on public.belna_card_waitlist from anon, authenticated;
grant all on public.belna_card_waitlist to service_role;

create table if not exists public.belna_wallet_balance_history (
  user_id text not null references public.profiles(id) on delete cascade,
  account_id text not null,
  environment text not null check(environment in ('sandbox','live')),
  observed_at timestamptz not null default clock_timestamp(),
  available_usd numeric(18,2) not null,
  pending_usd numeric(18,2) not null,
  primary key(user_id,account_id,environment,observed_at)
);
alter table public.belna_wallet_balance_history enable row level security;
revoke all on public.belna_wallet_balance_history from anon, authenticated;
grant all on public.belna_wallet_balance_history to service_role;

create or replace function public.record_belna_wallet_balance(p_user_id text,p_account_id text,p_environment text,p_available numeric,p_pending numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_wallet public.belna_wallets%rowtype; v_last public.belna_wallet_balance_history%rowtype; v_points jsonb;
begin
  if p_available is null or p_pending is null or p_available::text in ('NaN','Infinity','-Infinity') or p_pending::text in ('NaN','Infinity','-Infinity') then
    raise exception 'INVALID_BALANCE';
  end if;
  select * into v_wallet from public.belna_wallets where user_id=p_user_id for update;
  if not found or v_wallet.account_id is null or v_wallet.account_id is distinct from p_account_id or v_wallet.environment is distinct from p_environment then return '[]'::jsonb; end if;
  select * into v_last from public.belna_wallet_balance_history
    where user_id=p_user_id and account_id=v_wallet.account_id and environment=v_wallet.environment
    order by observed_at desc limit 1;
  if not found or v_last.available_usd is distinct from round(p_available,2) or v_last.pending_usd is distinct from round(p_pending,2) then
    insert into public.belna_wallet_balance_history(user_id,account_id,environment,available_usd,pending_usd)
      values(p_user_id,v_wallet.account_id,v_wallet.environment,round(p_available,2),round(p_pending,2));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('at',observed_at,'total',available_usd+pending_usd) order by observed_at),'[]'::jsonb)
    into v_points from (
      select observed_at,available_usd,pending_usd from public.belna_wallet_balance_history
        where user_id=p_user_id and account_id=v_wallet.account_id and environment=v_wallet.environment
        order by observed_at desc limit 180
    ) points;
  return v_points;
end;
$$;
revoke all on function public.record_belna_wallet_balance(text,text,text,numeric,numeric) from public,anon,authenticated;
grant execute on function public.record_belna_wallet_balance(text,text,text,numeric,numeric) to service_role;
