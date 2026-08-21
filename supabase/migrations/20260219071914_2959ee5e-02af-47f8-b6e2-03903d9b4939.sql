ALTER TABLE public.facebook_posts
  ADD COLUMN is_potential_lead boolean DEFAULT false,
  ADD COLUMN lead_score integer,
  ADD COLUMN lead_reason text,
  ADD COLUMN ai_analyzed_at timestamptz;
CREATE INDEX idx_facebook_posts_leads ON public.facebook_posts (is_potential_lead, lead_score DESC)
  WHERE is_potential_lead = true;
