-- Hosted automation pump. Long-lived Node deployments also run a local timer;
-- due-row checks and automation run dedupe make the two paths safe together.
select cron.schedule('belna-agent-upkeep-worker','* * * * *', $job$
  select net.http_post(
    url := coalesce(nullif(public.get_server_secret('AUTOMATION_WORKER_URL'),''),'https://belna.se/api/internal/automations-tick'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.get_server_secret('VM_SWEEP_TOKEN')),
    body := '{}'::jsonb, timeout_milliseconds := 300000
  ) where public.get_server_secret('VM_SWEEP_TOKEN') is not null
    and exists(select 1 from public.sub_agents
      where enabled=true and trigger_type='schedule' and next_run_at is not null and next_run_at<=now());
$job$);
