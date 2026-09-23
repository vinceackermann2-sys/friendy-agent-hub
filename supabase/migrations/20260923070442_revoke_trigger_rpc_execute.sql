-- Trigger functions are invoked by PostgreSQL; clients must not call them
-- through the public RPC API.
revoke all on function public.seed_agent_upkeep_for_profile()
  from public, anon, authenticated;

-- Supabase may install this event-trigger helper outside this repository.
-- Apply the same restriction when it exists.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
