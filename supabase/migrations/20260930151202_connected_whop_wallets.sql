-- Preserve prior personal connections; switching never moves provider funds.
create table public.belna_wallet_connection_history (
  user_id text not null references public.profiles(id) on delete cascade,
  account_id text not null,
  environment text not null check(environment in ('live','sandbox')),
  wallet jsonb not null,
  archived_at timestamptz not null default now(),
  primary key(user_id,account_id,environment)
);
alter table public.belna_wallet_connection_history enable row level security;
revoke all on public.belna_wallet_connection_history from public,anon,authenticated;
grant all on public.belna_wallet_connection_history to service_role;

create function public.prepare_connected_whop_wallet(p_user_id text,p_wallet jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_wallet public.belna_wallets%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id,492118));
  select * into v_wallet from public.belna_wallets where user_id=p_user_id for update;
  if found and v_wallet.wallet_kind='business' then return to_jsonb(v_wallet); end if;
  if exists(select 1 from public.belna_wallet_purchases where user_id=p_user_id and canceled_at is null)
    or exists(select 1 from public.belna_wallet_transfers where user_id=p_user_id and status='processing') then
    raise exception 'PREVIOUS_WALLET_OPERATIONS_PENDING';
  end if;
  if v_wallet.account_id is not null then
    insert into public.belna_wallet_connection_history(user_id,account_id,environment,wallet)
      values(p_user_id,v_wallet.account_id,v_wallet.environment,to_jsonb(v_wallet))
      on conflict(user_id,account_id,environment) do nothing;
  end if;
  insert into public.belna_wallets(user_id,owner_email,country,environment,setup_key,card_request_key,daily_card_limit,wallet_kind)
    values(p_user_id,p_wallet->>'owner_email',p_wallet->>'country',p_wallet->>'environment',p_wallet->>'setup_key',p_wallet->>'card_request_key',(p_wallet->>'daily_card_limit')::numeric,'business')
    on conflict(user_id) do update set owner_email=excluded.owner_email,country=excluded.country,environment=excluded.environment,
      setup_key=excluded.setup_key,card_request_key=excluded.card_request_key,daily_card_limit=excluded.daily_card_limit,
      wallet_kind='business',account_id=null,owner_provider_id=null,card_id=null,card_last4=null,card_status=null,
      application_status=null,last_connection_check_at=null
    returning * into v_wallet;
  return to_jsonb(v_wallet);
end;$$;
revoke all on function public.prepare_connected_whop_wallet(text,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_connected_whop_wallet(text,jsonb) to service_role;
