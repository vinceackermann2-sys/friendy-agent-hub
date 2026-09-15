-- Lingon migration 3: agent harness runs. Run AFTER schema.sql + schema2.sql.
-- Mirrors the Agents API observability shape: every Runner run, subagent span
-- and tool call is traceable. Backend service_role bypasses RLS; owner policies
-- cover direct authed access.

create table if not exists tool_runs (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  session_id text,
  kind text not null default 'tool',
  name text default '',
  status text default 'done',
  detail text default '',
  ms int default 0,
  created_at timestamptz default now()
);
create index if not exists runs_user_idx on tool_runs(user_id, created_at desc);

create table if not exists agent_sessions (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  task text default '',
  compacted_context text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table tool_runs enable row level security;
alter table agent_sessions enable row level security;

drop policy if exists "runs owner" on tool_runs;
create policy "runs owner" on tool_runs for all
  using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
drop policy if exists "sessions owner" on agent_sessions;
create policy "sessions owner" on agent_sessions for all
  using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
