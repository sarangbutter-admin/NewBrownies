-- Sarang Butter – database setup for Supabase.
-- Run once: Supabase dashboard → SQL Editor → paste this whole file → Run.
-- (or with the CLI:  supabase link --project-ref <ref>  &&  supabase db push)
--
-- SECURITY MODEL: only the Netlify server talks to this database, using the project's SECRET key.
-- Row Level Security is switched on with NO policies, so the public "anon"/"publishable" key
-- (the one browsers can see) can read and write NOTHING here.

create table if not exists public.kv (
  key        text primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now()
);

-- fast "all keys that start with ..." lookups
create index if not exists kv_key_prefix_idx on public.kv (key text_pattern_ops);

alter table public.kv enable row level security;
revoke all on public.kv from anon, authenticated;

-- Private storage bucket for owner uploads (product photos/videos, logo, marquee image, QR images).
-- Not public: the Netlify server reads files and serves them to shoppers.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 4718592,
        array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
