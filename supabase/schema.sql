-- JSEO 2026, schema for the submission store.
-- Run once in the Supabase SQL editor.

create table if not exists public.jseo_submissions (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  reference     text not null unique,
  user_id       uuid not null references auth.users (id) on delete restrict,
  email         text not null,

  last_name     text not null,
  first_name    text not null,
  phone         text,
  status        text not null,
  institution   text not null,
  lab           text,

  title         text not null,
  coauthors     text,
  axis          text not null,
  presentation  text not null,
  language      text not null,
  keywords      text not null,
  abstract      text not null,

  file_path     text,
  file_name     text,
  file_size     integer
);

create index if not exists jseo_submissions_user_idx on public.jseo_submissions (user_id);
create index if not exists jseo_submissions_created_idx on public.jseo_submissions (created_at desc);

-- Row level security on, with no permissive policy for anon or authenticated.
-- The API writes with the service role key, which bypasses RLS. Without this,
-- the anon key exposed in the browser config could read every submission.
alter table public.jseo_submissions enable row level security;

-- Optional: let an author read back their own submissions.
drop policy if exists "authors read own submissions" on public.jseo_submissions;
create policy "authors read own submissions"
  on public.jseo_submissions
  for select
  to authenticated
  using (auth.uid() = user_id);


-- Private bucket for the abstract files. Keep public = false: the API uploads
-- with the service role key, and files are read from the Supabase dashboard or
-- through a signed URL.
insert into storage.buckets (id, name, public)
values ('jseo-resumes', 'jseo-resumes', false)
on conflict (id) do nothing;
