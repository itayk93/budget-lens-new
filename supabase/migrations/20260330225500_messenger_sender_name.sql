-- Persist normalized sender display name for extension-captured messages.

alter table public.messenger_messages
  add column if not exists sender_name text;
