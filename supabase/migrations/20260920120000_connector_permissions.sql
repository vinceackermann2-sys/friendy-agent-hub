create table if not exists public.connector_permissions (
  user_id text not null references public.profiles(id) on delete cascade,
  toolkit text not null,
  disabled jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now(),
  primary key (user_id, toolkit)
);
alter table public.connector_permissions enable row level security;
