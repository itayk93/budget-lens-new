alter table public.conversation_analyses
  add column if not exists funnel_stage text default 'lead',
  add column if not exists funnel_handoff_detected boolean default false,
  add column if not exists funnel_phone_detected boolean default false,
  add column if not exists funnel_zoom_detected boolean default false,
  add column if not exists funnel_quote_detected boolean default false,
  add column if not exists funnel_evidence jsonb default '{}'::jsonb,
  add column if not exists funnel_client_link_id uuid,
  add column if not exists funnel_payment_match boolean default false,
  add column if not exists funnel_match_method text;
alter table public.whatsapp_analyses
  add column if not exists funnel_stage text default 'lead',
  add column if not exists funnel_handoff_detected boolean default false,
  add column if not exists funnel_phone_detected boolean default false,
  add column if not exists funnel_zoom_detected boolean default false,
  add column if not exists funnel_quote_detected boolean default false,
  add column if not exists funnel_evidence jsonb default '{}'::jsonb,
  add column if not exists funnel_client_link_id uuid,
  add column if not exists funnel_payment_match boolean default false,
  add column if not exists funnel_match_method text;
notify pgrst, 'reload schema';
