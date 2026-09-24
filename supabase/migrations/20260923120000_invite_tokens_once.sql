-- One friend per invite code and one free invite redemption per account.
-- Existing grants keep their original amounts; new claims grant 10M tokens to each side.
create unique index if not exists referrals_redeemer_once_idx
  on public.referrals(redeemer_id);

create or replace function public.redeem_referral(p_user_id text, p_code text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_code text := upper(regexp_replace(trim(coalesce(p_code, '')), '[^A-Za-z0-9-]', '', 'g'));
  v_inviter text;
  v_referral_id text;
  v_tokens constant bigint := 10000000;
begin
  if p_user_id is null or p_user_id = '' then
    return jsonb_build_object('ok', false, 'error', 'Sign in to redeem an invite code.');
  end if;
  if v_code = '' then
    return jsonb_build_object('ok', false, 'error', 'Enter your friend’s invite code.');
  end if;

  -- Serializes claims for the same code, including concurrent requests.
  select user_id into v_inviter from public.referral_codes where code = v_code for update;
  if v_inviter is null then
    return jsonb_build_object('ok', false, 'error', 'Code not found. Check the code and try again.');
  end if;
  if v_inviter = p_user_id then
    return jsonb_build_object('ok', false, 'error', 'You can’t redeem your own invite code.');
  end if;
  if exists (select 1 from public.referrals where redeemer_id = p_user_id) then
    return jsonb_build_object('ok', false, 'error', 'You already redeemed a free invite.');
  end if;
  if exists (select 1 from public.referrals where code = v_code) then
    return jsonb_build_object('ok', false, 'error', 'This invite code has already been used.');
  end if;

  insert into public.referrals(id, code, inviter_id, redeemer_id, inviter_credits, redeemer_credits)
  values ('rf_' || gen_random_uuid()::text, v_code, v_inviter, p_user_id, 0, 0)
  on conflict do nothing returning id into v_referral_id;
  if v_referral_id is null then
    return jsonb_build_object('ok', false, 'error', 'You already redeemed a free invite.');
  end if;

  insert into public.token_grants(id, user_id, tokens, remaining, reason, ref) values
    ('tg_' || gen_random_uuid()::text, p_user_id, v_tokens, v_tokens, 'referral', 'referral:' || v_referral_id),
    ('tg_' || gen_random_uuid()::text, v_inviter, v_tokens, v_tokens, 'referral', 'referral-inviter:' || v_referral_id);
  return jsonb_build_object('ok', true, 'code', v_code, 'credits', 0,
    'inviterCredits', 0, 'tokens', v_tokens, 'inviterTokens', v_tokens);
end $$;
revoke all on function public.redeem_referral(text, text) from public, anon, authenticated;
grant execute on function public.redeem_referral(text, text) to service_role;
