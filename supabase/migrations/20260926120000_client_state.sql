-- Chat UI and onboarding state survive refreshes and sign-in on other devices.
-- Memories, agent documents, library items and secrets remain in their own tables.
create table if not exists public.client_state (
  user_id text not null references public.profiles(id) on delete cascade,
  state_key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, state_key),
  check (state_key = 'profile' or state_key ~ '^chat:[a-zA-Z0-9_-]{1,120}$'),
  check (jsonb_typeof(value) = 'object')
);

alter table public.client_state enable row level security;
revoke all on public.client_state from anon, authenticated;
grant all on public.client_state to service_role;
