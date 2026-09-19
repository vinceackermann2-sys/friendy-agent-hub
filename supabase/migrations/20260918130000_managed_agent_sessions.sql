-- Historical migration retained to keep local and Belna Supabase migration
-- history aligned. The deprecated managed runtime is not part of this release.
create table public.managed_agent_sessions (
  user_id text not null references public.profiles(id) on delete cascade,
  chat_id text not null,
  session_id text unique,
  lock_id text,
  lock_until timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, chat_id)
);
create table public.managed_agent_calls (
  user_id text not null references public.profiles(id) on delete cascade,
  session_id text not null,
  call_id text not null,
  turn_id text not null,
  name text not null,
  arguments jsonb not null,
  status text not null check (status in ('pending','executing','done')),
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (session_id, call_id)
);
create table public.managed_agent_documents (
  id text primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  chat_id text not null,
  name text not null,
  kind text not null,
  content text not null,
  created_at timestamptz not null default now()
);
alter table public.managed_agent_sessions enable row level security;
alter table public.managed_agent_calls enable row level security;
alter table public.managed_agent_documents enable row level security;
revoke all on public.managed_agent_sessions, public.managed_agent_calls, public.managed_agent_documents from anon, authenticated;
grant all on public.managed_agent_sessions, public.managed_agent_calls, public.managed_agent_documents to service_role;
