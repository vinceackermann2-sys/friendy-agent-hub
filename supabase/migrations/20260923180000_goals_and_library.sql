-- Goals and Library items become account data shared by the app and the agent
-- (goal_* and library_* tools). The server uses the service role; clients never
-- read these tables directly.
create table if not exists public.goals (
  id text primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  category text not null default 'other'
    check (category in ('health','family','finance','career','interests','productivity','other')),
  status text not null default 'active' check (status in ('active','paused','done')),
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  source_chat_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists goals_user_idx on public.goals(user_id, created_at desc);

-- Text artifacts keep their body; media is a data URL capped by the server at 6 MB.
create table if not exists public.library_items (
  id text primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  kind text not null check (kind in ('document','web','image','video','audio','file')),
  mime text,
  size bigint not null default 0,
  content text not null,
  preview text not null default '',
  source text not null default 'agent' check (source in ('agent','upload')),
  source_chat_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists library_items_user_idx on public.library_items(user_id, created_at desc);
create index if not exists library_items_user_kind_idx on public.library_items(user_id, kind, created_at desc);

alter table public.goals enable row level security;
alter table public.library_items enable row level security;
revoke all on public.goals, public.library_items from anon, authenticated;
grant all on public.goals, public.library_items to service_role;
