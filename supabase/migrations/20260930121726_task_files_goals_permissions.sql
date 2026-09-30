-- Additive rollout: existing files remain readable; new files use private storage.
alter table public.library_items add column if not exists revision integer not null default 1;
alter table public.library_items add column if not exists storage_path text;
alter table public.library_items add column if not exists content_encoding text;
alter table public.library_items add column if not exists extracted_text text not null default '';
alter table public.library_items add column if not exists extraction_warnings jsonb not null default '[]';
create table if not exists public.library_item_versions (
  item_id text not null references public.library_items(id) on delete cascade,
  revision integer not null, user_id text not null references public.profiles(id) on delete cascade,
  title text not null, kind text not null, mime text, size bigint not null, content text not null,
  preview text not null, source text not null, source_chat_id text,
  storage_path text, content_encoding text, extracted_text text not null default '', extraction_warnings jsonb not null default '[]',
  created_at timestamptz not null, updated_at timestamptz not null,
  primary key(item_id,revision)
);
create or replace function public.archive_library_revision() returns trigger
language plpgsql set search_path=public as $$
begin
  if TG_OP='UPDATE' and NEW.revision=OLD.revision then return NEW; end if;
  insert into public.library_item_versions(item_id,revision,user_id,title,kind,mime,size,content,preview,source,source_chat_id,storage_path,content_encoding,extracted_text,extraction_warnings,created_at,updated_at)
  values(NEW.id,NEW.revision,NEW.user_id,NEW.title,NEW.kind,NEW.mime,NEW.size,NEW.content,NEW.preview,NEW.source,NEW.source_chat_id,NEW.storage_path,NEW.content_encoding,NEW.extracted_text,NEW.extraction_warnings,NEW.created_at,NEW.updated_at);
  return NEW;
end $$;
insert into public.library_item_versions(item_id,revision,user_id,title,kind,mime,size,content,preview,source,source_chat_id,created_at,updated_at)
select id,revision,user_id,title,kind,mime,size,content,preview,source,source_chat_id,created_at,updated_at from public.library_items on conflict do nothing;
drop trigger if exists archive_library_revision on public.library_items;
create trigger archive_library_revision after insert or update on public.library_items for each row execute function public.archive_library_revision();
insert into storage.buckets(id,name,public,file_size_limit) values('library-private','library-private',false,10485760) on conflict(id) do nothing;

alter table public.goals add column if not exists work jsonb not null default '{}';
alter table public.goals add column if not exists activity jsonb not null default '[]';
create table if not exists public.agent_permission_grants(
  id text primary key,user_id text not null references public.profiles(id) on delete cascade,
  tool text not null,effect text not null check(effect in ('allow','deny')),
  scope jsonb not null check(jsonb_typeof(scope)='object'),scope_mode text not null default 'exact' check(scope_mode in ('exact','subset')),label text not null,
  expires_at timestamptz not null,revoked_at timestamptz,created_at timestamptz not null default now()
);
create index if not exists permission_grants_owner on public.agent_permission_grants(user_id) where revoked_at is null;
alter table public.library_item_versions enable row level security;
alter table public.agent_permission_grants enable row level security;
revoke all on public.library_item_versions,public.agent_permission_grants from anon,authenticated;
grant all on public.library_item_versions,public.agent_permission_grants to service_role;
revoke all on function public.archive_library_revision() from public,anon,authenticated;
grant execute on function public.archive_library_revision() to service_role;
