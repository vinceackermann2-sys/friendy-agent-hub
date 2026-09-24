create table if not exists public.support_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('issue', 'feedback')),
  name text,
  email text,
  topic text not null,
  description text not null,
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  status text not null default 'new',
  created_at timestamptz not null default now()
);
create index if not exists support_submissions_created_at_idx on public.support_submissions (created_at desc);
create index if not exists support_submissions_user_id_idx on public.support_submissions (user_id, created_at desc);
alter table public.support_submissions enable row level security;
revoke all on public.support_submissions from anon, authenticated;
grant all on public.support_submissions to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-attachments', 'support-attachments', false, 2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;
