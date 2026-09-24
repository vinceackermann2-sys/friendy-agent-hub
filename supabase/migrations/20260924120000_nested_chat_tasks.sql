-- Bounded worker-initiated subtasks. A parent waits without model calls until
-- its direct children finish, then resumes to verify and combine their work.
create or replace function public.create_chat_task(p_id uuid, p_user_id text, p_chat_id text, p_request_key text, p_state jsonb)
returns setof public.agent_chat_tasks language plpgsql security definer set search_path=public as $$
declare shared jsonb; parent public.agent_chat_tasks; team_id text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id,17));
  if exists(select 1 from agent_chat_tasks where user_id=p_user_id and chat_id=p_chat_id and request_key=p_request_key) then
    return query select * from agent_chat_tasks where user_id=p_user_id and chat_id=p_chat_id and request_key=p_request_key;return;
  end if;
  team_id=coalesce(p_state->>'teamId',p_id::text);
  if (select count(*) from agent_chat_tasks where user_id=p_user_id and state->>'status' in ('queued','running','waiting_peers','waiting_approval','stopping'))>=8 then raise exception 'Finish or stop a task before starting another.'; end if;
  if (select count(*) from agent_chat_tasks where user_id=p_user_id and chat_id=p_chat_id and coalesce(state->>'teamId',id::text)=team_id and state->>'status' in ('queued','running','waiting_peers','waiting_approval','stopping'))>=3 then raise exception 'This objective already has three active workers.'; end if;
  if (select count(*) from agent_chat_tasks where user_id=p_user_id and chat_id=p_chat_id and coalesce(state->>'teamId',id::text)=team_id)>=6 then raise exception 'This objective has reached its subtask budget.'; end if;
  if p_state->>'parentTaskId' is not null then
    select * into parent from agent_chat_tasks where user_id=p_user_id and chat_id=p_chat_id and id=(p_state->>'parentTaskId')::uuid;
    if parent.id is null or coalesce(parent.state->>'teamId',parent.id::text)<>team_id
      or parent.state->>'status'<>'running' or (parent.state->>'depth')::integer>=2
      or parent.state->'context'->>'automation'='true'
      or (p_state->>'depth')::integer<>coalesce((parent.state->>'depth')::integer,0)+1
    then raise exception 'Parent worker cannot start this subtask.'; end if;
    if (select count(*) from agent_chat_tasks where user_id=p_user_id and chat_id=p_chat_id and state->>'parentTaskId'=parent.id::text)>=2 then raise exception 'This worker already started two subtasks.'; end if;
  end if;
  select state into shared from agent_chat_tasks where user_id=p_user_id and chat_id=p_chat_id and coalesce(state->>'teamId',id::text)=team_id order by updated_at desc limit 1;
  if shared is not null then p_state=p_state || jsonb_build_object('sharedGoal',coalesce(shared->>'sharedGoal',shared->>'originalPrompt'),'sharedInstructions',coalesce(shared->>'sharedInstructions','')); end if;
  if length(coalesce(p_state->>'sharedInstructions',''))+length(p_state->>'instructions')>24000 then raise exception 'Shared instruction budget reached.'; end if;
  return query insert into agent_chat_tasks(id,user_id,chat_id,request_key,state) values(p_id,p_user_id,p_chat_id,p_request_key,p_state) returning *;
end $$;

create or replace function public.message_chat_task_peer(p_user_id text,p_source uuid,p_target uuid,p_call_id text,p_version integer,p_message jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a agent_chat_tasks; b agent_chat_tasks; msg jsonb; ref text;
begin
  perform 1 from agent_chat_tasks where user_id=p_user_id and id in (p_source,p_target) order by id for update;
  select * into a from agent_chat_tasks where user_id=p_user_id and id=p_source;
  select * into b from agent_chat_tasks where user_id=p_user_id and id=p_target;
  if a.id is null or b.id is null or a.id=b.id or a.chat_id<>b.chat_id
    or coalesce(a.state->>'teamId',a.id::text)<>coalesce(b.state->>'teamId',b.id::text) then raise exception 'Peer not in this task team.'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(b.state->'inbox','[]')) m where m->>'id'=p_call_id and m->>'source'=p_source::text) then return jsonb_build_object('delivered',true); end if;
  if (a.state->>'version')::integer<>p_version or a.state->>'status'<>'running'
    or a.state->'inflight'->>'id' is distinct from p_call_id or a.state->'pending'->0->>'id' is distinct from p_call_id or a.lease_until<=now() or a.lease_token is null then raise exception 'Sender changed.'; end if;
  if b.state->>'status' not in ('queued','running','waiting_peers','waiting_approval') then raise exception 'Peer is no longer working. Read its result instead.'; end if;
  if coalesce(p_message->>'kind','') not in ('question','finding','answer','conflict') or length(coalesce(p_message->>'text','')) not between 1 and 1000 then raise exception 'Invalid peer message.'; end if;
  if jsonb_typeof(p_message->'evidenceIds') is distinct from 'array' then raise exception 'Evidence list required.'; end if;
  if p_message->>'kind' in ('finding','answer') and jsonb_array_length(p_message->'evidenceIds')=0 then raise exception 'Cite evidence for a finding or answer.'; end if;
  for ref in select jsonb_array_elements_text(p_message->'evidenceIds') loop
    if not exists(select 1 from jsonb_array_elements(a.state->'observations') o where o->>'id'=ref and o->>'ok'='true' and (o->>'version')::integer=p_version)
      then raise exception 'Evidence is not a current successful observation.'; end if;
  end loop;
  if jsonb_array_length(coalesce(b.state->'inbox','[]'))>=16 then raise exception 'Peer communication budget reached.'; end if;
  msg=jsonb_build_object('id',p_call_id,'source',p_source,'sourceVersion',p_version,'kind',p_message->'kind','text',p_message->'text','evidenceIds',p_message->'evidenceIds');
  b.state=jsonb_set(b.state,'{inbox}',coalesce(b.state->'inbox','[]') || jsonb_build_array(msg));
  -- Questions and conflicts wake a waiting parent to respond. Routine
  -- findings are retained for synthesis without another model call.
  if b.state->>'status'<>'waiting_peers' or p_message->>'kind' in ('question','conflict') then
    if b.state->'approval'->>'id' is not null then
      b.state=jsonb_set(b.state,'{events}',b.state->'events' || jsonb_build_array(jsonb_build_object('type','decision','callId',b.state->'approval'->>'id','status','expired','version',b.state->'version','seq',jsonb_array_length(b.state->'events')+1)));
    end if;
    b.state=b.state || jsonb_build_object('pending','[]'::jsonb,'approval',null,'status','queued');
  end if;
  update agent_chat_tasks set state=b.state,revision=revision+1,updated_at=now() where id=b.id;
  return jsonb_build_object('delivered',true,'messageId',p_call_id);
end $$;

create or replace function public.chat_task_team(p_user_id text,p_id uuid)
returns table(id uuid,chat_id text,state jsonb)
language sql security definer set search_path=public as $$
  select t.id,t.chat_id,jsonb_build_object('title',t.state->'title','version',t.state->'version',
    'parentTaskId',t.state->'parentTaskId','status',t.state->'status',
    'summary',left(t.state->>'summary',600),'result',left(t.state->>'result',1200),
    'milestones',t.state->'milestones',
    'inbox',case when t.id=p_id then coalesce(t.state->'inbox','[]') else '[]'::jsonb end)
  from agent_chat_tasks a join agent_chat_tasks t on t.user_id=a.user_id and t.chat_id=a.chat_id
    and coalesce(t.state->>'teamId',t.id::text)=coalesce(a.state->>'teamId',a.id::text)
  where a.id=p_id and a.user_id=p_user_id order by t.created_at,t.id;
$$;

create or replace function public.claim_chat_task(p_id uuid, p_user_id text, p_token uuid)
returns setof public.agent_chat_tasks language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id,17));
  if (select count(*) from agent_chat_tasks where user_id=p_user_id and lease_until>now())>=3 then return; end if;
  if exists(select 1 from agent_chat_tasks where id=p_id and user_id=p_user_id
    and state->'pending'->0->>'name' in ('shell','code_run','browser_open','browser_action','computer_screenshot'))
    and exists(select 1 from agent_chat_tasks where user_id=p_user_id and id<>p_id and lease_until>now()
      and (state->'pending'->0->>'name' in ('shell','code_run','browser_open','browser_action','computer_screenshot')
        or state->'inflight'->>'name' in ('shell','code_run','browser_open','browser_action','computer_screenshot')))
  then return; end if;
  return query update agent_chat_tasks set lease_token=p_token,lease_until=now()+interval '12 minutes',revision=revision+1,updated_at=now()
    where id=p_id and user_id=p_user_id and state->>'status' in ('queued','running','waiting_peers','stopping')
      and (lease_until is null or lease_until<=now()) returning *;
end $$;

create function public.due_chat_tasks()
returns table(id uuid,user_id text,revision bigint)
language sql security definer set search_path=public as $$
  select t.id,t.user_id,t.revision from agent_chat_tasks t
  where (t.lease_until is null or t.lease_until<=now())
    and (t.state->>'status' in ('queued','running','stopping')
      or (t.state->>'status'='waiting_peers' and not exists(
        select 1 from agent_chat_tasks child where child.user_id=t.user_id and child.chat_id=t.chat_id
          and child.state->>'parentTaskId'=t.id::text
          and child.state->>'status' in ('queued','running','waiting_peers','waiting_approval','stopping'))))
  order by t.updated_at limit 12;
$$;
revoke all on function public.due_chat_tasks() from public,anon,authenticated;
grant execute on function public.due_chat_tasks() to service_role;

create or replace function public.list_chat_tasks(p_user_id text,p_chat_id text,p_cursors jsonb default '{}',p_events boolean default true)
returns table(id uuid,chat_id text,revision bigint,state jsonb)
language sql security definer set search_path=public as $$
  select t.id,t.chat_id,t.revision,jsonb_build_object(
    'teamId',coalesce(t.state->>'teamId',t.id::text),'title',t.state->'title','status',t.state->'status','version',t.state->'version',
    'summary',left(t.state->>'summary',1500),'instructions',right(t.state->>'instructions',600),
    'eventCount',jsonb_array_length(t.state->'events'),
    'events',case when p_events then coalesce((select jsonb_agg(e order by (e->>'seq')::integer)
      from jsonb_array_elements(t.state->'events') e
      where (e->>'seq')::integer>coalesce((p_cursors->>t.id::text)::integer,0)), '[]'::jsonb) else '[]'::jsonb end)
  from (
    select t0.* from agent_chat_tasks t0 where t0.user_id=p_user_id and t0.chat_id=p_chat_id
    order by case when not p_events and t0.state->>'status' in ('queued','running','waiting_peers','waiting_approval','stopping') then 0 else 1 end,t0.created_at desc
    limit (case when p_events then null else 12 end)
  ) t order by t.created_at;
$$;

-- Hosted recovery pump must also wake a parent if children finished just before
-- the previous invocation ended. Node workers use due_chat_tasks directly.
select cron.unschedule('belna-chat-task-worker');
select cron.schedule('belna-chat-task-worker','* * * * *', $job$
  select net.http_post(
    url := coalesce(nullif(public.get_server_secret('CHAT_TASK_WORKER_URL'),''),'https://belna.se/api/internal/tasks-tick'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.get_server_secret('VM_SWEEP_TOKEN')),
    body := '{}'::jsonb, timeout_milliseconds := 300000
  ) where public.get_server_secret('VM_SWEEP_TOKEN') is not null
    and exists(select 1 from public.due_chat_tasks());
$job$);
