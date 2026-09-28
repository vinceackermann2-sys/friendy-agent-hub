-- Fair recovery of card-application probes, including a lost create response.
alter table public.belna_wallets
  add column if not exists application_requested_at timestamptz,
  add column if not exists last_connection_check_at timestamptz;

create index if not exists belna_wallets_connection_recovery
  on public.belna_wallets (last_connection_check_at nulls first, created_at)
  where application_status like 'connection_%' and account_id is not null;
