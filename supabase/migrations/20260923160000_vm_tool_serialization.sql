-- Browser and computer use added VM tools (a final approved step, vault fills
-- and the virtual computer). They start sessions with Azure Run Command, which
-- admits one active command per VM, so they take turns with the other VM tools
-- across a user's task workers. Up to two tasks per user still run at once.
create or replace function public.claim_chat_task(p_id uuid, p_user_id text, p_token uuid)
returns setof public.agent_chat_tasks language plpgsql security definer set search_path = public as $$
declare
  vm_tools constant text[] := array['shell','code_run','browser_open','browser_action','browser_submit','browser_fill_secret',
    'computer_screenshot','computer_action','computer_submit','computer_fill_secret'];
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id, 17));
  if (select count(*) from agent_chat_tasks where user_id=p_user_id and lease_until>now()) >= 2 then return; end if;
  if exists(select 1 from agent_chat_tasks where id=p_id and user_id=p_user_id
    and state->'pending'->0->>'name' = any(vm_tools))
    and exists(select 1 from agent_chat_tasks where user_id=p_user_id and id<>p_id and lease_until>now()
      and (state->'pending'->0->>'name' = any(vm_tools) or state->'inflight'->>'name' = any(vm_tools)))
  then return; end if;
  return query update agent_chat_tasks set lease_token=p_token, lease_until=now()+interval '12 minutes',
    revision=revision+1, updated_at=now()
    where id=p_id and user_id=p_user_id and state->>'status' in ('queued','running','stopping')
      and (lease_until is null or lease_until<=now()) returning *;
end $$;
