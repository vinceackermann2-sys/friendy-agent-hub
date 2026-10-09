-- Account deletion purges profiles, and every owner table cascades from there.
-- Two references did not, so the purge failed for some accounts and left them
-- behind the deletion fence (every request answered "deletion is pending"):
--   belna_wallet_purchases.user_id -> belna_wallets: no on-delete action, so an
--     account with any Belna card purchase could not be deleted.
--   belna_wallet_transfers.payment_request_id -> belna_wallet_payment_requests:
--     another owner's transfer that paid this owner's request blocked deleting
--     the request. The payer keeps the transfer; only the link is cleared.
-- A retry of deletion succeeds once this is applied.
do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.belna_wallet_purchases'::regclass and c.contype = 'f'
      and c.confrelid = 'public.belna_wallets'::regclass
  loop
    execute format('alter table public.belna_wallet_purchases drop constraint %I', v_name);
  end loop;
  for v_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.belna_wallet_transfers'::regclass and c.contype = 'f'
      and c.confrelid = 'public.belna_wallet_payment_requests'::regclass
  loop
    execute format('alter table public.belna_wallet_transfers drop constraint %I', v_name);
  end loop;
end $$;

alter table public.belna_wallet_purchases
  add constraint belna_wallet_purchases_user_id_fkey
  foreign key (user_id) references public.belna_wallets(user_id) on delete cascade;
alter table public.belna_wallet_transfers
  add constraint belna_wallet_transfers_payment_request_id_fkey
  foreign key (payment_request_id) references public.belna_wallet_payment_requests(id) on delete set null;

-- The VM bookkeeping row has no reference to profiles, so it outlived the account.
-- The Azure resources are erased before this runs (createAppleAccountCleanup).
create or replace function public.delete_belna_account_data(owner_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
  delete from public.apple_devices where user_id = owner_id;
  delete from public.agent_vm_instances where user_id = owner_id::text;
  delete from public.profiles where id = owner_id::text;
end;
$$;
revoke all on function public.delete_belna_account_data(uuid) from public, anon, authenticated;
grant execute on function public.delete_belna_account_data(uuid) to service_role;
