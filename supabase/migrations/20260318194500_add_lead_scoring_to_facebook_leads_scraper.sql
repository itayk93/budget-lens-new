ALTER TABLE public.facebook_leads_scraper
  ADD COLUMN IF NOT EXISTS is_potential_lead boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lead_score integer,
  ADD COLUMN IF NOT EXISTS lead_reason text,
  ADD COLUMN IF NOT EXISTS ai_analyzed_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'facebook_leads_scraper_lead_score_range'
  ) THEN
    ALTER TABLE public.facebook_leads_scraper
      ADD CONSTRAINT facebook_leads_scraper_lead_score_range
      CHECK (lead_score IS NULL OR (lead_score >= 0 AND lead_score <= 100));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_facebook_leads_scraper_lead_score
  ON public.facebook_leads_scraper (lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_facebook_leads_scraper_ai_analyzed
  ON public.facebook_leads_scraper (ai_analyzed_at DESC);
