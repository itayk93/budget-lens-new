create table if not exists public.facebook_leads_scraper_invocations (
  id uuid primary key default gen_random_uuid(),
  run_id text,
  source text,
  message text,
  created_at timestamptz not null default now()
);
create index if not exists facebook_leads_scraper_invocations_created_at_idx
  on public.facebook_leads_scraper_invocations (created_at desc);
create index if not exists facebook_leads_scraper_invocations_run_id_idx
  on public.facebook_leads_scraper_invocations (run_id);
