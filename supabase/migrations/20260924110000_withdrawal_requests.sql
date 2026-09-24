create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  purchase_reference text not null,
  purchase_kind text not null check (purchase_kind in ('subscription', 'token_pack', 'other')),
  received_at timestamptz not null default now(),
  receipt_sent_at timestamptz,
  status text not null default 'received'
);

create index if not exists withdrawal_requests_received_at_idx
  on public.withdrawal_requests (received_at desc);

alter table public.withdrawal_requests enable row level security;
revoke all on public.withdrawal_requests from anon, authenticated;
