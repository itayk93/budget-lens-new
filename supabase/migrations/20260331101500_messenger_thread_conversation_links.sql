-- Map messenger threads to conversation_analyses records so Messenger capture
-- appears in Clients + Deal Board pipelines.

create table if not exists public.messenger_thread_conversation_links (
  thread_id text primary key references public.messenger_threads(thread_id) on delete cascade,
  conversation_analysis_id uuid not null unique references public.conversation_analyses(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace function public._touch_messenger_thread_conversation_links_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_touch_messenger_thread_conversation_links_updated_at
  on public.messenger_thread_conversation_links;
create trigger trg_touch_messenger_thread_conversation_links_updated_at
before update on public.messenger_thread_conversation_links
for each row
execute function public._touch_messenger_thread_conversation_links_updated_at();
alter table public.messenger_thread_conversation_links enable row level security;
drop policy if exists messenger_thread_conversation_links_full_access on public.messenger_thread_conversation_links;
create policy messenger_thread_conversation_links_full_access
on public.messenger_thread_conversation_links
for all
to anon, authenticated
using (true)
with check (true);
