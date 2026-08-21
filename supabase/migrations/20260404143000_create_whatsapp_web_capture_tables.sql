-- WhatsApp Web capture storage for unified Chrome extension ingestion.

create table if not exists public.whatsapp_web_threads (
  thread_id text primary key,
  name text,
  snippet text,
  participant_count integer,
  is_group boolean not null default false,
  last_message_at timestamptz,
  last_synced_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.whatsapp_web_messages (
  provider_message_id text primary key,
  thread_id text not null references public.whatsapp_web_threads(thread_id) on delete cascade,
  sender_id text,
  sender_name text,
  message_timestamp timestamptz not null,
  body text,
  attachments jsonb not null default '[]'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  dom_message_key text,
  capture_source text not null default 'chrome_extension_whatsapp',
  direction text,
  constraint whatsapp_web_messages_direction_check check (direction in ('incoming', 'outgoing'))
);
create table if not exists public.whatsapp_web_media (
  id uuid primary key default gen_random_uuid(),
  message_provider_id text not null references public.whatsapp_web_messages(provider_message_id) on delete cascade,
  thread_id text not null references public.whatsapp_web_threads(thread_id) on delete cascade,
  media_index integer not null default 0,
  media_type text not null,
  mime_type text,
  source_url text,
  storage_path text,
  size_bytes bigint,
  sha256 text,
  created_at timestamptz not null default now(),
  unique (message_provider_id, media_index)
);
create table if not exists public.whatsapp_web_sync_runs (
  id bigserial primary key,
  platform text not null default 'whatsapp_web',
  trigger text not null default 'extension_push',
  status text not null check (status in ('running', 'success', 'failed')),
  range_start timestamptz,
  range_end timestamptz,
  threads_scanned integer not null default 0,
  messages_scanned integer not null default 0,
  messages_inserted integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists idx_whatsapp_web_threads_last_message
  on public.whatsapp_web_threads(last_message_at desc);
create index if not exists idx_whatsapp_web_messages_thread_ts
  on public.whatsapp_web_messages(thread_id, message_timestamp desc);
create index if not exists idx_whatsapp_web_messages_dom_key
  on public.whatsapp_web_messages(dom_message_key)
  where dom_message_key is not null;
create index if not exists idx_whatsapp_web_media_thread
  on public.whatsapp_web_media(thread_id, created_at desc);
create index if not exists idx_whatsapp_web_sync_runs_started
  on public.whatsapp_web_sync_runs(started_at desc);
create or replace function public._touch_whatsapp_web_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_touch_whatsapp_web_threads_updated_at on public.whatsapp_web_threads;
create trigger trg_touch_whatsapp_web_threads_updated_at
before update on public.whatsapp_web_threads
for each row
execute function public._touch_whatsapp_web_updated_at();
drop trigger if exists trg_touch_whatsapp_web_messages_updated_at on public.whatsapp_web_messages;
create trigger trg_touch_whatsapp_web_messages_updated_at
before update on public.whatsapp_web_messages
for each row
execute function public._touch_whatsapp_web_updated_at();
alter table public.whatsapp_web_threads enable row level security;
alter table public.whatsapp_web_messages enable row level security;
alter table public.whatsapp_web_media enable row level security;
alter table public.whatsapp_web_sync_runs enable row level security;
drop policy if exists whatsapp_web_threads_full_access on public.whatsapp_web_threads;
create policy whatsapp_web_threads_full_access
on public.whatsapp_web_threads
for all
to anon, authenticated
using (true)
with check (true);
drop policy if exists whatsapp_web_messages_full_access on public.whatsapp_web_messages;
create policy whatsapp_web_messages_full_access
on public.whatsapp_web_messages
for all
to anon, authenticated
using (true)
with check (true);
drop policy if exists whatsapp_web_media_full_access on public.whatsapp_web_media;
create policy whatsapp_web_media_full_access
on public.whatsapp_web_media
for all
to anon, authenticated
using (true)
with check (true);
drop policy if exists whatsapp_web_sync_runs_full_access on public.whatsapp_web_sync_runs;
create policy whatsapp_web_sync_runs_full_access
on public.whatsapp_web_sync_runs
for all
to anon, authenticated
using (true)
with check (true);
insert into storage.buckets (id, name, public)
values ('whatsapp-web-media', 'whatsapp-web-media', false)
on conflict (id) do nothing;
drop policy if exists whatsapp_web_media_storage_read on storage.objects;
create policy whatsapp_web_media_storage_read
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'whatsapp-web-media');
drop policy if exists whatsapp_web_media_storage_write on storage.objects;
create policy whatsapp_web_media_storage_write
on storage.objects
for all
to anon, authenticated
using (bucket_id = 'whatsapp-web-media')
with check (bucket_id = 'whatsapp-web-media');
