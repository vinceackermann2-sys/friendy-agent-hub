-- Built-in, account-scoped agent upkeep. These rows share the durable
-- automation scheduler but are identified and protected separately from
-- automations created by the user.
alter table public.sub_agents add column if not exists system_kind text;
alter table public.sub_agents add column if not exists description text not null default '';
alter table public.sub_agents add column if not exists last_result text;
alter table public.sub_agents add column if not exists last_signal_at timestamptz;

create unique index if not exists sub_agents_system_kind_user_idx
  on public.sub_agents(user_id, system_kind) where system_kind is not null;

create or replace function public.seed_agent_upkeep(p_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
  owner_hash text := substr(md5(p_user_id),1,20);
  chat_hash text := substr(md5(p_user_id),1,12);
begin
  for item in
    select * from (values
      ('memory','Memory upkeep',60,'Hourly · when there is new signal','Consolidates durable facts and corrections from recent conversations without reprocessing unchanged chats.','Review recent user-authored conversation excerpts for durable facts, preferences, commitments, and corrections. Search memory before writing and do nothing when no change is needed.'),
      ('relationships','Relationship upkeep',60,'Hourly · when people are mentioned','Keeps useful, evidence-based context about people and groups the user discusses.','Review recent user-authored excerpts for explicit durable relationship facts. Never infer closeness, motives, sensitive traits, or contact details.'),
      ('ideas','Idea curation',1440,'Daily · once when context changed','Produces a short set of feasible, personal, non-repetitive ideas from current goals and context.','Propose at most three useful ideas ranked by personal fit, feasibility, and novelty. It is valid to return no ideas.'),
      ('study','Goal studying',1440,'Daily · once for active goals','Researches one concrete question that can unblock an active goal and records a concise briefing.','Research one supported question that materially advances an active goal. Prefer primary sources and include URLs.'),
      ('reflection','Nightly reflection',1440,'Nightly · once when context changed','Reviews corrections, friction, and unresolved commitments so future replies improve.','Review recent excerpts for corrections, friction, failed assumptions, collaboration preferences, and unresolved commitments.'),
      ('skills','Skill review',1440,'Daily · once when workflows changed','Finds repeated workflows and tool failures that deserve a reusable, reviewable procedure.','Recommend at most one reusable skill or operating lesson supported by repeated evidence.'),
      ('quiet','Quiet-moment review',30,'After substantial chats · at most 3/day','Runs one bounded pass after a conversation settles to capture memories, decisions, and open loops.','Perform one bounded quiet-moment review after the conversation settles; capture only durable facts, decisions, and open loops.')
    ) as d(kind,name,minutes,label,description,prompt)
  loop
    insert into public.sub_agents(
      id,user_id,chat_id,name,prompt,enabled,trigger_type,trigger_config,
      next_run_at,system_kind,description
    ) values (
      'upkeep_'||item.kind||'_'||owner_hash,p_user_id,'upkeep_'||item.kind||'_'||chat_hash,
      item.name,item.prompt,true,'schedule',jsonb_build_object('type','schedule','intervalMinutes',item.minutes,'label',item.label),
      now() + make_interval(mins => item.minutes),item.kind,item.description
    ) on conflict (id) do nothing;
  end loop;
end;
$$;

revoke all on function public.seed_agent_upkeep(text) from public,anon,authenticated;
grant execute on function public.seed_agent_upkeep(text) to service_role;

do $$
declare profile_row record;
begin
  for profile_row in select id::text as id from public.profiles loop
    perform public.seed_agent_upkeep(profile_row.id);
  end loop;
end;
$$;

create or replace function public.seed_agent_upkeep_for_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_agent_upkeep(new.id::text);
  return new;
end;
$$;

drop trigger if exists profiles_seed_agent_upkeep on public.profiles;
create trigger profiles_seed_agent_upkeep
after insert on public.profiles
for each row execute function public.seed_agent_upkeep_for_profile();
