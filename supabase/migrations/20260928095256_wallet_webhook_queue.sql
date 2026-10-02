-- Whop deliveries are acknowledged after a durable insert. The recovery
-- worker leases a small batch and re-reads the current issuer state, so event
-- ordering and duplicate delivery cannot authorize a second purchase.
create table if not exists public.belna_wallet_webhook_events (
  id text primary key check (id ~ '^msg_[A-Za-z0-9]+$'),
  account_id text not null check (account_id ~ '^biz_[A-Za-z0-9]+$'),
  card_id text not null check (card_id ~ '^icrd_[A-Za-z0-9]+$'),
  received_at timestamptz not null default now(),
  attempted_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  locked_until timestamptz,
  processed_at timestamptz
);

create index if not exists belna_wallet_webhook_events_pending
  on public.belna_wallet_webhook_events (locked_until, received_at)
  where processed_at is null;

alter table public.belna_wallet_webhook_events enable row level security;
revoke all on public.belna_wallet_webhook_events from public, anon, authenticated;
grant select, insert, update on public.belna_wallet_webhook_events to service_role;

create or replace function public.claim_belna_wallet_webhook_events(batch_size integer default 5)
returns setof public.belna_wallet_webhook_events
language sql security definer set search_path = public
as $$
  update public.belna_wallet_webhook_events e
  set locked_until = now() + interval '2 minutes',
      attempted_at = now(),
      attempt_count = e.attempt_count + 1
  where e.id in (
    select q.id from public.belna_wallet_webhook_events q
    where q.processed_at is null
      and (q.locked_until is null or q.locked_until < now())
    order by q.received_at
    for update skip locked
    limit least(greatest(batch_size, 1), 5)
  )
  returning e.*;
$$;
revoke all on function public.claim_belna_wallet_webhook_events(integer) from public, anon, authenticated;
grant execute on function public.claim_belna_wallet_webhook_events(integer) to service_role;
