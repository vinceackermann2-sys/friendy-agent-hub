-- Card details are never stored, not even masked metadata. Purchases use Shop
-- Pay or a card the owner saved in the merchant's own account.
drop table if exists public.merchant_payment_methods;
