-- Contact archive: mark irrelevant contacts (family, friends, non-leads) so they
-- disappear from all analysis screens and their media is cleaned up.

-- ─── 1. contact_archive table ─────────────────────────────────────────────────
-- Central registry of archived contacts across all sources.
create table if not exists public.contact_archive (
  id           uuid        primary key default gen_random_uuid(),
  source       text        not null,   -- 'messenger' | 'whatsapp_web' | 'whatsapp_group' | 'call_transcript'
  thread_id    text        not null,   -- thread/group/transcript id from the source table
  contact_name text,
  archived_at  timestamptz not null default now(),
  archived_by  text,
  constraint contact_archive_source_check
    check (source in ('messenger', 'whatsapp_web', 'whatsapp_group', 'call_transcript')),
  unique (source, thread_id)
);
create index if not exists idx_contact_archive_source_thread
  on public.contact_archive (source, thread_id);
alter table public.contact_archive enable row level security;
drop policy if exists contact_archive_full_access on public.contact_archive;
create policy contact_archive_full_access
  on public.contact_archive
  for all
  to anon, authenticated
  using (true)
  with check (true);
-- ─── 2. is_archived columns on source tables ──────────────────────────────────

alter table public.messenger_threads
  add column if not exists is_archived boolean not null default false;
create index if not exists idx_messenger_threads_is_archived
  on public.messenger_threads (is_archived)
  where is_archived = false;
alter table public.whatsapp_web_threads
  add column if not exists is_archived boolean not null default false;
create index if not exists idx_whatsapp_web_threads_is_archived
  on public.whatsapp_web_threads (is_archived)
  where is_archived = false;
alter table public.whatsapp_chat_groups
  add column if not exists is_archived boolean not null default false;
create index if not exists idx_whatsapp_chat_groups_is_archived
  on public.whatsapp_chat_groups (is_archived)
  where is_archived = false;
alter table public.call_transcripts
  add column if not exists is_archived boolean not null default false;
create index if not exists idx_call_transcripts_is_archived
  on public.call_transcripts (is_archived)
  where is_archived = false;
