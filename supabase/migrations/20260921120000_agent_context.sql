-- Durable, user-editable identity and operating context for the personal agent.
-- Platform policy and permissions deliberately live outside this table.
create table if not exists public.agent_contexts (
  user_id text primary key references public.profiles(id) on delete cascade,
  agent jsonb not null default '{}'::jsonb,
  documents jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(agent) = 'object'),
  check (jsonb_typeof(documents) = 'object')
);

alter table public.agent_contexts enable row level security;
revoke all on public.agent_contexts from anon, authenticated;
grant all on public.agent_contexts to service_role;

create or replace function public.write_agent_context(
  p_user_id text,
  p_agent jsonb,
  p_documents jsonb,
  p_revision bigint default null
)
returns setof public.agent_contexts
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id, 29));
  if not exists(select 1 from agent_contexts where user_id = p_user_id) then
    if p_revision is not null and p_revision <> 0 then
      raise exception 'Agent context changed. Refresh and try again.' using errcode = '40001';
    end if;
    return query insert into agent_contexts(user_id, agent, documents)
      values(p_user_id, coalesce(p_agent, '{}'::jsonb), coalesce(p_documents, '{}'::jsonb))
      returning *;
    return;
  end if;
  if p_revision is not null and not exists(
    select 1 from agent_contexts where user_id = p_user_id and revision = p_revision
  ) then
    raise exception 'Agent context changed. Refresh and try again.' using errcode = '40001';
  end if;
  return query update agent_contexts
    set agent = coalesce(p_agent, agent), documents = coalesce(p_documents, documents),
        revision = revision + 1, updated_at = now()
    where user_id = p_user_id returning *;
end $$;

revoke all on function public.write_agent_context(text,jsonb,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.write_agent_context(text,jsonb,jsonb,bigint) to service_role;
