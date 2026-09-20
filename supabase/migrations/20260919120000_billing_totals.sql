-- Return one small billing summary instead of transferring the full ledgers.
-- The function runs with the caller's privileges and is only callable by the
-- server's service role; callers cannot request another user's balance.
create or replace function public.billing_totals(p_user_id text)
returns table (
  granted double precision,
  used double precision,
  gift_granted double precision,
  gifts_usd double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select coalesce(sum(g.credits), 0) from public.credit_grants g where g.user_id = p_user_id),
    (select coalesce(sum(coalesce(u.credits_charged, u.cost_usd * 2)), 0)
       from public.api_usage u where u.user_id = p_user_id),
    (select coalesce(sum(g.credits), 0) from public.credit_grants g
       where g.user_id = p_user_id and g.reason = 'gift_redeem'),
    (select coalesce(sum(c.amount_usd), 0) from public.gift_cards c
       where c.redeemed_by = p_user_id);
$$;

revoke all on function public.billing_totals(text) from public, anon, authenticated;
grant execute on function public.billing_totals(text) to service_role;

create index if not exists gift_cards_redeemed_by_idx
  on public.gift_cards(redeemed_by) where redeemed_by is not null;
