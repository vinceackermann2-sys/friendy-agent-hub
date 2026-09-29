-- An unissued business card application is not an unsettled money movement.
-- Keep guards for purchases, transfers and any attempt that could issue a card.
create or replace function public.connect_personal_whop_wallet(p_user_id text,p_connection jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_wallet public.belna_wallets%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id,492118));
  select * into v_wallet from public.belna_wallets where user_id=p_user_id for update;
  if v_wallet.wallet_kind='personal' and (v_wallet.account_id<>p_connection->>'whop_user_id' or v_wallet.environment<>p_connection->>'environment') then raise exception 'PERSONAL_IDENTITY_ALREADY_BOUND'; end if;
  if v_wallet.wallet_kind='business' and (
    exists(select 1 from public.belna_wallet_purchases where user_id=p_user_id and canceled_at is null)
    or exists(select 1 from public.belna_wallet_transfers where user_id=p_user_id and status='processing')
    or exists(select 1 from public.belna_wallets where user_id=p_user_id and application_status in ('connection_issuance_pending','connection_card','connection_card_provisioning','connection_issuance_provisioning','connection_card_invitation'))
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
