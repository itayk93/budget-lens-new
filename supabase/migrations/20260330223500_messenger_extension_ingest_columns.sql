-- Support Chrome extension ingestion metadata for messenger messages.

alter table public.messenger_messages
  add column if not exists dom_message_key text,
  add column if not exists capture_source text not null default 'chrome_extension',
  add column if not exists direction text;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'messenger_messages_direction_check'
      and conrelid = 'public.messenger_messages'::regclass
  ) then
    alter table public.messenger_messages
      add constraint messenger_messages_direction_check
      check (direction in ('incoming', 'outgoing'));
  end if;
end $$;
create unique index if not exists idx_messenger_messages_dom_message_key_unique
  on public.messenger_messages(dom_message_key)
  where dom_message_key is not null;
create index if not exists idx_messenger_messages_thread_ts
  on public.messenger_messages(thread_id, message_timestamp desc);
