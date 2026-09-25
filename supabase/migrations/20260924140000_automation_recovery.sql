-- Keep the automation pump alive while a durable task waits for approval or
-- finishes on another worker. A waiting approval has no next scheduled run.
alter table public.sub_agents add column if not exists trigger_sync_at timestamptz;
alter table public.sub_agents add column if not exists trigger_sync_error text;

-- These jobs were introduced by earlier migrations. Replace them in-place so
-- this recovery update works on an already provisioned project as well.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'belna-agent-upkeep-worker') then
    perform cron.unschedule('belna-agent-upkeep-worker');
  end if;
  if exists (select 1 from cron.job where jobname = 'belna-chat-task-worker') then
    perform cron.unschedule('belna-chat-task-worker');
  end if;
end $$;

select cron.schedule('belna-agent-upkeep-worker','* * * * *', $job$
  select net.http_post(
    url := coalesce(nullif(public.get_server_secret('automation_worker_url'),''),'https://belna.se/api/internal/automations-tick'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.get_server_secret('vm_sweep_token')),
    body := '{}'::jsonb, timeout_milliseconds := 300000
  ) where public.get_server_secret('vm_sweep_token') is not null
    and (exists(select 1 from public.sub_agents
      where enabled=true and trigger_type='schedule' and next_run_at is not null and next_run_at<=now())
      or exists(select 1 from public.automation_runs where status in ('running','waiting_approval'))
      or exists(select 1 from public.sub_agents where enabled=true and trigger_type='app'
        and (trigger_sync_at is null or trigger_sync_at<=now()-interval '1 hour')));
$job$);

-- The chat-task pump uses the same Vault token. Earlier schedules looked up
-- its uppercase environment name, while Vault stores the lowercase key.
select cron.schedule('belna-chat-task-worker','* * * * *', $job$
  select net.http_post(
    url := coalesce(nullif(public.get_server_secret('chat_task_worker_url'),''),'https://belna.se/api/internal/tasks-tick'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.get_server_secret('vm_sweep_token')),
    body := '{}'::jsonb, timeout_milliseconds := 300000
  ) where public.get_server_secret('vm_sweep_token') is not null
    and exists(select 1 from public.due_chat_tasks());
$job$);
