-- The edge runtime keeps no memory between instances, so its in-memory rate limit
-- does not hold. Sign-in codes, passwords and the public withdrawal form are limited
-- here instead. Keys are hashed by the server (they can contain an email address).
create table if not exists public.rate_limit_hits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
create index if not exists rate_limit_hits_window_idx on public.rate_limit_hits(window_start);
alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from anon, authenticated;
grant all on public.rate_limit_hits to service_role;

-- Counts one hit for p_key in the current fixed window; true while within p_max.
create or replace function public.hit_rate_limit(p_key text, p_window_seconds integer, p_max integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz;
  v_hits integer;
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 200 or p_window_seconds is null or p_window_seconds < 1 or p_max is null or p_max < 1 then
    raise exception 'Invalid rate limit';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limit_hits(key, window_start, hits) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = public.rate_limit_hits.hits + 1
  returning hits into v_hits;
  -- Old windows are removed a few at a time, so no separate cleanup job is needed.
  delete from public.rate_limit_hits where ctid in (
    select ctid from public.rate_limit_hits where window_start < now() - interval '1 day' limit 20);
  return v_hits <= p_max;
end;
$$;
revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;
