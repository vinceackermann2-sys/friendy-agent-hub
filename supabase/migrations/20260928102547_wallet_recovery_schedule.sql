-- Keep the worker token entirely inside Supabase Vault. Only service-role
-- callers can retrieve it through get_server_secret; Cron injects it directly.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'wallet_recovery_secret') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'wallet_recovery_secret',
      'Belna wallet recovery worker token'
    );
  end if;
end $$;

select cron.schedule('wallet-card-recovery', '* * * * *', $job$
  select net.http_post(
    url := 'https://alikzitdkdiatimjygdz.supabase.co/functions/v1/wallet-card-recovery',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public.get_server_secret('wallet_recovery_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) where public.get_server_secret('wallet_recovery_secret') is not null;
$job$);
