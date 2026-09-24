-- The vm-lease-sweeper Edge Function now rejects callers that do not present
-- VM_SWEEP_TRIGGER_TOKEN. Reschedule the pump to send it from Vault. The same
-- value must be set as the Edge Function secret VM_SWEEP_TRIGGER_TOKEN.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'belna-vm-lease-sweeper') then
    perform cron.unschedule('belna-vm-lease-sweeper');
  end if;
end $$;

select cron.schedule('belna-vm-lease-sweeper','* * * * *', $job$
  select net.http_post(
    url := 'https://alikzitdkdiatimjygdz.supabase.co/functions/v1/vm-lease-sweeper',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.get_server_secret('VM_SWEEP_TRIGGER_TOKEN')),
    body := '{}'::jsonb, timeout_milliseconds := 30000
  ) where public.get_server_secret('VM_SWEEP_TRIGGER_TOKEN') is not null;
$job$);
