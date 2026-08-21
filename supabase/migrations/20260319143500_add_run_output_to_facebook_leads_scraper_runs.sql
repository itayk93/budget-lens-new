ALTER TABLE public.facebook_leads_scraper_runs
ADD COLUMN IF NOT EXISTS run_output jsonb;
