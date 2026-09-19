create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.agent_vm_instances (
  user_id text primary key,
  vm_name text not null unique,
  power_state text not null default 'deallocated'
    check (power_state in ('deallocated', 'starting', 'running', 'stopping')),
  stop_claim_token text,
  stop_claimed_at timestamptz,
  last_lease_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_vm_leases (
  user_id text not null references public.agent_vm_instances(user_id) on delete cascade,
  lease_id text not null,
  kind text not null default 'app',
  vm_name text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, lease_id)
);

create index if not exists agent_vm_leases_expires_idx
  on public.agent_vm_leases(expires_at);

alter table public.agent_vm_instances enable row level security;
alter table public.agent_vm_leases enable row level security;
revoke all on public.agent_vm_instances, public.agent_vm_leases from anon, authenticated;
grant all on public.agent_vm_instances, public.agent_vm_leases to service_role;

create or replace function public.acquire_agent_vm_lease(
  p_user_id text,
  p_lease_id text,
  p_kind text,
  p_vm_name text,
  p_expires_at timestamptz
)
returns table(acquired boolean, power_state text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_instance public.agent_vm_instances%rowtype;
  v_state text;
begin
  if coalesce(p_user_id, '') = '' or coalesce(p_lease_id, '') = '' or coalesce(p_vm_name, '') = '' then
    raise exception 'user, lease and VM are required';
  end if;

  insert into public.agent_vm_instances(user_id, vm_name)
  values (p_user_id, p_vm_name)
  on conflict (user_id) do update set vm_name = excluded.vm_name;

  select * into v_instance
  from public.agent_vm_instances i
  where i.user_id = p_user_id
  for update;

  if v_instance.power_state = 'stopping'
     and v_instance.stop_claimed_at > now() - interval '5 minutes' then
    return query select false, v_instance.power_state;
    return;
  end if;

  insert into public.agent_vm_leases(user_id, lease_id, kind, vm_name, expires_at)
  values (p_user_id, p_lease_id, left(coalesce(p_kind, 'app'), 32), p_vm_name, p_expires_at)
  on conflict (user_id, lease_id) do update set
    kind = excluded.kind,
    vm_name = excluded.vm_name,
    expires_at = excluded.expires_at,
    updated_at = now();

  v_state := case when v_instance.power_state = 'running' then 'running' else 'starting' end;
  update public.agent_vm_instances
  set power_state = v_state,
      stop_claim_token = null,
      stop_claimed_at = null,
      last_lease_at = now(),
      updated_at = now()
  where user_id = p_user_id;

  return query select true, v_state;
end;
$$;

create or replace function public.release_agent_vm_lease(
  p_user_id text,
  p_lease_id text,
  p_claim_token text
)
returns table(should_stop boolean, claim_token text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_instance public.agent_vm_instances%rowtype;
begin
  select * into v_instance
  from public.agent_vm_instances i
  where i.user_id = p_user_id
  for update;

  if not found then
    return query select false, null::text;
    return;
  end if;

  delete from public.agent_vm_leases
  where user_id = p_user_id
    and (lease_id = p_lease_id or expires_at <= now());

  if exists (
    select 1 from public.agent_vm_leases l
    where l.user_id = p_user_id and l.expires_at > now()
  ) or v_instance.power_state not in ('running', 'starting') then
    return query select false, null::text;
    return;
  end if;

  update public.agent_vm_instances
  set power_state = 'stopping',
      stop_claim_token = p_claim_token,
      stop_claimed_at = now(),
      updated_at = now()
  where user_id = p_user_id;

  return query select true, p_claim_token;
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
      and not exists (
        select 1 from public.agent_vm_leases l
        where l.user_id = i.user_id and l.expires_at > now()
      )
    order by i.last_lease_at nulls first
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

create or replace function public.finish_agent_vm_stop(
  p_user_id text,
  p_claim_token text,
  p_success boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.agent_vm_instances i
  set power_state = case when p_success then 'deallocated' else 'running' end,
      stop_claim_token = null,
      stop_claimed_at = null,
      updated_at = now()
  where i.user_id = p_user_id
    and i.stop_claim_token = p_claim_token;
  return found;
end;
$$;

create or replace function public.mark_agent_vm_running(p_user_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.agent_vm_instances i
  set power_state = 'running', updated_at = now()
  where i.user_id = p_user_id and i.power_state = 'starting';
  return found;
end;
$$;

create or replace function public.put_server_secret(p_name text, p_secret text)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
begin
  if coalesce(p_name, '') = '' or coalesce(p_secret, '') = '' then
    raise exception 'secret name and value are required';
  end if;
  delete from vault.secrets where name = p_name;
  select vault.create_secret(p_secret, p_name, 'Belna server-managed secret') into v_id;
  return v_id;
end;
$$;

create or replace function public.get_server_secret(p_name text)
returns text
language sql
security definer
set search_path = public, vault
stable
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = p_name
  order by created_at desc
  limit 1
$$;

revoke all on function public.acquire_agent_vm_lease(text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.release_agent_vm_lease(text, text, text) from public, anon, authenticated;
revoke all on function public.claim_idle_agent_vms(text, integer) from public, anon, authenticated;
revoke all on function public.finish_agent_vm_stop(text, text, boolean) from public, anon, authenticated;
revoke all on function public.mark_agent_vm_running(text) from public, anon, authenticated;
revoke all on function public.put_server_secret(text, text) from public, anon, authenticated;
revoke all on function public.get_server_secret(text) from public, anon, authenticated;
grant execute on function public.acquire_agent_vm_lease(text, text, text, text, timestamptz) to service_role;
grant execute on function public.release_agent_vm_lease(text, text, text) to service_role;
grant execute on function public.claim_idle_agent_vms(text, integer) to service_role;
grant execute on function public.finish_agent_vm_stop(text, text, boolean) to service_role;
grant execute on function public.mark_agent_vm_running(text) to service_role;
grant execute on function public.put_server_secret(text, text) to service_role;
grant execute on function public.get_server_secret(text) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'belna-vm-lease-sweeper') then
    perform cron.unschedule('belna-vm-lease-sweeper');
  end if;
end $$;

select cron.schedule(
  'belna-vm-lease-sweeper',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://alikzitdkdiatimjygdz.supabase.co/functions/v1/vm-lease-sweeper',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
