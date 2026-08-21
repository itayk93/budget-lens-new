-- Messenger personal sync storage and run tracking.

create table if not exists public.messenger_sync_state (
  sync_key text primary key,
  initial_backfill_completed boolean not null default false,
  initial_backfill_from timestamptz not null default '2026-03-01T00:00:00Z'::timestamptz,
  last_successful_sync_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.messenger_sync_state (sync_key)
values ('messenger_personal')
on conflict (sync_key) do nothing;
create table if not exists public.messenger_sync_runs (
  id bigserial primary key,
  sync_key text not null references public.messenger_sync_state(sync_key) on delete cascade,
  run_type text not null check (run_type in ('initial_backfill', 'delta', 'manual')),
  trigger text not null default 'manual',
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
create index if not exists idx_messenger_sync_runs_sync_started
  on public.messenger_sync_runs(sync_key, started_at desc);
create table if not exists public.messenger_threads (
  thread_id text primary key,
  name text,
  snippet text,
  participant_count integer,
  is_group boolean not null default false,
  last_message_at timestamptz,
  last_synced_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb
);
create index if not exists idx_messenger_threads_last_message
  on public.messenger_threads(last_message_at desc);
create table if not exists public.messenger_messages (
  provider_message_id text primary key,
  thread_id text not null references public.messenger_threads(thread_id) on delete cascade,
  sender_id text,
  message_timestamp timestamptz not null,
  body text,
  attachments jsonb not null default '[]'::jsonb,
  is_group boolean not null default false,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_messenger_messages_thread_ts
  on public.messenger_messages(thread_id, message_timestamp desc);
create index if not exists idx_messenger_messages_ts
  on public.messenger_messages(message_timestamp desc);
create or replace function public._touch_messenger_message_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_touch_messenger_messages_updated_at on public.messenger_messages;
create trigger trg_touch_messenger_messages_updated_at
before update on public.messenger_messages
for each row
execute function public._touch_messenger_message_updated_at();
alter table public.messenger_sync_state enable row level security;
alter table public.messenger_sync_runs enable row level security;
alter table public.messenger_threads enable row level security;
alter table public.messenger_messages enable row level security;
drop policy if exists authenticated_full_access on public.messenger_sync_state;
create policy authenticated_full_access
on public.messenger_sync_state
for all
to authenticated
using (true)
with check (true);
drop policy if exists authenticated_full_access on public.messenger_sync_runs;
create policy authenticated_full_access
on public.messenger_sync_runs
for all
to authenticated
using (true)
with check (true);
drop policy if exists authenticated_full_access on public.messenger_threads;
create policy authenticated_full_access
on public.messenger_threads
for all
to authenticated
using (true)
with check (true);
drop policy if exists authenticated_full_access on public.messenger_messages;
create policy authenticated_full_access
on public.messenger_messages
for all
to authenticated
using (true)
with check (true);
