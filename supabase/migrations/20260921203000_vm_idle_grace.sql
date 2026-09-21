-- Keep an on-demand VM warm briefly after real VM work, without tying it to
-- app presence. This avoids repeated cold boots during a short follow-up while
-- the existing sweeper still deallocates idle full-OS machines.
alter table public.agent_vm_instances
  add column if not exists idle_until timestamptz;

drop function if exists public.release_agent_vm_lease(text,text,text,timestamptz);
create function public.release_agent_vm_lease(
  p_user_id text,
  p_lease_id text,
  p_claim_token text,
  p_idle_until timestamptz
)
returns table(should_stop boolean, claim_token text, idle_until timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_instance public.agent_vm_instances%rowtype;
  v_idle_until timestamptz;
begin
  select * into v_instance
  from public.agent_vm_instances i
  where i.user_id = p_user_id
  for update;

  if not found then
    return query select false, null::text, null::timestamptz;
    return;
  end if;

  delete from public.agent_vm_leases
  where user_id = p_user_id
    and (lease_id = p_lease_id or expires_at <= now());

  if exists (
    select 1 from public.agent_vm_leases l
    where l.user_id = p_user_id and l.expires_at > now()
  ) or v_instance.power_state not in ('running', 'starting') then
    return query select false, null::text, v_instance.idle_until;
    return;
  end if;

  v_idle_until := greatest(now(), coalesce(p_idle_until, now()));
  update public.agent_vm_instances
  set idle_until = v_idle_until,
      last_lease_at = now(),
      stop_claim_token = null,
      stop_claimed_at = null,
      updated_at = now()
  where user_id = p_user_id;

  return query select false, null::text, v_idle_until;
end;
$$;

create or replace function public.claim_idle_agent_vms(
  p_claim_token text,
  p_limit integer default 20
)
returns table(user_id text, vm_name text, claim_token text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  delete from public.agent_vm_leases where expires_at <= now();

  for v_row in
    select i.user_id, i.vm_name
    from public.agent_vm_instances i
    where i.power_state in ('running', 'starting')
      and coalesce(i.idle_until, i.last_lease_at, i.created_at) <= now()
      and not exists (
        select 1 from public.agent_vm_leases l
        where l.user_id = i.user_id and l.expires_at > now()
      )
    order by coalesce(i.idle_until, i.last_lease_at, i.created_at)
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  loop
    update public.agent_vm_instances i
    set power_state = 'stopping',
        stop_claim_token = p_claim_token,
        stop_claimed_at = now(),
        updated_at = now()
    where i.user_id = v_row.user_id;
    return query select v_row.user_id::text, v_row.vm_name::text, p_claim_token;
  end loop;
end;
$$;

revoke all on function public.release_agent_vm_lease(text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.release_agent_vm_lease(text,text,text,timestamptz) to service_role;
