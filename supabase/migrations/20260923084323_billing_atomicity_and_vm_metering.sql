-- One purchase or gift redemption can create only one credit grant. A failed
-- redemption must roll back both the card state and its credit grant.
-- Earlier concurrent starter requests could insert the same 20-credit grant
-- twice. Keep those audit rows, but neutralize every duplicate before adding
-- the uniqueness constraint.
do $$
begin
  if exists (
    select 1 from public.credit_grants g
    join (select user_id, ref from public.credit_grants where ref is not null
          group by user_id, ref having count(*) > 1) d
      on d.user_id = g.user_id and d.ref = g.ref
    where g.ref <> 'free' or g.reason <> 'free_starter' or g.credits <> 20
  ) then
    raise exception 'Unexpected duplicate credit grant references; inspect before migration';
  end if;
end $$;

with ranked as (
  select id, row_number() over (partition by user_id, ref order by created_at, id) as n
  from public.credit_grants where ref = 'free'
)
update public.credit_grants g
set credits = 0, reason = 'duplicate_starter', ref = 'duplicate:' || g.id
from ranked r where g.id = r.id and r.n > 1;

create unique index if not exists credit_grants_user_ref_unique
  on public.credit_grants(user_id, ref);

alter table public.gift_cards add column if not exists purchased_by text;
create index if not exists gift_cards_purchased_by_idx on public.gift_cards(purchased_by);
create unique index if not exists gift_cards_stripe_source_unique
  on public.gift_cards(from_user) where from_user like 'stripe:%' or from_user like 'promo:%';

create or replace function public.redeem_gift_card(p_user_id text, p_code text)
returns table(ok boolean, amount double precision, credits double precision, error text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.gift_cards%rowtype;
  v_code text := upper(trim(coalesce(p_code, '')));
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
  if v_card.amount_usd <= 0 or v_card.amount_usd > 100 then
    raise exception 'Invalid gift amount';
  end if;

  update public.gift_cards
    set redeemed_by = p_user_id, to_user = p_user_id, redeemed_at = now()
    where code = v_code;
  insert into public.credit_grants(id, user_id, credits, reason, ref)
    values ('gr_' || gen_random_uuid()::text, p_user_id, v_card.amount_usd * 2, 'gift_redeem', v_code);
  return query select true, v_card.amount_usd, v_card.amount_usd * 2, null::text;
end;
$$;

revoke all on function public.redeem_gift_card(text, text) from public, anon, authenticated;
grant execute on function public.redeem_gift_card(text, text) to service_role;

-- Account for dedicated VM compute, including the idle grace period. The
-- caller meters on acquire/renew and after deallocation; the row lock prevents
-- overlapping workers from charging the same interval twice.
alter table public.agent_vm_instances add column if not exists last_metered_at timestamptz;

create or replace function public.meter_agent_vm_runtime(
  p_user_id text, p_usd_per_hour double precision, p_stop boolean default false
)
returns double precision
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.agent_vm_instances%rowtype;
  v_now timestamptz := clock_timestamp();
  v_cost double precision := 0;
begin
  if p_usd_per_hour < 0.06 or p_usd_per_hour > 100 then
    raise exception 'Invalid VM billing rate';
  end if;
  select * into v_row from public.agent_vm_instances where user_id = p_user_id for update;
  if not found or v_row.power_state not in ('running', 'stopping') then return 0; end if;
  if v_row.last_metered_at is not null then
    v_cost := greatest(0, extract(epoch from v_now - v_row.last_metered_at)) / 3600 * p_usd_per_hour;
    if v_cost > 0 then
      insert into public.api_usage(id, user_id, model, cost_usd, credits_charged)
      values ('use_' || gen_random_uuid()::text, p_user_id, 'azure-vm', v_cost, v_cost * 20);
    end if;
  end if;
  update public.agent_vm_instances set last_metered_at = case when p_stop then null else v_now end
    where user_id = p_user_id;
  return v_cost * 20;
end;
$$;

revoke all on function public.meter_agent_vm_runtime(text, double precision, boolean) from public, anon, authenticated;
grant execute on function public.meter_agent_vm_runtime(text, double precision, boolean) to service_role;
