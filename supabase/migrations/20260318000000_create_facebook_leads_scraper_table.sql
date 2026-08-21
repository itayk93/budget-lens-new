-- Facebook Leads Scraper Table
-- Stores leads scraped from Facebook groups via Google search

CREATE TABLE public.facebook_leads_scraper (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  link text NOT NULL,
  snippet text,
  full_content text,
  content_length integer DEFAULT 0,
  enhanced boolean DEFAULT false,
  scraped_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Index for performance
CREATE INDEX idx_facebook_leads_scraper_scraped_at ON public.facebook_leads_scraper(scraped_at DESC);
CREATE INDEX idx_facebook_leads_scraper_enhanced ON public.facebook_leads_scraper(enhanced);
-- Enable RLS
ALTER TABLE public.facebook_leads_scraper ENABLE ROW LEVEL SECURITY;
-- RLS Policies (Allow all for now)
CREATE POLICY "Allow all select on facebook_leads_scraper" ON public.facebook_leads_scraper FOR SELECT USING (true);
CREATE POLICY "Allow all insert on facebook_leads_scraper" ON public.facebook_leads_scraper FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on facebook_leads_scraper" ON public.facebook_leads_scraper FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on facebook_leads_scraper" ON public.facebook_leads_scraper FOR DELETE USING (true);
-- Updated at trigger
CREATE OR REPLACE FUNCTION public.update_facebook_leads_scraper_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER update_facebook_leads_scraper_updated_at
BEFORE UPDATE ON public.facebook_leads_scraper
FOR EACH ROW
EXECUTE FUNCTION public.update_facebook_leads_scraper_updated_at();
