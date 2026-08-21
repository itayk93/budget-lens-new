-- Track automatic analysis progress per messenger thread mapping.

alter table public.messenger_thread_conversation_links
  add column if not exists last_analyzed_at timestamptz,
  add column if not exists last_analyzed_message_at timestamptz;
create index if not exists idx_messenger_thread_links_last_analyzed_at
  on public.messenger_thread_conversation_links(last_analyzed_at desc);
