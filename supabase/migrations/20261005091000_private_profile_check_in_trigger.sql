-- Profile creation owns this trigger; it is not a client-callable RPC.
revoke all on function public.seed_personal_check_in_for_profile() from public, anon, authenticated;
grant execute on function public.seed_personal_check_in_for_profile() to service_role;
