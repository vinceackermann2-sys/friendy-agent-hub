-- Keep a single spend reservation per buyer, merchant, and checkout. Historical
-- wallet tables are intentionally retained so past balances and transactions
-- are not deleted when the old wallet integration is retired.
drop function if exists public.reserve_agent_wallet_spend(text, text, text, text, numeric, text, numeric, text);

create or replace function public.reserve_shop_pay_spend(
  p_user_id text,
  p_order_id text,
  p_merchant text,
  p_checkout_id text,
  p_cart_id text,
  p_amount numeric,
  p_currency text,
  p_title text,
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
  v_row public.shop_pay_orders%rowtype;
begin
  if p_amount <= 0 or p_daily_limit <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_status not in ('pending', 'authorized', 'escalated') then raise exception 'INVALID_STATUS'; end if;
  if p_checkout_id is null or p_checkout_id = '' then raise exception 'INVALID_CHECKOUT'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id, 718293));
  select * into v_row from public.shop_pay_orders
  where user_id = p_user_id and merchant_domain = p_merchant and checkout_id = p_checkout_id
  order by created_at desc limit 1;
  if found then
    if v_row.amount <> p_amount or v_row.currency <> upper(p_currency) then
      raise exception 'CHECKOUT_CHANGED';
    end if;
    return to_jsonb(v_row);
  end if;

  select coalesce(sum(amount), 0) into v_spent from public.shop_pay_orders
  where user_id = p_user_id
    and status in ('pending', 'authorized', 'escalated', 'completed')
    and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc');
  if v_spent + p_amount > p_daily_limit then raise exception 'DAILY_LIMIT'; end if;

  insert into public.shop_pay_orders(id, user_id, merchant_domain, checkout_id, cart_id, status, amount, currency, title)
  values (p_order_id, p_user_id, p_merchant, p_checkout_id, p_cart_id, p_status, p_amount, upper(p_currency), p_title)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.reserve_shop_pay_spend(text, text, text, text, text, numeric, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.reserve_shop_pay_spend(text, text, text, text, text, numeric, text, text, numeric, text)
  to service_role;
