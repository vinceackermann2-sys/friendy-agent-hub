-- Encrypted Apple refresh tokens exist only to revoke access on account deletion.
create table public.apple_identity_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.apple_identity_tokens enable row level security;
revoke all on public.apple_identity_tokens from anon, authenticated;
grant all on public.apple_identity_tokens to service_role;
