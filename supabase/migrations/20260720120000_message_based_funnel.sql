-- Message-content funnel is the source of truth for the sales flow.
-- Legacy sales_stage/deal_status columns are retained for compatibility only.

alter table public.conversation_analyses
  add column if not exists funnel_stage text not null default 'lead',
  add column if not exists funnel_handoff_detected boolean not null default false,
  add column if not exists funnel_phone_detected boolean not null default false,
  add column if not exists funnel_zoom_detected boolean not null default false,
  add column if not exists funnel_quote_detected boolean not null default false,
  add column if not exists funnel_evidence jsonb not null default '{}'::jsonb,
  add column if not exists funnel_client_link_id uuid,
  add column if not exists funnel_payment_match boolean not null default false,
  add column if not exists funnel_match_method text,
  add column if not exists funnel_classified_at timestamptz;
alter table public.whatsapp_analyses
  add column if not exists funnel_stage text not null default 'lead',
  add column if not exists funnel_handoff_detected boolean not null default false,
  add column if not exists funnel_phone_detected boolean not null default false,
  add column if not exists funnel_zoom_detected boolean not null default false,
  add column if not exists funnel_quote_detected boolean not null default false,
  add column if not exists funnel_evidence jsonb not null default '{}'::jsonb,
  add column if not exists funnel_client_link_id uuid,
  add column if not exists funnel_payment_match boolean not null default false,
  add column if not exists funnel_match_method text,
  add column if not exists funnel_classified_at timestamptz;
create table if not exists public.conversation_funnel_records (
  id uuid primary key default gen_random_uuid(),
  source_platform text not null check (source_platform in ('Facebook Messenger','WhatsApp')),
  source_conversation_id uuid not null,
  thread_key text,
  person_name text,
  first_message_at timestamptz,
  last_message_at timestamptz,
  message_count integer not null default 0,
  funnel_stage text not null default 'lead',
  handoff_detected boolean not null default false,
  phone_detected boolean not null default false,
  zoom_detected boolean not null default false,
  quote_detected boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  client_link_id uuid,
  link_status text not null default 'unlinked' check (link_status in ('linked','unlinked','ambiguous')),
  link_method text,
  link_confidence numeric(5,4),
  payment_match boolean not null default false,
  payment_match_method text,
  payment_transaction_ids uuid[] not null default '{}'::uuid[],
  classified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_platform, source_conversation_id)
);
create index if not exists idx_conversation_funnel_stage on public.conversation_funnel_records(funnel_stage);
create index if not exists idx_conversation_funnel_platform_date on public.conversation_funnel_records(source_platform, first_message_at);
create index if not exists idx_conversation_funnel_client on public.conversation_funnel_records(client_link_id);
alter table public.conversation_funnel_records enable row level security;
drop policy if exists conversation_funnel_records_service_role on public.conversation_funnel_records;
create policy conversation_funnel_records_service_role on public.conversation_funnel_records
  for all to service_role using (true) with check (true);
