-- Device-native Apple app requests. Personal content never lives in plaintext.
create table public.apple_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  name text not null check (length(name) between 1 and 80),
  platform text not null check (platform in ('ios','mac')),
  capabilities jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  primary key (user_id,id)
);
create table public.apple_device_commands (
  id uuid primary key,
  user_id uuid not null,
  device_id uuid not null,
  action text not null check (action in ('calendar.list','calendar.create','calendar.update','calendar.delete','reminders.list','reminders.create','reminders.update','reminders.complete','reminders.delete','contacts.search','contacts.create','contacts.update','contacts.delete','health.summary')),
  task_id text,
  status text not null default 'pending' check (status in ('pending','running','done','consumed','cancelled','expired')),
  payload jsonb,
  result jsonb,
  lease_token uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  foreign key (user_id,device_id) references public.apple_devices(user_id,id) on delete cascade
);
create index apple_device_queue on public.apple_device_commands(user_id,device_id,status,created_at);
alter table public.apple_devices enable row level security;
alter table public.apple_device_commands enable row level security;
-- All access uses authenticated server routes and the server service role.
revoke all on public.apple_devices, public.apple_device_commands from anon, authenticated;
grant all on public.apple_devices, public.apple_device_commands to service_role;
-- Run hourly (e.g. your database scheduler); terminal metadata is disposable.
create or replace function public.purge_expired_apple_commands() returns void
language sql security invoker set search_path = public as $$
  delete from public.apple_device_commands where expires_at < now();
$$;
revoke all on function public.purge_expired_apple_commands() from public, anon, authenticated;
grant execute on function public.purge_expired_apple_commands() to service_role;

create or replace function public.delete_belna_account_data(owner_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
  delete from public.apple_devices where user_id = owner_id;
  delete from public.profiles where id = owner_id::text;
end;
$$;
revoke all on function public.delete_belna_account_data(uuid) from public, anon, authenticated;
grant execute on function public.delete_belna_account_data(uuid) to service_role;
