-- Shared scope is a delegated objective within one owner's chat, not every
-- task in the conversation. Messages are data and never approval decisions.
create index agent_chat_tasks_team on public.agent_chat_tasks(user_id,chat_id,((state->>'teamId')));

create or replace function public.create_chat_task(p_id uuid, p_user_id text, p_chat_id text, p_request_key text, p_state jsonb)
returns setof public.agent_chat_tasks language plpgsql security definer set search_path=public as $$
declare shared jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id,17));
  if exists(select 1 from agent_chat_tasks where user_id=p_user_id and chat_id=p_chat_id and request_key=p_request_key) then
    return query select * from agent_chat_tasks where user_id=p_user_id and chat_id=p_chat_id and request_key=p_request_key;return;
  end if;
  if (select count(*) from agent_chat_tasks where user_id=p_user_id and state->>'status' in ('queued','running','waiting_approval','stopping'))>=8 then raise exception 'Finish or stop a task before starting another.'; end if;
  if (select count(*) from agent_chat_tasks where user_id=p_user_id and chat_id=p_chat_id and coalesce(state->>'teamId',id::text)=p_state->>'teamId' and state->>'status' in ('queued','running','waiting_approval','stopping'))>=2 then raise exception 'This objective already has two active workers.'; end if;
  select state into shared from agent_chat_tasks where user_id=p_user_id and chat_id=p_chat_id and coalesce(state->>'teamId',id::text)=p_state->>'teamId' order by updated_at desc limit 1;
  if shared is not null then p_state=p_state || jsonb_build_object('sharedGoal',coalesce(shared->>'sharedGoal',shared->>'originalPrompt'),'sharedInstructions',coalesce(shared->>'sharedInstructions','')); end if;
  if length(coalesce(p_state->>'sharedInstructions',''))+length(p_state->>'instructions')>24000 then raise exception 'Shared instruction budget reached.'; end if;
  return query insert into agent_chat_tasks(id,user_id,chat_id,request_key,state) values(p_id,p_user_id,p_chat_id,p_request_key,p_state) returning *;
end $$;

create function public.chat_task_team(p_user_id text,p_id uuid)
returns table(id uuid,chat_id text,state jsonb)
language sql security definer set search_path=public as $$
  select t.id,t.chat_id,jsonb_build_object('title',t.state->'title','version',t.state->'version',
    'status',t.state->'status','summary',left(t.state->>'summary',600),
    'result',left(t.state->>'result',1200),'milestones',t.state->'milestones',
    'inbox',case when t.id=p_id then coalesce(t.state->'inbox','[]') else '[]'::jsonb end)
  from agent_chat_tasks a join agent_chat_tasks t on t.user_id=a.user_id and t.chat_id=a.chat_id
    and coalesce(t.state->>'teamId',t.id::text)=coalesce(a.state->>'teamId',a.id::text)
  where a.id=p_id and a.user_id=p_user_id order by t.created_at,t.id;
$$;

create function public.message_chat_task_peer(p_user_id text,p_source uuid,p_target uuid,p_call_id text,p_version integer,p_message jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a agent_chat_tasks; b agent_chat_tasks; msg jsonb; ref text;
begin
  -- Acquire rows in stable order, including when workers send simultaneously.
  perform 1 from agent_chat_tasks where user_id=p_user_id and id in (p_source,p_target) order by id for update;
  select * into a from agent_chat_tasks where user_id=p_user_id and id=p_source;
  select * into b from agent_chat_tasks where user_id=p_user_id and id=p_target;
  if a.id is null or b.id is null or a.id=b.id or a.chat_id<>b.chat_id
    or coalesce(a.state->>'teamId',a.id::text)<>coalesce(b.state->>'teamId',b.id::text) then raise exception 'Peer not in this task team.'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(b.state->'inbox','[]')) m where m->>'id'=p_call_id and m->>'source'=p_source::text) then return jsonb_build_object('delivered',true); end if;
  if (a.state->>'version')::integer<>p_version or a.state->>'status'<>'running'
    or a.state->'inflight'->>'id' is distinct from p_call_id or a.state->'pending'->0->>'id' is distinct from p_call_id or a.lease_until<=now() or a.lease_token is null then raise exception 'Sender changed.'; end if;
  if b.state->>'status' not in ('queued','running','waiting_approval') then raise exception 'Peer is no longer working. Read its result instead.'; end if;
  if coalesce(p_message->>'kind','') not in ('question','finding','answer','conflict') or length(coalesce(p_message->>'text','')) not between 1 and 1000 then raise exception 'Invalid peer message.'; end if;
  if jsonb_typeof(p_message->'evidenceIds') is distinct from 'array' then raise exception 'Evidence list required.'; end if;
  if p_message->>'kind' in ('finding','answer') and jsonb_array_length(p_message->'evidenceIds')=0 then raise exception 'Cite evidence for a finding or answer.'; end if;
  for ref in select jsonb_array_elements_text(p_message->'evidenceIds') loop
    if not exists(select 1 from jsonb_array_elements(a.state->'observations') o where o->>'id'=ref and o->>'ok'='true' and (o->>'version')::integer=p_version)
      then raise exception 'Evidence is not a current successful observation.'; end if;
  end loop;
  if jsonb_array_length(coalesce(b.state->'inbox','[]'))>=16 then raise exception 'Peer communication budget reached.'; end if;
  msg=jsonb_build_object('id',p_call_id,'source',p_source,'sourceVersion',p_version,'kind',p_message->'kind','text',p_message->'text','evidenceIds',p_message->'evidenceIds');
  -- Re-plan at the next checkpoint. Never abort an already dispatched action.
  b.state=jsonb_set(b.state,'{inbox}',coalesce(b.state->'inbox','[]') || jsonb_build_array(msg));
  if b.state->'approval'->>'id' is not null then
    b.state=jsonb_set(b.state,'{events}',b.state->'events' || jsonb_build_array(jsonb_build_object('type','decision','callId',b.state->'approval'->>'id','status','expired','version',b.state->'version','seq',jsonb_array_length(b.state->'events')+1)));
  end if;
  b.state=b.state || jsonb_build_object('pending','[]'::jsonb,'approval',null,'status','queued');
  update agent_chat_tasks set state=b.state,revision=revision+1,updated_at=now() where id=b.id;
  return jsonb_build_object('delivered',true,'messageId',p_call_id);
end $$;

create function public.steer_chat_task_team(p_user_id text,p_id uuid,p_version integer,p_instruction text,p_request_id text)
returns setof public.agent_chat_tasks language plpgsql security definer set search_path=public as $$
declare anchor agent_chat_tasks; member agent_chat_tasks; next_state jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id,17));
  select * into anchor from agent_chat_tasks where id=p_id and user_id=p_user_id;
  if anchor.id is null then raise exception 'Task not found.'; end if;
  perform 1 from agent_chat_tasks where user_id=p_user_id and chat_id=anchor.chat_id
    and coalesce(state->>'teamId',id::text)=coalesce(anchor.state->>'teamId',anchor.id::text) order by id for update;
  select * into anchor from agent_chat_tasks where id=p_id;
  if coalesce(anchor.state->'controls','[]') ? p_request_id then
    return query select * from agent_chat_tasks where user_id=p_user_id and chat_id=anchor.chat_id and coalesce(state->>'teamId',id::text)=coalesce(anchor.state->>'teamId',anchor.id::text);return;
  end if;
  if (anchor.state->>'version')::integer<>p_version then raise exception 'Task changed.'; end if;
  if length(p_instruction) not between 1 and 6000 or coalesce(p_request_id,'')='' then raise exception 'Valid shared change required.'; end if;
  for member in select * from agent_chat_tasks where user_id=p_user_id and chat_id=anchor.chat_id
    and coalesce(state->>'teamId',id::text)=coalesce(anchor.state->>'teamId',anchor.id::text) order by id loop
    next_state=member.state;
    if length(coalesce(next_state->>'sharedInstructions',''))+length(p_instruction)+length(next_state->>'instructions')>23000 then raise exception 'Shared instruction budget reached.'; end if;
    next_state=next_state || jsonb_build_object('sharedInstructions',coalesce(next_state->>'sharedInstructions','') || E'\nOwner change: ' || p_instruction,
      'version',(next_state->>'version')::integer+1,'controls',coalesce(next_state->'controls','[]') || to_jsonb(p_request_id));
    if next_state->>'status' in ('queued','running','waiting_approval','completed','partial') then
      if next_state->'approval'->>'id' is not null then
        next_state=jsonb_set(next_state,'{events}',next_state->'events' || jsonb_build_array(jsonb_build_object('type','decision','callId',next_state->'approval'->>'id','status','expired','version',next_state->'version','seq',jsonb_array_length(next_state->'events')+1)));
      end if;
      next_state=next_state || jsonb_build_object('pending','[]'::jsonb,'approval',null,'status','queued','round',0,'result',null);
      next_state=jsonb_set(next_state,'{events}',next_state->'events' || jsonb_build_array(jsonb_build_object('type','card','version',next_state->'version','seq',jsonb_array_length(next_state->'events')+1,'card',jsonb_build_object('type','progress','status','done','label','Your changes now apply across this task team.'))));
    end if;
    update agent_chat_tasks set state=next_state,revision=revision+1,updated_at=now() where id=member.id;
  end loop;
  return query select * from agent_chat_tasks where user_id=p_user_id and chat_id=anchor.chat_id and coalesce(state->>'teamId',id::text)=coalesce(anchor.state->>'teamId',anchor.id::text);
end $$;

revoke all on function public.chat_task_team(text,uuid),public.message_chat_task_peer(text,uuid,uuid,text,integer,jsonb),public.steer_chat_task_team(text,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.chat_task_team(text,uuid),public.message_chat_task_peer(text,uuid,uuid,text,integer,jsonb),public.steer_chat_task_team(text,uuid,integer,text,text) to service_role;

-- Include team identity in compact client/coordinator snapshots.
create or replace function public.list_chat_tasks(p_user_id text, p_chat_id text, p_cursors jsonb default '{}', p_events boolean default true)
returns table(id uuid, chat_id text, revision bigint, state jsonb)
language sql security definer set search_path = public as $$
  select t.id,t.chat_id,t.revision,jsonb_build_object(
    'teamId',coalesce(t.state->>'teamId',t.id::text),'title',t.state->'title','status',t.state->'status','version',t.state->'version',
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
