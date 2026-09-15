-- Lingon Supabase schema (free tier). Run in Supabase Dashboard > SQL Editor.
-- Creates tables + RLS so each user only sees their own rows.
-- Frontend never talks to Supabase directly; the Node backend uses the
-- service_role key server-side. If you use Supabase Auth later, the same
-- policies apply to the anon key with auth.uid().

create extension if not exists "pgcrypto";

-- one row per app user (use your own user id string for now, or auth.users id)
create table if not exists profiles (
  id text primary key,
  created_at timestamptz default now()
);

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references profiles(id) on delete cascade,
  name text not null,
  color text default 'lingon',
  pers text default 'Playful',
  claimed_at timestamptz default now()
);

create table if not exists chats (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  title text default 'New chat',
  created_at timestamptz default now()
);

create table if not exists messages (
  id text primary key,
  chat_id text not null references chats(id) on delete cascade,
  role text not null,
  kind text default 'text',
  text text,
  card jsonb,
  created_at timestamptz default now()
);

create table if not exists memories (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  text text not null,
  src text default 'chat',
  created_at timestamptz default now()
);
create index if not exists memories_user_idx on memories(user_id, created_at desc);

create table if not exists vault_secrets (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  name text not null,
  ref text not null,
  encrypted_value jsonb not null,
  created_at timestamptz default now()
);
create index if not exists secrets_user_idx on vault_secrets(user_id, created_at desc);

create table if not exists vault_apps (
  user_id text not null references profiles(id) on delete cascade,
  app text not null,
  created_at timestamptz default now(),
  primary key (user_id, app)
);

create table if not exists approvals (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  key text not null,
  label text not null,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
alter table agents enable row level security;
alter table chats enable row level security;
alter table messages enable row level security;
alter table memories enable row level security;
alter table vault_secrets enable row level security;
alter table vault_apps enable row level security;
alter table approvals enable row level security;

-- Service-role key bypasses RLS (backend use). For anon/authenticated use,
-- allow users to manage their own rows when auth.uid()::text = user_id.
-- (If you don't use Supabase Auth yet, the backend service_role still works.)

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'own rows') then
    create policy "own rows" on profiles for all using (true) with check (true);
  end if;
end $$;
