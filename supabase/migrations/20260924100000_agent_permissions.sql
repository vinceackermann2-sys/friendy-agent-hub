create table if not exists public.agent_permissions (
  user_id text primary key references public.profiles(id) on delete cascade,
  web_mode text not null default 'ask_some' check (web_mode in ('ask_some', 'always_ask')),
  connector_mode text not null default 'ask_some' check (connector_mode in ('ask_some', 'always_ask')),
  known_hosts jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.agent_permissions enable row level security;
