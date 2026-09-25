-- Cards already held by a merchant: display metadata only, never PAN/CVC.
create table if not exists public.merchant_payment_methods (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant text not null,
  brand text not null,
  last4 char(4) not null check (last4 ~ '^[0-9]{4}$'),
  label text not null,
  created_at timestamptz not null default now()
);
create index if not exists merchant_payment_methods_user_idx on public.merchant_payment_methods (user_id, created_at desc);
alter table public.merchant_payment_methods enable row level security;
revoke all on public.merchant_payment_methods from anon, authenticated;
grant select, insert, delete on public.merchant_payment_methods to service_role;
