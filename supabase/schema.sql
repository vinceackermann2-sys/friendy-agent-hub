-- Lingon Supabase schema (free tier). Run in Supabase Dashboard > SQL Editor.
-- Creates tables + RLS so each user only sees their own rows.
-- Frontend never talks to Supabase directly; the Node backend uses the
-- service_role key server-side. If you use Supabase Auth later, the same
-- policies apply to the anon key with auth.uid().

create extension if not exists "pgcrypto";

-- one row per app user (use your own user id string for now, or auth.users id)
create table if not exists profiles (
  id text primary key,
  created_at timestamptz default now()
);

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references profiles(id) on delete cascade,
  name text not null,
  color text default 'lingon',
  pers text default 'Playful',
  claimed_at timestamptz default now()
);

create table if not exists agent_contexts (
  user_id text primary key references profiles(id) on delete cascade,
  agent jsonb not null default '{}'::jsonb,
  documents jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(agent) = 'object'),
  check (jsonb_typeof(documents) = 'object')
);

create table if not exists chats (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  title text default 'New chat',
  created_at timestamptz default now()
);

create table if not exists messages (
  id text primary key,
  chat_id text not null references chats(id) on delete cascade,
  role text not null,
  kind text default 'text',
  text text,
  card jsonb,
  created_at timestamptz default now()
);

create table if not exists memories (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  text text not null,
  src text default 'chat',
  category text not null default 'long_term' check (category in ('user','long_term','daily')),
  status text not null default 'active' check (status in ('active','superseded')),
  importance smallint not null default 1 check (importance between 0 and 3),
  observed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  superseded_by text references memories(id) on delete set null,
  source_chat_id text,
  source_message_id text,
  created_at timestamptz default now()
);
create index if not exists memories_user_idx on memories(user_id, created_at desc);
create index if not exists memories_active_user_idx on memories(user_id, category, updated_at desc) where status = 'active';
create index if not exists memories_search_idx on memories using gin(to_tsvector('simple', text));

create table if not exists vault_secrets (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  name text not null,
  ref text not null,
  encrypted_value jsonb not null,
  created_at timestamptz default now()
);
create index if not exists secrets_user_idx on vault_secrets(user_id, created_at desc);

create table if not exists vault_apps (
  user_id text not null references profiles(id) on delete cascade,
  app text not null,
  created_at timestamptz default now(),
  primary key (user_id, app)
);

create table if not exists connector_permissions (
  user_id text not null references profiles(id) on delete cascade,
  toolkit text not null,
  disabled jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now(),
  primary key (user_id, toolkit)
);

create table if not exists approvals (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  key text not null,
  label text not null,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
alter table agents enable row level security;
alter table agent_contexts enable row level security;
alter table chats enable row level security;
alter table messages enable row level security;
alter table memories enable row level security;
alter table vault_secrets enable row level security;
alter table vault_apps enable row level security;
alter table connector_permissions enable row level security;
alter table approvals enable row level security;
revoke all on agent_contexts from anon, authenticated;
grant all on agent_contexts to service_role;

create or replace function public.write_agent_context(
  p_user_id text,
  p_agent jsonb,
  p_documents jsonb,
  p_revision bigint default null
)
returns setof public.agent_contexts
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id, 29));
  if not exists(select 1 from agent_contexts where user_id = p_user_id) then
    if p_revision is not null and p_revision <> 0 then
      raise exception 'Agent context changed. Refresh and try again.' using errcode = '40001';
    end if;
    return query insert into agent_contexts(user_id, agent, documents)
      values(p_user_id, coalesce(p_agent, '{}'::jsonb), coalesce(p_documents, '{}'::jsonb))
      returning *;
    return;
  end if;
  if p_revision is not null and not exists(
    select 1 from agent_contexts where user_id = p_user_id and revision = p_revision
  ) then
    raise exception 'Agent context changed. Refresh and try again.' using errcode = '40001';
  end if;
  return query update agent_contexts
    set agent = coalesce(p_agent, agent), documents = coalesce(p_documents, documents),
        revision = revision + 1, updated_at = now()
    where user_id = p_user_id returning *;
end $$;
create or replace function public.forget_agent_memory(p_user_id text,p_memory_id text)
returns integer language plpgsql security definer set search_path=public as $$
declare removed integer; begin
  with recursive family(id,superseded_by) as (
    select id,superseded_by from memories where id=p_memory_id and user_id=p_user_id
    union
    select m.id,m.superseded_by from memories m join family f on m.id=f.superseded_by or m.superseded_by=f.id where m.user_id=p_user_id
  ), deleted as (delete from memories where user_id=p_user_id and id in (select id from family) returning id)
  select count(*) into removed from deleted;
  return removed;
end $$;

revoke all on function public.write_agent_context(text,jsonb,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.write_agent_context(text,jsonb,jsonb,bigint) to service_role;

create or replace function public.search_agent_memories(p_user_id text,p_query text,p_limit integer default 12,p_include_core boolean default false)
returns table(id text,user_id text,text text,src text,category text,status text,importance smallint,observed_at timestamptz,updated_at timestamptz,superseded_by text,source_chat_id text,source_message_id text,created_at timestamptz,score real)
language sql security definer stable set search_path=public as $$
  with tokens as (select unnest(tsvector_to_array(to_tsvector('simple',coalesce(p_query,'')))) token),
  useful as (select token from tokens where length(token)>2 and token not in ('the','and','for','with','from','that','this','what','when','where','which','who','how','why','you','your','they','their','have','has','are','was','were','can','will','could','would','please','tell','show','about','remember','know')),
  q as (select case when count(*)=0 then null else to_tsquery('simple',string_agg(quote_literal(token),' | ')) end value from useful)
  select m.id,m.user_id,m.text,m.src,m.category,m.status,m.importance,m.observed_at,m.updated_at,m.superseded_by,m.source_chat_id,m.source_message_id,m.created_at,
    case when trim(coalesce(p_query,''))='' then 0::real else coalesce(ts_rank_cd(to_tsvector('simple',m.text),q.value),0)::real end
  from memories m cross join q where m.user_id=p_user_id and m.status='active' and (trim(coalesce(p_query,''))='' or (q.value is not null and to_tsvector('simple',m.text) @@ q.value) or lower(m.text) like '%'||lower(trim(p_query))||'%' or (p_include_core and m.category='user' and m.importance>=2))
  order by 14 desc,m.importance desc,case when m.category in ('user','long_term') then 0 else 1 end,m.updated_at desc limit least(greatest(coalesce(p_limit,12),1),100);
$$;
create or replace function public.supersede_agent_memory(p_user_id text,p_memory_id text,p_new_id text,p_text text,p_category text,p_src text,p_importance smallint default 1)
returns setof public.memories language plpgsql security definer set search_path=public as $$
declare prior public.memories; begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id||':'||p_memory_id,31));
  select * into prior from memories where id=p_memory_id and user_id=p_user_id and status='active' for update;
  if not found then raise exception 'Active memory not found.' using errcode='P0002'; end if;
  insert into memories(id,user_id,text,src,category,status,importance,observed_at,updated_at,source_chat_id,source_message_id)
    values(p_new_id,p_user_id,p_text,coalesce(p_src,'user_edit'),coalesce(p_category,prior.category),'active',coalesce(p_importance,prior.importance),now(),now(),prior.source_chat_id,prior.source_message_id);
  update memories set status='superseded',superseded_by=p_new_id,updated_at=now() where id=p_memory_id and user_id=p_user_id;
  return query select * from memories where id=p_new_id and user_id=p_user_id;
end $$;
revoke all on memories from anon,authenticated;
grant all on memories to service_role;
revoke all on function public.search_agent_memories(text,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.search_agent_memories(text,text,integer,boolean) to service_role;
revoke all on function public.supersede_agent_memory(text,text,text,text,text,text,smallint) from public,anon,authenticated;
grant execute on function public.supersede_agent_memory(text,text,text,text,text,text,smallint) to service_role;
revoke all on function public.forget_agent_memory(text,text) from public,anon,authenticated;
grant execute on function public.forget_agent_memory(text,text) to service_role;

-- Service-role key bypasses RLS (backend use). For anon/authenticated use,
-- allow users to manage their own rows when auth.uid()::text = user_id.
-- (If you don't use Supabase Auth yet, the backend service_role still works.)

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'own rows') then
    create policy "own rows" on profiles for all using (true) with check (true);
  end if;
end $$;

-- ============ billing: Stripe subscriptions, credit ledger, gifts ============
-- Credits: 1 credit = $0.50 face value. Users only ever see credits.
create table if not exists subscriptions (
  user_id text primary key references profiles(id) on delete cascade,
  plan text not null default 'free',
  status text not null default 'active',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  gift_issued boolean not null default false,
  created_at timestamptz default now()
);
create index if not exists subs_customer_idx on subscriptions(stripe_customer_id);

-- Every credit grant: free starter, monthly subscription, gift redeem.
create table if not exists credit_grants (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  credits double precision not null default 0,
  reason text not null default 'grant',
  ref text,
  created_at timestamptz default now()
);
create index if not exists grants_user_idx on credit_grants(user_id, created_at desc);
create unique index if not exists credit_grants_user_ref_unique on credit_grants(user_id, ref);

-- Model usage log. credits_charged includes our margin (older rows without it
-- are honored at face rate: credits = cost_usd * 2).
create table if not exists api_usage (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  model text,
  prompt_tokens integer not null default 0,
  candidates_tokens integer not null default 0,
  total_tokens integer not null default 0,
  cost_usd double precision not null default 0,
  credits_charged double precision,
  created_at timestamptz default now()
);
create index if not exists usage_user_idx on api_usage(user_id, created_at desc);

-- Gift cards keep their dollar face value ($50/$100) and redeem into credits
-- at 2 credits per $1.
create table if not exists gift_cards (
  code text primary key,
  amount_usd double precision not null,
  from_user text,
  purchased_by text,
  to_user text,
  redeemed_by text,
  redeemed_at timestamptz,
  created_at timestamptz default now()
);

-- Pre-Stripe upgrade requests (kept for history; Stripe is the real flow now).
create table if not exists upgrade_requests (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  plan text not null,
  status text not null default 'requested',
  created_at timestamptz default now()
);

-- Requests made through the statutory online withdrawal function.
create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  purchase_reference text not null,
  purchase_kind text not null check (purchase_kind in ('subscription', 'token_pack', 'other')),
  received_at timestamptz not null default now(),
  receipt_sent_at timestamptz,
  status text not null default 'received'
);
create index if not exists withdrawal_requests_received_at_idx on public.withdrawal_requests (received_at desc);
alter table public.withdrawal_requests enable row level security;
revoke all on public.withdrawal_requests from anon, authenticated;

-- Stripe webhook idempotency (processed event ids).
create table if not exists stripe_events (
  id text primary key,
  created_at timestamptz default now()
);

alter table subscriptions enable row level security;
alter table credit_grants enable row level security;
alter table api_usage enable row level security;
alter table gift_cards enable row level security;
alter table upgrade_requests enable row level security;
alter table stripe_events enable row level security;

create table if not exists agent_mailboxes (
  user_id text primary key references profiles(id) on delete cascade,
  local_part text not null,
  address text not null,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  unique (local_part),
  unique (address)
);
create table if not exists agent_mail_messages (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  mailbox_address text not null,
  direction text not null default 'inbound',
  folder text not null default 'inbox',
  from_address text not null default '',
  from_name text not null default '',
  to_addresses jsonb not null default '[]'::jsonb,
  cc_addresses jsonb not null default '[]'::jsonb,
  subject text not null default '',
  body_text text not null default '',
  body_html text not null default '',
  message_id text,
  in_reply_to text,
  thread_id text,
  resend_id text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists agent_mail_messages_user_idx on agent_mail_messages(user_id, created_at desc);
create index if not exists agent_mail_messages_folder_idx on agent_mail_messages(user_id, folder, created_at desc);
create unique index if not exists agent_mail_messages_resend_idx on agent_mail_messages(resend_id) where resend_id is not null;
create table if not exists agent_mail_drafts (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  to_addresses jsonb not null default '[]'::jsonb,
  subject text not null default '',
  body_text text not null default '',
  in_reply_to text,
  updated_at timestamptz not null default now()
);
create index if not exists agent_mail_drafts_user_idx on agent_mail_drafts(user_id, updated_at desc);
alter table agent_mailboxes enable row level security;
alter table agent_mail_messages enable row level security;
alter table agent_mail_drafts enable row level security;
revoke all on agent_mailboxes, agent_mail_messages, agent_mail_drafts from anon, authenticated;
grant all on agent_mailboxes, agent_mail_messages, agent_mail_drafts to service_role;

create table if not exists agent_vm_instances (
  user_id text primary key,
  vm_name text not null unique,
  power_state text not null default 'deallocated'
    check (power_state in ('deallocated', 'starting', 'running', 'stopping')),
  stop_claim_token text,
  stop_claimed_at timestamptz,
  last_lease_at timestamptz,
  idle_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists agent_vm_leases (
  user_id text not null references agent_vm_instances(user_id) on delete cascade,
  lease_id text not null,
  kind text not null default 'app',
  vm_name text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, lease_id)
);
create index if not exists agent_vm_leases_expires_idx on agent_vm_leases(expires_at);
alter table agent_vm_instances enable row level security;
alter table agent_vm_leases enable row level security;
revoke all on agent_vm_instances, agent_vm_leases from anon, authenticated;
grant all on agent_vm_instances, agent_vm_leases to service_role;

-- ============ goals + library (shared by the app and the agent tools) ============
create table if not exists public.goals (
  id text primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  category text not null default 'other'
    check (category in ('health','family','finance','career','interests','productivity','other')),
  status text not null default 'active' check (status in ('active','paused','done')),
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  source_chat_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists goals_user_idx on public.goals(user_id, created_at desc);

-- Text artifacts keep their body; media is a data URL capped by the server at 6 MB.
create table if not exists public.library_items (
  id text primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  kind text not null check (kind in ('document','web','image','video','audio','file')),
  mime text,
  size bigint not null default 0,
  content text not null,
  preview text not null default '',
  source text not null default 'agent' check (source in ('agent','upload')),
  source_chat_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists library_items_user_idx on public.library_items(user_id, created_at desc);
create index if not exists library_items_user_kind_idx on public.library_items(user_id, kind, created_at desc);

alter table public.goals enable row level security;
alter table public.library_items enable row level security;
revoke all on public.goals, public.library_items from anon, authenticated;
grant all on public.goals, public.library_items to service_role;

-- Lease, server-secret, and atomic wallet-reservation functions plus the
-- minute sweeper schedule live in timestamped migrations under migrations/.
