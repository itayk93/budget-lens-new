-- Lead analysis fields for WhatsApp group messages

ALTER TABLE public.whatsapp_group_messages
  ADD COLUMN IF NOT EXISTS is_potential_lead boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lead_score integer,
  ADD COLUMN IF NOT EXISTS lead_reason text,
  ADD COLUMN IF NOT EXISTS ai_analyzed_at timestamptz;
ALTER TABLE public.whatsapp_group_messages
  DROP CONSTRAINT IF EXISTS whatsapp_group_messages_lead_score_range_check;
ALTER TABLE public.whatsapp_group_messages
  ADD CONSTRAINT whatsapp_group_messages_lead_score_range_check
  CHECK (lead_score IS NULL OR (lead_score >= 0 AND lead_score <= 100));
CREATE INDEX IF NOT EXISTS idx_whatsapp_group_messages_leads
  ON public.whatsapp_group_messages (group_id, lead_score DESC)
  WHERE is_potential_lead = true;
CREATE INDEX IF NOT EXISTS idx_whatsapp_group_messages_unanalyzed
  ON public.whatsapp_group_messages (group_id, ai_analyzed_at)
  WHERE ai_analyzed_at IS NULL;
