alter table public.agent_wallets
  alter column daily_limit_usd type numeric(12,2) using daily_limit_usd::numeric;
alter table public.agent_wallet_tx
  alter column amount type numeric(18,8) using amount::numeric;

create or replace function public.reserve_agent_wallet_spend(
  p_user_id text,
  p_tx_id text,
  p_kind text,
  p_asset text,
  p_amount numeric,
  p_to_address text,
  p_daily_limit numeric,
  p_status text default 'pending'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spent numeric;
  v_row public.agent_wallet_tx%rowtype;
begin
  if p_amount <= 0 or p_daily_limit <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if lower(p_asset) not in ('usdc', 'usd') then raise exception 'INVALID_ASSET'; end if;
  if p_status not in ('pending', 'authorized') then raise exception 'INVALID_STATUS'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id, 492115));
  select coalesce(sum(amount), 0) into v_spent
  from public.agent_wallet_tx
  where user_id = p_user_id
    and lower(asset) in ('usdc', 'usd')
    and status in ('pending', 'sent', 'authorized', 'issued')
    and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc');

  if v_spent + p_amount > p_daily_limit then raise exception 'DAILY_LIMIT'; end if;

  insert into public.agent_wallet_tx(id, user_id, kind, asset, amount, to_address, status)
  values (p_tx_id, p_user_id, p_kind, lower(p_asset), p_amount, p_to_address, p_status)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.reserve_agent_wallet_spend(text, text, text, text, numeric, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.reserve_agent_wallet_spend(text, text, text, text, numeric, text, numeric, text)
  to service_role;
