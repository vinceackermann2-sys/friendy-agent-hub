-- OpenClaw-style memory layers for Lingon's hosted, user-scoped store.
-- Existing rows become active curated MEMORY.md entries.
alter table public.memories add column if not exists category text not null default 'long_term';
alter table public.memories add column if not exists status text not null default 'active';
alter table public.memories add column if not exists importance smallint not null default 1;
alter table public.memories add column if not exists observed_at timestamptz not null default now();
alter table public.memories add column if not exists updated_at timestamptz not null default now();
alter table public.memories add column if not exists superseded_by text references public.memories(id) on delete set null;
alter table public.memories add column if not exists source_chat_id text;
alter table public.memories add column if not exists source_message_id text;

do $$ begin
  if not exists(select 1 from pg_constraint where conname = 'memories_category_check') then
    alter table public.memories add constraint memories_category_check check (category in ('user','long_term','daily'));
  end if;
  if not exists(select 1 from pg_constraint where conname = 'memories_status_check') then
    alter table public.memories add constraint memories_status_check check (status in ('active','superseded'));
  end if;
  if not exists(select 1 from pg_constraint where conname = 'memories_importance_check') then
    alter table public.memories add constraint memories_importance_check check (importance between 0 and 3);
  end if;
end $$;

create or replace function public.forget_agent_memory(p_user_id text,p_memory_id text)
returns integer language plpgsql security definer set search_path = public as $$
declare removed integer;
begin
  with recursive family(id,superseded_by) as (
    select id,superseded_by from memories where id=p_memory_id and user_id=p_user_id
    union
    select m.id,m.superseded_by from memories m join family f on m.id=f.superseded_by or m.superseded_by=f.id
      where m.user_id=p_user_id
  ), deleted as (
    delete from memories where user_id=p_user_id and id in (select id from family) returning id
  ) select count(*) into removed from deleted;
  return removed;
end $$;

create index if not exists memories_active_user_idx
  on public.memories(user_id, category, updated_at desc) where status = 'active';
create index if not exists memories_search_idx
  on public.memories using gin(to_tsvector('simple', text));

create or replace function public.search_agent_memories(
  p_user_id text,
  p_query text,
  p_limit integer default 12,
  p_include_core boolean default false
)
returns table(
  id text, user_id text, text text, src text, category text, status text,
  importance smallint, observed_at timestamptz, updated_at timestamptz,
  superseded_by text, source_chat_id text, source_message_id text,
  created_at timestamptz, score real
)
language sql security definer stable set search_path = public as $$
  with tokens as (
    select unnest(tsvector_to_array(to_tsvector('simple', coalesce(p_query, '')))) token
  ), useful as (
    select token from tokens where length(token) > 2 and token not in
      ('the','and','for','with','from','that','this','what','when','where','which','who','how','why','you','your','they','their','have','has','are','was','were','can','will','could','would','please','tell','show','about','remember','know')
  ), q as (
    select case when count(*) = 0 then null
      else to_tsquery('simple', string_agg(quote_literal(token), ' | ')) end value
    from useful
  )
  select m.id, m.user_id, m.text, m.src, m.category, m.status, m.importance,
         m.observed_at, m.updated_at, m.superseded_by, m.source_chat_id,
         m.source_message_id, m.created_at,
         case when trim(coalesce(p_query, '')) = '' then 0::real
              else coalesce(ts_rank_cd(to_tsvector('simple', m.text), q.value),0)::real end score
  from memories m cross join q
  where m.user_id = p_user_id and m.status = 'active'
    and (trim(coalesce(p_query, '')) = ''
      or (q.value is not null and to_tsvector('simple', m.text) @@ q.value)
      or lower(m.text) like '%' || lower(trim(p_query)) || '%'
      or (p_include_core and m.category = 'user' and m.importance >= 2))
  order by score desc, m.importance desc,
           case when m.category in ('user','long_term') then 0 else 1 end,
           m.updated_at desc
  limit least(greatest(coalesce(p_limit, 12), 1), 100);
$$;

create or replace function public.supersede_agent_memory(
  p_user_id text,
  p_memory_id text,
  p_new_id text,
  p_text text,
  p_category text,
  p_src text,
  p_importance smallint default 1
)
returns setof public.memories
language plpgsql security definer set search_path = public as $$
declare prior public.memories;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id || ':' || p_memory_id, 31));
  select * into prior from memories where id = p_memory_id and user_id = p_user_id and status = 'active' for update;
  if not found then raise exception 'Active memory not found.' using errcode = 'P0002'; end if;
  insert into memories(id,user_id,text,src,category,status,importance,observed_at,updated_at,source_chat_id,source_message_id)
    values(p_new_id,p_user_id,p_text,coalesce(p_src,'user_edit'),coalesce(p_category,prior.category),'active',coalesce(p_importance,prior.importance),now(),now(),prior.source_chat_id,prior.source_message_id);
  update memories set status='superseded',superseded_by=p_new_id,updated_at=now() where id=p_memory_id and user_id=p_user_id;
  return query select * from memories where id=p_new_id and user_id=p_user_id;
end $$;

revoke all on public.memories from anon, authenticated;
grant all on public.memories to service_role;
revoke all on function public.search_agent_memories(text,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.search_agent_memories(text,text,integer,boolean) to service_role;
revoke all on function public.supersede_agent_memory(text,text,text,text,text,text,smallint) from public,anon,authenticated;
grant execute on function public.supersede_agent_memory(text,text,text,text,text,text,smallint) to service_role;
revoke all on function public.forget_agent_memory(text,text) from public,anon,authenticated;
grant execute on function public.forget_agent_memory(text,text) to service_role;
