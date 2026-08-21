CREATE TABLE IF NOT EXISTS public.facebook_leads_scraper_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  total_found integer,
  saved_to_db integer,
  message text,
  leads_preview jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fb_leads_scraper_runs_started_at
  ON public.facebook_leads_scraper_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_fb_leads_scraper_runs_status
  ON public.facebook_leads_scraper_runs (status);
ALTER TABLE public.facebook_leads_scraper_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all select on facebook_leads_scraper_runs" ON public.facebook_leads_scraper_runs;
DROP POLICY IF EXISTS "Allow all insert on facebook_leads_scraper_runs" ON public.facebook_leads_scraper_runs;
DROP POLICY IF EXISTS "Allow all update on facebook_leads_scraper_runs" ON public.facebook_leads_scraper_runs;
DROP POLICY IF EXISTS "Allow all delete on facebook_leads_scraper_runs" ON public.facebook_leads_scraper_runs;
CREATE POLICY "Allow all select on facebook_leads_scraper_runs"
  ON public.facebook_leads_scraper_runs FOR SELECT USING (true);
CREATE POLICY "Allow all insert on facebook_leads_scraper_runs"
  ON public.facebook_leads_scraper_runs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on facebook_leads_scraper_runs"
  ON public.facebook_leads_scraper_runs FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on facebook_leads_scraper_runs"
  ON public.facebook_leads_scraper_runs FOR DELETE USING (true);
CREATE OR REPLACE FUNCTION public.update_facebook_leads_scraper_runs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS update_facebook_leads_scraper_runs_updated_at ON public.facebook_leads_scraper_runs;
CREATE TRIGGER update_facebook_leads_scraper_runs_updated_at
BEFORE UPDATE ON public.facebook_leads_scraper_runs
FOR EACH ROW
EXECUTE FUNCTION public.update_facebook_leads_scraper_runs_updated_at();
