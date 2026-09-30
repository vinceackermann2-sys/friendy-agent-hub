create table if not exists public.library_storage_gc(
  storage_path text primary key,user_id text not null,created_at timestamptz not null default now()
);
alter table public.library_storage_gc enable row level security;
revoke all on public.library_storage_gc from anon,authenticated;
grant all on public.library_storage_gc to service_role;
create or replace function public.queue_library_storage_delete() returns trigger
language plpgsql set search_path=public as $$
begin
  if OLD.storage_path is not null then insert into public.library_storage_gc(storage_path,user_id) values(OLD.storage_path,OLD.user_id) on conflict do nothing; end if;
  return OLD;
end $$;
drop trigger if exists queue_library_storage_delete on public.library_item_versions;
create trigger queue_library_storage_delete after delete on public.library_item_versions for each row execute function public.queue_library_storage_delete();

-- Merge run activity under a row lock; an old run must not undo newer owner settings.
create or replace function public.record_goal_activity(p_user text,p_goal text,p_entry jsonb,p_configuration text,p_next_action text,p_next_wake text) returns void
language plpgsql set search_path=public as $$
declare g public.goals; entries jsonb; next_work jsonb;
begin
  select * into g from public.goals where id=p_goal and user_id=p_user for update;
  if not found then return; end if;
  if exists(select 1 from jsonb_array_elements(g.activity) e where e->>'runId'=p_entry->>'runId') then return; end if;
  select coalesce(jsonb_agg(value order by n),'[]') into entries from (select value,n from jsonb_array_elements(g.activity||jsonb_build_array(p_entry)) with ordinality as x(value,n) order by n desc limit 30) recent;
  next_work=g.work;
  if g.work->>'configurationId'=p_configuration and g.status='active' and coalesce((g.work->>'enabled')::boolean,false) then
    if coalesce(p_next_action,'')<>'' then next_work=jsonb_set(next_work,'{nextAction}',to_jsonb(left(p_next_action,1000))); end if;
    next_work=jsonb_set(next_work,'{nextWakeAt}',coalesce(to_jsonb(p_next_wake),'null'));
  end if;
  update public.goals set activity=entries,work=next_work,updated_at=now() where id=p_goal and user_id=p_user;
end $$;
revoke all on function public.queue_library_storage_delete() from public,anon,authenticated;
revoke all on function public.record_goal_activity(text,text,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.queue_library_storage_delete() to service_role;
grant execute on function public.record_goal_activity(text,text,jsonb,text,text,text) to service_role;
