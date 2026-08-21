ALTER TABLE public.landing_leads
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS landing_leads_active_created_at_idx
  ON public.landing_leads (created_at DESC)
  WHERE is_archived = false;
