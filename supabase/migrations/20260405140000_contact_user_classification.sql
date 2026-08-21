-- User manual classification: 'relevant' = good lead, 'irrelevant' = personal/not relevant.
-- Once set (either value) the contact leaves the triage inbox.

alter table public.messenger_threads
  add column if not exists user_classification text
    constraint messenger_threads_user_classification_check
    check (user_classification in ('relevant', 'irrelevant'));
alter table public.whatsapp_web_threads
  add column if not exists user_classification text
    constraint whatsapp_web_threads_user_classification_check
    check (user_classification in ('relevant', 'irrelevant'));
-- Index: fast filter for the triage inbox (only unclassified + not archived)
create index if not exists idx_messenger_threads_triage
  on public.messenger_threads (user_classification, is_archived, last_message_at desc)
  where user_classification is null and is_archived = false;
create index if not exists idx_whatsapp_web_threads_triage
  on public.whatsapp_web_threads (user_classification, is_archived, last_message_at desc)
  where user_classification is null and is_archived = false;
