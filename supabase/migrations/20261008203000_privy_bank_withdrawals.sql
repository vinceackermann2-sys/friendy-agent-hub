-- Native owner-authorized EUR payouts. Store only the provider account ID and
-- masked destination label; full IBANs and identity documents stay at Bridge.
alter table public.belna_privy_wallet_intents add column if not exists fiat_account_id text;
alter table public.belna_privy_wallet_intents add column if not exists provider_review_required boolean not null default false;
alter table public.belna_privy_wallet_intents drop constraint if exists belna_privy_wallet_intents_kind_check;
alter table public.belna_privy_wallet_intents drop constraint if exists belna_privy_wallet_intents_check;
alter table public.belna_privy_wallet_intents add constraint privy_intent_kind check (kind in ('send','withdraw','bank_withdraw','earn_deposit','earn_withdraw'));
alter table public.belna_privy_wallet_intents add constraint privy_intent_destination check (
  (kind in ('send','withdraw') and destination_address is not null and vault_id is null and fiat_account_id is null) or
  (kind in ('earn_deposit','earn_withdraw') and vault_id is not null and destination_address is null and fiat_account_id is null) or
  (kind='bank_withdraw' and fiat_account_id is not null and fiat_account_id ~ '^[a-zA-Z0-9_-]{1,200}$' and destination_address is null and vault_id is null)
);
notify pgrst, 'reload schema';
