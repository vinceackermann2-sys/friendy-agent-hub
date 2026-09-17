-- Durable trigger watchers and automation chats.

alter table messages add column if not exists user_id text references profiles(id) on delete cascade;
alter table messages add column if not exists metadata jsonb not null default '{}'::jsonb;
update messages m set user_id = c.user_id from chats c where m.chat_id = c.id and m.user_id is null;
create index if not exists messages_user_idx on messages(user_id, created_at desc);

alter table chats add column if not exists source text not null default 'user';
alter table chats add column if not exists sub_agent_id text;
alter table chats add column if not exists updated_at timestamptz not null default now();
create index if not exists chats_user_updated_idx on chats(user_id, updated_at desc);

create table if not exists sub_agents (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  chat_id text not null unique,
  name text not null,
  prompt text not null,
  enabled boolean not null default true,
  trigger_type text not null check (trigger_type in ('schedule','app','subagent')),
  trigger_config jsonb not null default '{}'::jsonb,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sub_agents_due_idx on sub_agents(enabled, next_run_at);
create index if not exists sub_agents_user_idx on sub_agents(user_id, created_at desc);

create table if not exists automation_runs (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  sub_agent_id text not null references sub_agents(id) on delete cascade,
  chat_id text not null,
  dedupe_key text not null unique,
  status text not null default 'running',
  event jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists automation_runs_user_idx on automation_runs(user_id, started_at desc);

alter table sub_agents enable row level security;
alter table automation_runs enable row level security;

drop policy if exists "sub agents owner" on sub_agents;
create policy "sub agents owner" on sub_agents for all
  using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
drop policy if exists "automation runs owner" on automation_runs;
create policy "automation runs owner" on automation_runs for select
  using (auth.uid()::text = user_id);
drop policy if exists "chats owner" on chats;
create policy "chats owner" on chats for all
  using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
drop policy if exists "messages owner" on messages;
create policy "messages owner" on messages for all
  using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
