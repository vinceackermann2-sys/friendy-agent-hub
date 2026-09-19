create table if not exists public.agent_mailboxes (
  user_id text primary key references public.profiles(id) on delete cascade,
  local_part text not null,
  address text not null,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  unique (local_part),
  unique (address)
);
create table if not exists public.agent_mail_messages (
  id text primary key,
  user_id text not null references public.profiles(id) on delete cascade,
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
create index if not exists agent_mail_messages_user_idx on public.agent_mail_messages(user_id, created_at desc);
create index if not exists agent_mail_messages_folder_idx on public.agent_mail_messages(user_id, folder, created_at desc);
create unique index if not exists agent_mail_messages_resend_idx on public.agent_mail_messages(resend_id) where resend_id is not null;
create table if not exists public.agent_mail_drafts (
  id text primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  to_addresses jsonb not null default '[]'::jsonb,
  subject text not null default '',
  body_text text not null default '',
  in_reply_to text,
  updated_at timestamptz not null default now()
);
create index if not exists agent_mail_drafts_user_idx on public.agent_mail_drafts(user_id, updated_at desc);
alter table public.agent_mailboxes enable row level security;
alter table public.agent_mail_messages enable row level security;
alter table public.agent_mail_drafts enable row level security;
revoke all on public.agent_mailboxes, public.agent_mail_messages, public.agent_mail_drafts from anon, authenticated;
grant all on public.agent_mailboxes, public.agent_mail_messages, public.agent_mail_drafts to service_role;
