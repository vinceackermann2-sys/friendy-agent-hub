-- Monthly raw-token allowance, purchased token grants, and atomic daily limits.
-- Apply together with the matching server release; old credit rows remain intact.
create table if not exists public.token_grants (
  id text primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  tokens bigint not null check (tokens > 0),
  remaining bigint not null check (remaining >= 0),
  reason text not null,
  ref text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, ref),
  check (remaining <= tokens)
);
create index if not exists token_grants_spend_idx on public.token_grants(user_id, expires_at, created_at)
  where remaining > 0;
create table if not exists public.token_debts (
  user_id text primary key references public.profiles(id) on delete cascade,
  tokens bigint not null default 0 check (tokens >= 0)
);
create table if not exists public.token_daily_claims (
  id text primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('image', 'transcription')),
  day date not null,
  finalized boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists token_daily_claims_limit_idx
  on public.token_daily_claims(user_id, day, kind);
alter table public.api_usage add column if not exists tokens_charged bigint;
alter table public.api_usage add column if not exists token_usage_estimated boolean not null default false;

alter table public.token_grants enable row level security;
alter table public.token_debts enable row level security;
alter table public.token_daily_claims enable row level security;
revoke all on public.token_grants, public.token_debts, public.token_daily_claims from anon, authenticated;
grant all on public.token_grants, public.token_debts, public.token_daily_claims to service_role;

-- Legacy paid pack spending was not attributed to individual grants. Never
-- silently discard or guess a remaining paid balance during conversion.
do $$ begin
  if exists(select 1 from public.credit_grants where reason = 'credit_pack' and credits > 0) then
    raise exception 'Legacy paid credit packs need an account-level conversion review before token migration';
  end if;
end $$;

-- Current paid subscribers receive this already-paid period once. The ref
-- matches checkout/invoice fulfillment, so replayed webhooks cannot double it.
with current_invoice as (
  select distinct on (g.user_id) g.user_id,g.ref,s.plan,s.current_period_end
  from public.credit_grants g join public.subscriptions s on s.user_id = g.user_id
  where g.reason = 'subscription' and g.ref like 'subscription:invoice:%'
    and s.plan in ('pro','max') and s.status in ('active','canceling','trialing')
    and s.current_period_end > now()
  order by g.user_id,g.created_at desc
)
insert into public.token_grants(id,user_id,tokens,remaining,reason,ref,expires_at)
select 'tg_' || gen_random_uuid()::text,user_id,
  case when plan = 'pro' then 100000000 else 200000000 end,
  case when plan = 'pro' then 100000000 else 200000000 end,
  'plan','token-' || ref,current_period_end
from current_invoice on conflict (user_id,ref) do nothing;

create or replace function public.token_wallet_status(p_user_id text)
returns table(
  granted bigint, used bigint, remaining bigint, plan_granted bigint,
  plan_used bigint, pack_granted bigint, pack_used bigint,
  debt bigint, images_today integer, transcriptions_today integer
)
language sql security definer stable set search_path = public as $$
  with active as (
    select reason, tokens, remaining from public.token_grants
    where user_id = p_user_id and (expires_at is null or expires_at > now())
  ), sums as (
    select coalesce(sum(tokens),0)::bigint granted,
      coalesce(sum(tokens - remaining),0)::bigint used,
      coalesce(sum(remaining),0)::bigint available,
      coalesce(sum(tokens) filter (where reason = 'plan'),0)::bigint plan_granted,
      coalesce(sum(tokens - remaining) filter (where reason = 'plan'),0)::bigint plan_used,
      coalesce(sum(tokens) filter (where reason <> 'plan'),0)::bigint pack_granted,
      coalesce(sum(tokens - remaining) filter (where reason <> 'plan'),0)::bigint pack_used
    from active
  ), claims as (
    select count(*) filter (where kind = 'image')::integer images_today,
      count(*) filter (where kind = 'transcription')::integer transcriptions_today
    from public.token_daily_claims where user_id = p_user_id and day = (now() at time zone 'utc')::date
  )
  select s.granted, s.used,
    greatest(0, s.available - coalesce(d.tokens,0))::bigint,
    s.plan_granted, s.plan_used, s.pack_granted, s.pack_used,
    coalesce(d.tokens,0)::bigint, c.images_today, c.transcriptions_today
  from sums s cross join claims c left join public.token_debts d on d.user_id = p_user_id;
$$;

create or replace function public.claim_token_daily(
  p_user_id text, p_kind text, p_limit integer, p_claim_id text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_day date := (clock_timestamp() at time zone 'utc')::date;
  v_balance bigint; v_count integer;
begin
  if p_kind not in ('image','transcription') or p_limit < 0 or p_limit > 100
    or p_claim_id is null or length(p_claim_id) > 100 then
    raise exception 'Invalid daily token claim';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id, 91));
  if exists(select 1 from public.token_daily_claims where id = p_claim_id and user_id = p_user_id and kind = p_kind) then
    return true;
  end if;
  select remaining into v_balance from public.token_wallet_status(p_user_id);
  if coalesce(v_balance,0) <= 0 then return false; end if;
  select count(*) into v_count from public.token_daily_claims
    where user_id = p_user_id and kind = p_kind and day = v_day;
  if v_count >= p_limit then return false; end if;
  insert into public.token_daily_claims(id,user_id,kind,day)
    values(p_claim_id,p_user_id,p_kind,v_day);
  return true;
end $$;

create or replace function public.release_token_daily(p_user_id text, p_claim_id text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from public.token_daily_claims
    where id = p_claim_id and user_id = p_user_id and not finalized;
  return found;
end $$;

create or replace function public.charge_raw_tokens(
  p_usage_id text, p_user_id text, p_model text,
  p_input bigint, p_output bigint, p_total bigint,
  p_cost_usd double precision, p_estimated boolean default false,
  p_claim_id text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_needed bigint; v_take bigint; v_grant public.token_grants%rowtype;
  v_prior public.api_usage%rowtype; v_balance bigint;
begin
  if p_usage_id is null or length(p_usage_id) > 120 or p_total < 0 or p_total > 1000000000
    or p_input < 0 or p_output < 0 or p_cost_usd < 0 or p_cost_usd > 100000
    or p_input + p_output > p_total then
    raise exception 'Invalid token usage';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id, 91));
  select * into v_prior from public.api_usage where id = p_usage_id;
  if found then
    if v_prior.user_id <> p_user_id or v_prior.tokens_charged is distinct from p_total then
      raise exception 'Conflicting token usage id';
    end if;
    select remaining into v_balance from public.token_wallet_status(p_user_id);
    return coalesce(v_balance,0);
  end if;
  if p_claim_id is not null and not exists(
    select 1 from public.token_daily_claims where id = p_claim_id and user_id = p_user_id
  ) then raise exception 'Missing daily claim'; end if;

  -- Repay any prior one-call overage before spending the new usage.
  v_needed := p_total + coalesce((select tokens from public.token_debts where user_id = p_user_id),0);
  for v_grant in
    select * from public.token_grants
    where user_id = p_user_id and remaining > 0 and (expires_at is null or expires_at > clock_timestamp())
    order by expires_at asc nulls last, created_at asc, id asc for update
  loop
    exit when v_needed = 0;
    v_take := least(v_grant.remaining, v_needed);
    update public.token_grants set remaining = remaining - v_take where id = v_grant.id;
    v_needed := v_needed - v_take;
  end loop;
  insert into public.token_debts(user_id,tokens) values(p_user_id,v_needed)
    on conflict (user_id) do update set tokens = excluded.tokens;
  insert into public.api_usage(
    id,user_id,model,prompt_tokens,candidates_tokens,total_tokens,
    cost_usd,credits_charged,tokens_charged,token_usage_estimated
  ) values(
    p_usage_id,p_user_id,p_model,p_input,p_output,p_total,
    p_cost_usd,0,p_total,coalesce(p_estimated,false)
  );
  if p_claim_id is not null then
    update public.token_daily_claims set finalized = true where id = p_claim_id and user_id = p_user_id;
  end if;
  select remaining into v_balance from public.token_wallet_status(p_user_id);
  return coalesce(v_balance,0);
end $$;

revoke all on function public.token_wallet_status(text) from public, anon, authenticated;
revoke all on function public.claim_token_daily(text,text,integer,text) from public, anon, authenticated;
revoke all on function public.release_token_daily(text,text) from public, anon, authenticated;
revoke all on function public.charge_raw_tokens(text,text,text,bigint,bigint,bigint,double precision,boolean,text)
  from public, anon, authenticated;
grant execute on function public.token_wallet_status(text) to service_role;
grant execute on function public.claim_token_daily(text,text,integer,text) to service_role;
grant execute on function public.release_token_daily(text,text) to service_role;
grant execute on function public.charge_raw_tokens(text,text,text,bigint,bigint,bigint,double precision,boolean,text)
  to service_role;

-- $50 and $100 gift codes grant 1M and 2M raw tokens respectively. This is
-- priced against the $15/M image-output worst case, including card fees.
insert into public.token_grants(id,user_id,tokens,remaining,reason,ref)
select 'tg_' || gen_random_uuid()::text, redeemed_by,
  round(amount_usd * 20000)::bigint, round(amount_usd * 20000)::bigint,
  'gift', 'gift:' || code
from public.gift_cards where redeemed_by is not null and amount_usd in (50,100)
on conflict (user_id,ref) do nothing;

-- Older gift redemptions can exist only in the credit ledger (without a
-- linked redeemed gift-card row). Convert those once at the gift ratio.
insert into public.token_grants(id,user_id,tokens,remaining,reason,ref)
select 'tg_' || gen_random_uuid()::text, g.user_id,
  round(g.credits * 10000)::bigint, round(g.credits * 10000)::bigint,
  'gift', 'gift:' || g.ref
from public.credit_grants g
where g.reason = 'gift_redeem' and g.credits > 0 and g.ref is not null
  and not exists (
    select 1 from public.gift_cards c
    where c.redeemed_by = g.user_id
      and (c.code = g.ref or g.ref = 'backfill:legacy')
  )
on conflict (user_id,ref) do nothing;

create or replace function public.redeem_gift_card(p_user_id text, p_code text)
returns table(ok boolean, amount double precision, credits double precision, error text)
language plpgsql security definer set search_path = public as $$
declare v_card public.gift_cards%rowtype;
  v_code text := upper(trim(coalesce(p_code,'')));
  v_tokens bigint;
begin
  if p_user_id is null or p_user_id = '' or v_code = '' then
    return query select false, 0::double precision, 0::double precision, 'Code not found.'::text;
    return;
  end if;
  select * into v_card from public.gift_cards where code = v_code for update;
  if not found then
    return query select false, 0::double precision, 0::double precision, 'Code not found.'::text;
    return;
  end if;
  if v_card.redeemed_by is not null then
    return query select false, 0::double precision, 0::double precision, 'Code already redeemed.'::text;
    return;
  end if;
  if v_card.amount_usd not in (50,100) then raise exception 'Invalid gift amount'; end if;
  v_tokens := round(v_card.amount_usd * 20000)::bigint;
  update public.gift_cards set redeemed_by = p_user_id, to_user = p_user_id, redeemed_at = now()
    where code = v_code;
  insert into public.credit_grants(id,user_id,credits,reason,ref)
    values('gr_' || gen_random_uuid()::text,p_user_id,v_card.amount_usd * 2,'gift_redeem',v_code);
  insert into public.token_grants(id,user_id,tokens,remaining,reason,ref)
    values('tg_' || gen_random_uuid()::text,p_user_id,v_tokens,v_tokens,'gift','gift:' || v_code);
  return query select true,v_card.amount_usd,v_card.amount_usd * 2,null::text;
end $$;
revoke all on function public.redeem_gift_card(text,text) from public,anon,authenticated;
grant execute on function public.redeem_gift_card(text,text) to service_role;

insert into public.token_grants(id,user_id,tokens,remaining,reason,ref)
select 'tg_' || gen_random_uuid()::text, redeemer_id, 500000,500000,'referral','referral:' || id
from public.referrals on conflict (user_id,ref) do nothing;
insert into public.token_grants(id,user_id,tokens,remaining,reason,ref)
select 'tg_' || gen_random_uuid()::text, inviter_id, 500000,500000,'referral','referral-inviter:' || id
from public.referrals on conflict (user_id,ref) do nothing;

create or replace function public.redeem_referral(p_user_id text,p_code text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_code text := upper(regexp_replace(trim(coalesce(p_code,'')),'[^A-Za-z0-9-]','','g'));
  v_inviter text; v_referral_id text; v_reward constant double precision := 50;
begin
  if p_user_id is null or p_user_id = '' then
    return jsonb_build_object('ok',false,'error','Sign in to redeem a gift code.');
  end if;
  if v_code = '' then
    return jsonb_build_object('ok',false,'error','Enter your friend’s gift code.');
  end if;
  select user_id into v_inviter from public.referral_codes where code = v_code;
  if v_inviter is null then
    return jsonb_build_object('ok',false,'error','Code not found. Check the code and try again.');
  end if;
  if v_inviter = p_user_id then
    return jsonb_build_object('ok',false,'error','You can’t redeem your own gift code — share it with a friend.');
  end if;
  insert into public.referrals(id,code,inviter_id,redeemer_id,inviter_credits,redeemer_credits)
  values('rf_' || gen_random_uuid()::text,v_code,v_inviter,p_user_id,v_reward,v_reward)
  on conflict do nothing returning id into v_referral_id;
  if v_referral_id is null then
    return jsonb_build_object('ok',false,'error','You already redeemed a referral gift.');
  end if;
  insert into public.credit_grants(id,user_id,credits,reason,ref) values
    ('gr_' || gen_random_uuid()::text,p_user_id,v_reward,'referral_redeem','referral:' || v_referral_id),
    ('gr_' || gen_random_uuid()::text,v_inviter,v_reward,'referral_inviter','referral-inviter:' || v_referral_id);
  insert into public.token_grants(id,user_id,tokens,remaining,reason,ref) values
    ('tg_' || gen_random_uuid()::text,p_user_id,500000,500000,'referral','referral:' || v_referral_id),
    ('tg_' || gen_random_uuid()::text,v_inviter,500000,500000,'referral','referral-inviter:' || v_referral_id);
  return jsonb_build_object('ok',true,'code',v_code,'credits',v_reward,
    'inviterCredits',v_reward,'tokens',500000,'inviterTokens',500000);
end $$;
revoke all on function public.redeem_referral(text,text) from public,anon,authenticated;
grant execute on function public.redeem_referral(text,text) to service_role;

-- VM runtime uses token equivalents at $0.20 provider cost per million tokens.
-- That preserves a 60% model-cost margin on the $0.50/M paid plan rate.
create or replace function public.meter_agent_vm_runtime(
  p_user_id text,p_usd_per_hour double precision,p_stop boolean default false
) returns double precision language plpgsql security definer set search_path = public as $$
declare v_row public.agent_vm_instances%rowtype;
  v_now timestamptz := clock_timestamp(); v_cost double precision := 0;
  v_tokens bigint;
begin
  if p_usd_per_hour < 0.06 or p_usd_per_hour > 100 then raise exception 'Invalid VM billing rate'; end if;
  select * into v_row from public.agent_vm_instances where user_id = p_user_id for update;
  if not found or v_row.power_state not in ('running','stopping') then return 0; end if;
  if v_row.last_metered_at is not null then
    v_cost := greatest(0,extract(epoch from v_now - v_row.last_metered_at)) / 3600 * p_usd_per_hour;
    if v_cost > 0 then
      v_tokens := ceil(v_cost * 5000000)::bigint;
      perform public.charge_raw_tokens('vm_' || gen_random_uuid()::text,p_user_id,'azure-vm',
        0,0,v_tokens,v_cost,false,null);
    end if;
  end if;
  update public.agent_vm_instances set last_metered_at = case when p_stop then null else v_now end
    where user_id = p_user_id;
  return coalesce(v_tokens,0);
end $$;
revoke all on function public.meter_agent_vm_runtime(text,double precision,boolean) from public,anon,authenticated;
grant execute on function public.meter_agent_vm_runtime(text,double precision,boolean) to service_role;
