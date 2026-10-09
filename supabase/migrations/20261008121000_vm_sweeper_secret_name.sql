-- Vault keeps server secrets under lowercase names (the server lower-cases every
-- lookup, and 20260924140000 moved the task and automation pumps to lowercase).
-- The VM lease sweeper still looked up 'VM_SWEEP_TRIGGER_TOKEN', which
-- get_server_secret matches exactly, so the job never sent a request and idle
-- VMs were never stopped on hosts without the Node idle watcher. Either spelling
-- is accepted here, so this is safe whichever name the secret was stored under.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'belna-vm-lease-sweeper') then
    perform cron.unschedule('belna-vm-lease-sweeper');
  end if;
end $$;

select cron.schedule('belna-vm-lease-sweeper','* * * * *', $job$
  select net.http_post(
    url := 'https://alikzitdkdiatimjygdz.supabase.co/functions/v1/vm-lease-sweeper',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || coalesce(public.get_server_secret('vm_sweep_trigger_token'), public.get_server_secret('VM_SWEEP_TRIGGER_TOKEN'))),
    body := '{}'::jsonb, timeout_milliseconds := 30000
  ) where coalesce(public.get_server_secret('vm_sweep_trigger_token'), public.get_server_secret('VM_SWEEP_TRIGGER_TOKEN')) is not null;
$job$);
