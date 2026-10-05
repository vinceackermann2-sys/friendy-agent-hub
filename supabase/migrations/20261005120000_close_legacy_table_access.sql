-- Every table is read and written by the server with the service key; the browser
-- and the Apple app never query tables directly. The public key handed to browsers
-- for Realtime, together with a user's own sign-in token, still reached the tables
-- that the original schema files opened with policies:
--   gift_cards     "gifts readable": any signed-in user listed every unredeemed code
--   subscriptions  "subs owner" (for all): a user could set plan, status and Stripe ids
--   api_usage, upgrade_requests, profiles, memories, vault_secrets, sub_agents,
--   automation_runs, chats, messages, tool_runs, agent_sessions: owner write access
-- Remove those policies and every anon/authenticated table privilege, including for
-- tables created later by this role.
do $$
declare
  v record;
begin
  for v in
    select * from (values
      ('gift_cards', 'gifts readable'),
      ('subscriptions', 'subs owner'),
      ('api_usage', 'usage owner'),
      ('upgrade_requests', 'upgrades owner'),
      ('profiles', 'profiles owner'),
      ('profiles', 'own rows'),
      ('memories', 'memories owner'),
      ('vault_secrets', 'secrets owner'),
      ('sub_agents', 'sub agents owner'),
      ('automation_runs', 'automation runs owner'),
      ('chats', 'chats owner'),
      ('messages', 'messages owner'),
      ('tool_runs', 'runs owner'),
      ('agent_sessions', 'sessions owner')
    ) as p(table_name, policy_name)
  loop
    if to_regclass('public.' || quote_ident(v.table_name)) is not null then
      execute format('drop policy if exists %I on public.%I', v.policy_name, v.table_name);
    end if;
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
