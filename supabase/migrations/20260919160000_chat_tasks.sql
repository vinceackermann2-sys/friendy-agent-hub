-- Durable, ad-hoc chat workers. Service-only writes; no client-supplied owner IDs.
create table public.agent_chat_tasks (
  id uuid primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  chat_id text not null,
  request_key text not null,
  state jsonb not null,
  revision bigint not null default 1,
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, chat_id, request_key)
);
create index agent_chat_tasks_owner on public.agent_chat_tasks(user_id, chat_id, created_at desc);
create index agent_chat_tasks_ready on public.agent_chat_tasks((state->>'status'), updated_at);
alter table public.agent_chat_tasks enable row level security;
revoke all on public.agent_chat_tasks from anon, authenticated;
grant all on public.agent_chat_tasks to service_role;

create function public.create_chat_task(p_id uuid, p_user_id text, p_chat_id text, p_request_key text, p_state jsonb)
returns setof public.agent_chat_tasks language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id, 17));
  if exists(select 1 from agent_chat_tasks where user_id=p_user_id and chat_id=p_chat_id and request_key=p_request_key) then
    return query select * from agent_chat_tasks where user_id=p_user_id and chat_id=p_chat_id and request_key=p_request_key;
    return;
  end if;
  if (select count(*) from agent_chat_tasks where user_id=p_user_id and state->>'status' in ('queued','running','waiting_approval')) >= 8 then
    raise exception 'Finish or stop a task before starting another.';
  end if;
  return query insert into agent_chat_tasks(id,user_id,chat_id,request_key,state)
    values(p_id,p_user_id,p_chat_id,p_request_key,p_state) returning *;
end $$;

create function public.claim_chat_task(p_id uuid, p_user_id text, p_token uuid)
returns setof public.agent_chat_tasks language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id, 17));
  if (select count(*) from agent_chat_tasks where user_id=p_user_id and lease_until>now()) >= 2 then return; end if;
  -- Action Run Command admits one active command per VM. Model and web steps
  -- can still run alongside that command. The owner lock covers this decision.
  if exists(select 1 from agent_chat_tasks where id=p_id and user_id=p_user_id
    and state->'pending'->0->>'name' in ('shell','code_run','browser_open','browser_action','computer_screenshot'))
    and exists(select 1 from agent_chat_tasks where user_id=p_user_id and id<>p_id and lease_until>now()
      and (state->'pending'->0->>'name' in ('shell','code_run','browser_open','browser_action','computer_screenshot')
        or state->'inflight'->>'name' in ('shell','code_run','browser_open','browser_action','computer_screenshot')))
  then return; end if;
  return query update agent_chat_tasks set lease_token=p_token, lease_until=now()+interval '12 minutes',
    revision=revision+1, updated_at=now()
    where id=p_id and user_id=p_user_id and state->>'status' in ('queued','running','stopping')
      and (lease_until is null or lease_until<=now()) returning *;
end $$;

-- CAS protects steering and stop from a late worker write. A worker must also
-- retain its execution lease; control requests use the null token.
create function public.write_chat_task(p_id uuid, p_user_id text, p_revision bigint, p_token uuid, p_state jsonb)
returns setof public.agent_chat_tasks language sql security definer set search_path = public as $$
  update agent_chat_tasks set state=p_state, revision=revision+1, updated_at=now()
  where id=p_id and user_id=p_user_id and revision=p_revision
    and (p_token is null or (lease_token=p_token and lease_until>now())) returning *;
$$;
create function public.release_chat_task(p_id uuid, p_user_id text, p_token uuid)
returns void language sql security definer set search_path = public as $$
  update agent_chat_tasks set lease_token=null, lease_until=null, updated_at=now()
  where id=p_id and user_id=p_user_id and lease_token=p_token;
$$;
revoke all on function public.create_chat_task(uuid,text,text,text,jsonb), public.claim_chat_task(uuid,text,uuid),
  public.write_chat_task(uuid,text,bigint,uuid,jsonb), public.release_chat_task(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.create_chat_task(uuid,text,text,text,jsonb), public.claim_chat_task(uuid,text,uuid),
  public.write_chat_task(uuid,text,bigint,uuid,jsonb), public.release_chat_task(uuid,text,uuid) to service_role;

-- Poll only new visible events. Never ship model context, tool observations,
-- instruction history or screenshots that the client already received.
create function public.list_chat_tasks(p_user_id text, p_chat_id text, p_cursors jsonb default '{}', p_events boolean default true)
returns table(id uuid, chat_id text, revision bigint, state jsonb)
language sql security definer set search_path = public as $$
  select t.id,t.chat_id,t.revision,jsonb_build_object(
    'title',t.state->'title','status',t.state->'status','version',t.state->'version',
    'summary',left(t.state->>'summary',1500),'instructions',right(t.state->>'instructions',600),
    'eventCount',jsonb_array_length(t.state->'events'),
    'events',case when p_events then coalesce((select jsonb_agg(e order by (e->>'seq')::integer)
      from jsonb_array_elements(t.state->'events') e
      where (e->>'seq')::integer>coalesce((p_cursors->>t.id::text)::integer,0)), '[]'::jsonb) else '[]'::jsonb end)
  from (
    select t0.* from agent_chat_tasks t0 where t0.user_id=p_user_id and t0.chat_id=p_chat_id
    order by case when not p_events and t0.state->>'status' in ('queued','running','waiting_approval','stopping') then 0 else 1 end,t0.created_at desc
    limit (case when p_events then null else 12 end)
  ) t order by t.created_at;
$$;
revoke all on function public.list_chat_tasks(text,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.list_chat_tasks(text,text,jsonb,boolean) to service_role;

-- Hosted recovery pump. These are ad-hoc task executions, never user automations.
-- Node deployments also run their local worker. Database claims arbitrate both.
-- CHAT_TASK_WORKER_URL can point this pump at a long-lived Node worker host.
select cron.schedule('belna-chat-task-worker','* * * * *', $job$
  select net.http_post(
    url := coalesce(nullif(public.get_server_secret('CHAT_TASK_WORKER_URL'),''),'https://belna.se/api/internal/tasks-tick'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.get_server_secret('VM_SWEEP_TOKEN')),
    body := '{}'::jsonb, timeout_milliseconds := 300000
  ) where public.get_server_secret('VM_SWEEP_TOKEN') is not null
    and exists(select 1 from public.agent_chat_tasks where state->>'status' in ('queued','running','stopping')
      and (lease_until is null or lease_until<=now()));
$job$);
