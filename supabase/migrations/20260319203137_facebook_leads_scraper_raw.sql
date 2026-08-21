create table if not exists public.facebook_leads_scraper_raw (
  id uuid primary key default gen_random_uuid(),
  run_id text not null,
  title text,
  link text,
  snippet text,
  query_label text,
  created_at timestamptz not null default now()
);
create index if not exists facebook_leads_scraper_raw_created_at_idx
  on public.facebook_leads_scraper_raw (created_at desc);
create index if not exists facebook_leads_scraper_raw_run_id_idx
  on public.facebook_leads_scraper_raw (run_id);
