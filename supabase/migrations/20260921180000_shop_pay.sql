create table if not exists public.shop_pay_accounts (
  user_id text primary key references public.profiles(id) on delete cascade,
  shop_subject text,
  email text,
  display_name text,
  scopes text not null default '',
  encrypted_shop_token jsonb,
  encrypted_refresh_token jsonb,
  shop_token_expires_at timestamptz,
  daily_limit_usd numeric(12,2) not null default 200,
  oauth_state text unique,
  oauth_verifier text,
  oauth_redirect text,
  oauth_nonce text,
  oauth_exp timestamptz,
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists public.shop_pay_orders (
  id text primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  merchant_domain text not null,
  checkout_id text,
  cart_id text,
  order_id text,
  status text not null default 'pending',
  amount numeric(12,2) not null default 0,
  currency text not null default 'USD',
  title text,
  continue_url text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists shop_pay_orders_user_idx on public.shop_pay_orders(user_id, created_at desc);
create index if not exists shop_pay_accounts_oauth_idx on public.shop_pay_accounts(oauth_state);

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

  perform pg_advisory_xact_lock(hashtextextended(p_user_id, 718293));
  select coalesce(sum(amount), 0) into v_spent
  from public.shop_pay_orders
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

alter table public.shop_pay_accounts enable row level security;
alter table public.shop_pay_orders enable row level security;
revoke all on public.shop_pay_accounts, public.shop_pay_orders from anon, authenticated;
grant all on public.shop_pay_accounts, public.shop_pay_orders to service_role;
revoke all on function public.reserve_shop_pay_spend(text, text, text, text, text, numeric, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.reserve_shop_pay_spend(text, text, text, text, text, numeric, text, text, numeric, text)
  to service_role;
