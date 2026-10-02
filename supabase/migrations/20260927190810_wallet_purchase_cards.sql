create table if not exists public.belna_wallet_purchases (
  id text primary key,
  user_id text not null references public.belna_wallets(user_id),
  approval_key text not null,
  account_id text not null,
  environment text not null check (environment in ('sandbox','live')),
  merchant text not null,
  amount numeric(12,2) not null check (amount between 1 and 2000),
  approved_detail text not null,
  status text not null default 'issuing' check (status in ('issuing','ready','submitted','paid','closed')),
  card_id text unique,
  last4 text,
  expires_at timestamptz not null,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id,approval_key)
);
alter table public.belna_wallet_purchases enable row level security;
revoke all on public.belna_wallet_purchases from anon, authenticated;
grant all on public.belna_wallet_purchases to service_role;
create index if not exists wallet_purchase_recovery on public.belna_wallet_purchases(environment,created_at) where canceled_at is null;

create or replace function public.claim_wallet_purchase(p_user_id text, p_purchase jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.belna_wallet_purchases%rowtype; v_wallet public.belna_wallets%rowtype; v_reserved numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id, 492119));
  select * into v_wallet from public.belna_wallets where user_id=p_user_id for update;
  if not found or v_wallet.account_id is distinct from p_purchase->>'account_id'
    or v_wallet.environment is distinct from p_purchase->>'environment' then raise exception 'WALLET_NOT_FOUND'; end if;
  select * into v_row from public.belna_wallet_purchases where user_id=p_user_id and approval_key=p_purchase->>'approval_key';
  if found then return jsonb_build_object('claimed',false,'purchase',to_jsonb(v_row)); end if;
  select coalesce(sum(amount),0) into v_reserved from public.belna_wallet_purchases
    where user_id=p_user_id and (canceled_at is null or created_at > now()-interval '24 hours');
  if v_wallet.card_status='frozen' or v_reserved+(p_purchase->>'amount')::numeric > v_wallet.daily_card_limit then raise exception 'PURCHASE_LIMIT'; end if;
  if (p_purchase->>'expires_at')::timestamptz <= now() or (p_purchase->>'expires_at')::timestamptz > now()+interval '16 minutes' then raise exception 'INVALID_EXPIRY'; end if;
  insert into public.belna_wallet_purchases(id,user_id,approval_key,account_id,environment,merchant,amount,approved_detail,expires_at)
    values(p_purchase->>'id',p_user_id,p_purchase->>'approval_key',v_wallet.account_id,v_wallet.environment,p_purchase->>'merchant',
      (p_purchase->>'amount')::numeric,p_purchase->>'approved_detail',(p_purchase->>'expires_at')::timestamptz) returning * into v_row;
  return jsonb_build_object('claimed',true,'purchase',to_jsonb(v_row));
end $$;
revoke all on function public.claim_wallet_purchase(text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_wallet_purchase(text,jsonb) to service_role;
