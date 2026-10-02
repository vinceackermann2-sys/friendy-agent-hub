-- Older projects applied agent_wallets before this optional provider reference
-- was added to its bootstrap migration. Reconcile them without replaying it.
alter table public.agent_wallets
  add column if not exists stripe_cardholder_id text;
