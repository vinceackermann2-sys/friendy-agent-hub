-- The owner's own connectors: REST APIs and MCP servers they add in the app.
-- The credential stays encrypted in vault_secrets; a connector keeps only the
-- secret's id and is deleted together with it.
create table if not exists public.custom_connectors (
  id text primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('api', 'mcp')),
  slug text not null,
  name text not null,
  url text not null,
  description text not null default '',
  config jsonb not null default '{}'::jsonb,
  secret_id text references public.vault_secrets(id) on delete cascade,
  tools jsonb not null default '[]'::jsonb,
  disabled jsonb not null default '[]'::jsonb,
  status text not null default 'connected' check (status in ('connected', 'error')),
  last_error text not null default '',
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug),
  check (jsonb_typeof(config) = 'object'),
  check (jsonb_typeof(tools) = 'array'),
  check (jsonb_typeof(disabled) = 'array')
);
create index if not exists custom_connectors_user_idx on public.custom_connectors(user_id, created_at);

alter table public.custom_connectors enable row level security;
revoke all on public.custom_connectors from anon, authenticated;
grant all on public.custom_connectors to service_role;
