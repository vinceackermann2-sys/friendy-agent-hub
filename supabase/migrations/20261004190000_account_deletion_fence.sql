-- Retry record survives auth/profile deletion. It contains no account content
-- or credentials and prevents old work from provisioning a deleted workspace.
create table public.account_deletions (
  user_id text primary key,
  started_at timestamptz not null default now(),
  workspace_resources jsonb not null default '{}'::jsonb
);
alter table public.account_deletions enable row level security;
revoke all on public.account_deletions from public, anon, authenticated;
grant select, insert, update on public.account_deletions to service_role;

-- A late worker must not recreate a profile after the profile/auth purge.
create function public.reject_deleted_profile() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists(select 1 from public.account_deletions where user_id = new.id::text)
     and not exists(select 1 from public.profiles where id = new.id) then
    raise exception 'Account deletion has started';
  end if;
  return new;
end;
$$;
revoke all on function public.reject_deleted_profile() from public, anon, authenticated;
create trigger profiles_deletion_fence before insert on public.profiles
for each row execute function public.reject_deleted_profile();

create function public.reject_deleting_owner() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists(select 1 from public.account_deletions where user_id = new.user_id::text) then
    raise exception 'Account deletion has started';
  end if;
  return new;
end;
$$;
revoke all on function public.reject_deleting_owner() from public, anon, authenticated;
create trigger workspace_lease_deletion_fence before insert or update on public.agent_vm_leases
for each row execute function public.reject_deleting_owner();
create trigger task_deletion_fence before insert on public.agent_chat_tasks
for each row execute function public.reject_deleting_owner();
create trigger library_deletion_fence before insert or update on public.library_items
for each row execute function public.reject_deleting_owner();
