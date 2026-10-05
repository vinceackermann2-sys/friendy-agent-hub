-- The owner's own payment methods that agent purchases may use: payment apps (Klarna, Swish,
-- PayPal, Afterpay, Sezzle…, approved by the owner) and Shop Pay. Each is off until the owner
-- turns it on in Wallet; none spends the Belna Wallet balance. Cards saved in stores keep
-- using merchant_enabled. Null means the owner has not set this list yet (an earlier
-- "existing payments" choice keeps Shop Pay on).
alter table public.belna_wallet_preferences
  add column if not exists enabled_methods text[]
  check (enabled_methods is null or enabled_methods <@ array['payment_apps','shop_pay']::text[]);
