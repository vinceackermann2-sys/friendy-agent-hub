-- One referral gift per recipient. The two credit grants and referral record
-- are committed together, so a failed write cannot consume the code.
create unique index if not exists referrals_redeemer_once_idx
  on public.referrals(redeemer_id);

create or replace function public.redeem_referral(p_user_id text, p_code text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_code text := upper(regexp_replace(trim(coalesce(p_code, '')), '[^A-Za-z0-9-]', '', 'g'));
  v_inviter text;
  v_referral_id text;
  v_reward constant double precision := 50;
begin
  if p_user_id is null or p_user_id = '' then
    return jsonb_build_object('ok', false, 'error', 'Sign in to redeem a gift code.');
  end if;
  if v_code = '' then
    return jsonb_build_object('ok', false, 'error', 'Enter your friend’s gift code.');
  end if;

  select user_id into v_inviter from public.referral_codes where code = v_code;
  if v_inviter is null then
    return jsonb_build_object('ok', false, 'error', 'Code not found. Check the code and try again.');
  end if;
  if v_inviter = p_user_id then
    return jsonb_build_object('ok', false, 'error', 'You can’t redeem your own gift code — share it with a friend.');
  end if;

  insert into public.referrals(id, code, inviter_id, redeemer_id, inviter_credits, redeemer_credits)
  values ('rf_' || gen_random_uuid()::text, v_code, v_inviter, p_user_id, v_reward, v_reward)
  on conflict do nothing
  returning id into v_referral_id;
  if v_referral_id is null then
    return jsonb_build_object('ok', false, 'error', 'You already redeemed a referral gift.');
  end if;

  insert into public.credit_grants(id, user_id, credits, reason, ref)
  values
    ('gr_' || gen_random_uuid()::text, p_user_id, v_reward, 'referral_redeem', 'referral:' || v_referral_id),
    ('gr_' || gen_random_uuid()::text, v_inviter, v_reward, 'referral_inviter', 'referral-inviter:' || v_referral_id);

  return jsonb_build_object(
    'ok', true, 'code', v_code, 'credits', v_reward, 'inviterCredits', v_reward
  );
end;
$$;

revoke all on function public.redeem_referral(text, text) from public, anon, authenticated;
grant execute on function public.redeem_referral(text, text) to service_role;
