-- AI classification columns for messenger and whatsapp_web threads.
-- Stores the result of AI relevance scan so it persists between sessions.

alter table public.messenger_threads
  add column if not exists ai_classification text
    constraint messenger_threads_ai_classification_check
    check (ai_classification in ('personal', 'potential_client', 'unknown')),
  add column if not exists ai_confidence   text
    constraint messenger_threads_ai_confidence_check
    check (ai_confidence in ('high', 'medium', 'low')),
  add column if not exists ai_reason       text,
  add column if not exists ai_classified_at timestamptz;
alter table public.whatsapp_web_threads
  add column if not exists ai_classification text
    constraint whatsapp_web_threads_ai_classification_check
    check (ai_classification in ('personal', 'potential_client', 'unknown')),
  add column if not exists ai_confidence   text
    constraint whatsapp_web_threads_ai_confidence_check
    check (ai_confidence in ('high', 'medium', 'low')),
  add column if not exists ai_reason       text,
  add column if not exists ai_classified_at timestamptz;
-- Index: quickly fetch threads that need classification
create index if not exists idx_messenger_threads_ai_unclassified
  on public.messenger_threads (ai_classified_at)
  where ai_classified_at is null and is_archived = false;
create index if not exists idx_whatsapp_web_threads_ai_unclassified
  on public.whatsapp_web_threads (ai_classified_at)
  where ai_classified_at is null and is_archived = false;
