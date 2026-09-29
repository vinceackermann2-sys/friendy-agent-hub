-- Personal user ledgers are connected by OAuth, never created with /accounts.
alter table public.belna_wallets add column if not exists wallet_kind text not null default 'business' check(wallet_kind in ('business','personal'));
alter table public.belna_wallets add column if not exists legacy_account_id text;
alter table public.belna_wallet_transfers add column if not exists origin_id text;
create table public.belna_wallet_legacy_accounts (
  user_id text primary key references public.profiles(id) on delete cascade,
  wallet jsonb not null
);
alter table public.belna_wallet_legacy_accounts enable row level security;
revoke all on public.belna_wallet_legacy_accounts from public,anon,authenticated;
grant all on public.belna_wallet_legacy_accounts to service_role;

create table public.belna_whop_wallet_auth (
  user_id text primary key references public.profiles(id) on delete cascade,
  whop_user_id text not null unique check(whop_user_id ~ '^user_[A-Za-z0-9]+$'),
  environment text not null check(environment in ('live','sandbox')),
  encrypted_tokens jsonb not null,
  expires_at timestamptz not null,
  version bigint not null default 1,
  refresh_lease text,
  refresh_locked_until timestamptz
);
create table public.belna_whop_wallet_oauth (
  user_id text primary key references public.profiles(id) on delete cascade,
  state_hash text not null unique,
  encrypted_verifier jsonb not null,
  environment text not null check(environment in ('live','sandbox')),
  expires_at timestamptz not null
);
alter table public.belna_whop_wallet_auth enable row level security;
alter table public.belna_whop_wallet_oauth enable row level security;
revoke all on public.belna_whop_wallet_auth,public.belna_whop_wallet_oauth from public,anon,authenticated;
grant all on public.belna_whop_wallet_auth,public.belna_whop_wallet_oauth to service_role;

create function public.consume_whop_wallet_oauth(p_user_id text,p_state_hash text,p_environment text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_state public.belna_whop_wallet_oauth%rowtype;
begin
  delete from public.belna_whop_wallet_oauth where user_id=p_user_id and state_hash=p_state_hash and environment=p_environment and expires_at>now() returning * into v_state;
  if not found then return null; end if;
  return to_jsonb(v_state);
end;$$;

create function public.connect_personal_whop_wallet(p_user_id text,p_connection jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_wallet public.belna_wallets%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id,492118));
  select * into v_wallet from public.belna_wallets where user_id=p_user_id for update;
  if v_wallet.wallet_kind='personal' and (v_wallet.account_id<>p_connection->>'whop_user_id' or v_wallet.environment<>p_connection->>'environment') then raise exception 'PERSONAL_IDENTITY_ALREADY_BOUND'; end if;
  if v_wallet.wallet_kind='business' and (
    exists(select 1 from public.belna_wallet_purchases where user_id=p_user_id and canceled_at is null)
    or exists(select 1 from public.belna_wallet_transfers where user_id=p_user_id and status='processing')
    or exists(select 1 from public.belna_wallets where user_id=p_user_id and application_status in ('connection_pending','connection_issuance_pending','connection_card','connection_card_provisioning','connection_issuance_provisioning','connection_card_invitation'))
  ) then raise exception 'LEGACY_WALLET_OPERATIONS_PENDING'; end if;
  if v_wallet.wallet_kind='business' and v_wallet.account_id is not null then
    insert into public.belna_wallet_legacy_accounts(user_id,wallet) values(p_user_id,to_jsonb(v_wallet)) on conflict(user_id) do nothing;
  end if;
  insert into public.belna_wallets(user_id,owner_email,country,environment,setup_key,card_request_key,account_id,owner_provider_id,wallet_kind)
  values(p_user_id,p_connection->>'owner_email',p_connection->>'country',p_connection->>'environment',p_connection->>'setup_key',p_connection->>'card_request_key',p_connection->>'whop_user_id',p_connection->>'whop_user_id','personal')
  on conflict(user_id) do update set owner_email=excluded.owner_email,wallet_kind='personal',
    legacy_account_id=case when belna_wallets.wallet_kind='business' then belna_wallets.account_id else belna_wallets.legacy_account_id end,
    account_id=excluded.account_id,owner_provider_id=excluded.owner_provider_id,
    environment=excluded.environment,
    card_id=case when belna_wallets.wallet_kind='personal' then belna_wallets.card_id end,
    card_last4=case when belna_wallets.wallet_kind='personal' then belna_wallets.card_last4 end,
    card_status=case when belna_wallets.wallet_kind='personal' then belna_wallets.card_status end,
    application_status=case when belna_wallets.wallet_kind='personal' then belna_wallets.application_status end,
    card_request_key=case when belna_wallets.wallet_kind='personal' then belna_wallets.card_request_key else excluded.card_request_key end;
  insert into public.belna_whop_wallet_auth(user_id,whop_user_id,environment,encrypted_tokens,expires_at)
  values(p_user_id,p_connection->>'whop_user_id',p_connection->>'environment',p_connection->'encrypted_tokens',(p_connection->>'expires_at')::timestamptz)
  on conflict(user_id) do update set encrypted_tokens=excluded.encrypted_tokens,expires_at=excluded.expires_at,version=belna_whop_wallet_auth.version+1,refresh_lease=null,refresh_locked_until=null;
end;$$;

create function public.claim_whop_wallet_refresh(p_user_id text,p_version bigint,p_lease text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.belna_whop_wallet_auth set refresh_lease=p_lease,refresh_locked_until=now()+interval '60 seconds'
    where user_id=p_user_id and version=p_version and (refresh_locked_until is null or refresh_locked_until<now());
  return found;
end;$$;
create function public.finish_whop_wallet_refresh(p_user_id text,p_lease text,p_tokens jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.belna_whop_wallet_auth set encrypted_tokens=p_tokens->'encrypted_tokens',expires_at=(p_tokens->>'expires_at')::timestamptz,version=version+1,refresh_lease=null,refresh_locked_until=null where user_id=p_user_id and refresh_lease=p_lease;
  if not found then raise exception 'REFRESH_LEASE_LOST'; end if;
end;$$;
create function public.release_whop_wallet_refresh(p_user_id text,p_lease text)
returns void language sql security definer set search_path=public as $$
  update public.belna_whop_wallet_auth set refresh_lease=null,refresh_locked_until=null where user_id=p_user_id and refresh_lease=p_lease;
$$;
revoke all on function public.consume_whop_wallet_oauth(text,text,text),public.connect_personal_whop_wallet(text,jsonb),public.claim_whop_wallet_refresh(text,bigint,text),public.finish_whop_wallet_refresh(text,text,jsonb),public.release_whop_wallet_refresh(text,text) from public,anon,authenticated;
grant execute on function public.consume_whop_wallet_oauth(text,text,text),public.connect_personal_whop_wallet(text,jsonb),public.claim_whop_wallet_refresh(text,bigint,text),public.finish_whop_wallet_refresh(text,text,jsonb),public.release_whop_wallet_refresh(text,text) to service_role;

-- Receive links ask another Belna wallet owner to review a ledger transfer.
-- A personal user is not a company_id for a merchant checkout plan.
create table public.belna_wallet_payment_requests (
  id text primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  destination_id text not null check(destination_id ~ '^user_[A-Za-z0-9]+$'),
  environment text not null check(environment in ('live','sandbox')),
  title text not null check(length(title) between 1 and 120),
  amount numeric(12,2) not null check(amount>=1 and amount<=50),
  created_at timestamptz not null default now()
);
alter table public.belna_wallet_payment_requests enable row level security;
revoke all on public.belna_wallet_payment_requests from public,anon,authenticated;
grant all on public.belna_wallet_payment_requests to service_role;
alter table public.belna_wallet_transfers add column if not exists payment_request_id text unique references public.belna_wallet_payment_requests(id);
alter table public.belna_wallet_webhook_events drop constraint belna_wallet_webhook_events_account_id_check;
alter table public.belna_wallet_webhook_events add constraint belna_wallet_webhook_events_account_id_check check(account_id ~ '^(biz|user)_[A-Za-z0-9]+$');
