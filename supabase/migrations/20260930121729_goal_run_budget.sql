-- Serialize starts for one linked goal. A client-side count alone can overspend
-- when scheduled and manual wakes arrive together on different hosts.
create or replace function public.enforce_goal_run_budget() returns trigger
language plpgsql set search_path=public as $$
declare goal_id text; g public.goals; used integer;
begin
  select trigger_config->>'goalId' into goal_id from public.sub_agents where id=NEW.sub_agent_id and user_id=NEW.user_id;
  if goal_id is null then return NEW; end if;
  select * into g from public.goals where id=goal_id and user_id=NEW.user_id for update;
  if not found or g.status<>'active' or coalesce((g.work->>'enabled')::boolean,false)=false or (g.work->>'agentId') is distinct from NEW.sub_agent_id then
    raise exception 'Goal work is not enabled';
  end if;
  if exists(select 1 from public.automation_runs where sub_agent_id=NEW.sub_agent_id and status in ('running','waiting_approval')) then
    raise exception 'A goal run is already active';
  end if;
  select count(*) into used from public.automation_runs where sub_agent_id=NEW.sub_agent_id and user_id=NEW.user_id;
  if used>=coalesce((g.work->>'maxRuns')::integer,0) then raise exception 'Goal work budget reached'; end if;
  return NEW;
end $$;
drop trigger if exists enforce_goal_run_budget on public.automation_runs;
create trigger enforce_goal_run_budget before insert on public.automation_runs for each row execute function public.enforce_goal_run_budget();
revoke all on function public.enforce_goal_run_budget() from public,anon,authenticated;
grant execute on function public.enforce_goal_run_budget() to service_role;
