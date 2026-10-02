-- Keep the schedule installed but dormant until Whop credentials and signed
-- deliveries have passed an end-to-end test. Avoid a minute-by-minute 503.
select cron.unschedule('wallet-card-recovery');
select cron.schedule('wallet-card-recovery', '* * * * *', $job$
  select net.http_post(
    url := 'https://alikzitdkdiatimjygdz.supabase.co/functions/v1/wallet-card-recovery',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public.get_server_secret('wallet_recovery_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) where public.get_server_secret('wallet_recovery_secret') is not null
      and public.get_server_secret('wallet_recovery_enabled') = 'true';
$job$);
