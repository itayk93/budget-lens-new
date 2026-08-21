-- Phase 1+2 foundation for WhatsApp group lead quality

ALTER TABLE public.whatsapp_group_messages
  ADD COLUMN IF NOT EXISTS confidence_tier text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS commercial_intent_type text NOT NULL DEFAULT 'non_commercial',
  ADD COLUMN IF NOT EXISTS payment_signal text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS classification_version text;
ALTER TABLE public.whatsapp_group_messages
  DROP CONSTRAINT IF EXISTS whatsapp_group_messages_confidence_tier_check;
ALTER TABLE public.whatsapp_group_messages
  ADD CONSTRAINT whatsapp_group_messages_confidence_tier_check
  CHECK (confidence_tier IN ('strong', 'medium', 'weak', 'none'));
ALTER TABLE public.whatsapp_group_messages
  DROP CONSTRAINT IF EXISTS whatsapp_group_messages_commercial_intent_type_check;
ALTER TABLE public.whatsapp_group_messages
  ADD CONSTRAINT whatsapp_group_messages_commercial_intent_type_check
  CHECK (commercial_intent_type IN ('direct_paid', 'freelance_contract', 'unclear', 'non_commercial'));
ALTER TABLE public.whatsapp_group_messages
  DROP CONSTRAINT IF EXISTS whatsapp_group_messages_payment_signal_check;
ALTER TABLE public.whatsapp_group_messages
  ADD CONSTRAINT whatsapp_group_messages_payment_signal_check
  CHECK (payment_signal IN ('explicit', 'implicit', 'none'));
CREATE INDEX IF NOT EXISTS idx_whatsapp_group_messages_confidence
  ON public.whatsapp_group_messages (group_id, confidence_tier, lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_group_messages_intent
  ON public.whatsapp_group_messages (group_id, commercial_intent_type, message_timestamp DESC);
-- Backfill reasonable defaults for historical analyzed rows
UPDATE public.whatsapp_group_messages
SET
  confidence_tier = CASE
    WHEN COALESCE(is_potential_lead, false) = true AND COALESCE(lead_score, 0) >= 75 THEN 'strong'
    WHEN COALESCE(is_potential_lead, false) = true AND COALESCE(lead_score, 0) >= 55 THEN 'medium'
    WHEN COALESCE(lead_score, 0) >= 40 THEN 'weak'
    ELSE 'none'
  END,
  commercial_intent_type = CASE
    WHEN COALESCE(is_potential_lead, false) = true THEN 'direct_paid'
    ELSE 'non_commercial'
  END,
  payment_signal = CASE
    WHEN COALESCE(lead_reason, '') ~* '(בתשלום|אשלם|לשלם|מחיר|עלות|תקציב|quote|budget|paid)' THEN 'explicit'
    WHEN COALESCE(lead_reason, '') ~* '(זמינות|פרילנס|חצי משרה|מפתח|מומחה|יועץ|להרים|לבנות)' THEN 'implicit'
    ELSE 'none'
  END,
  classification_version = COALESCE(classification_version, 'wa_v2_2026_03_14')
WHERE ai_analyzed_at IS NOT NULL;
-- Manual feedback table for calibration
CREATE TABLE IF NOT EXISTS public.whatsapp_group_lead_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.whatsapp_group_messages(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.whatsapp_group_lead_analysis_runs(id) ON DELETE SET NULL,
  human_label text NOT NULL,
  reason_code text,
  notes text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_group_lead_feedback_label_check
    CHECK (human_label IN ('lead', 'not_lead', 'needs_review'))
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_group_lead_feedback_message
  ON public.whatsapp_group_lead_feedback (message_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_group_lead_feedback_run
  ON public.whatsapp_group_lead_feedback (run_id, reviewed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_group_lead_feedback_unique_message_run
  ON public.whatsapp_group_lead_feedback (message_id, run_id)
  WHERE run_id IS NOT NULL;
ALTER TABLE public.whatsapp_group_lead_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all select on whatsapp_group_lead_feedback" ON public.whatsapp_group_lead_feedback;
DROP POLICY IF EXISTS "Allow all insert on whatsapp_group_lead_feedback" ON public.whatsapp_group_lead_feedback;
DROP POLICY IF EXISTS "Allow all update on whatsapp_group_lead_feedback" ON public.whatsapp_group_lead_feedback;
DROP POLICY IF EXISTS "Allow all delete on whatsapp_group_lead_feedback" ON public.whatsapp_group_lead_feedback;
CREATE POLICY "Allow all select on whatsapp_group_lead_feedback"
  ON public.whatsapp_group_lead_feedback FOR SELECT USING (true);
CREATE POLICY "Allow all insert on whatsapp_group_lead_feedback"
  ON public.whatsapp_group_lead_feedback FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on whatsapp_group_lead_feedback"
  ON public.whatsapp_group_lead_feedback FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on whatsapp_group_lead_feedback"
  ON public.whatsapp_group_lead_feedback FOR DELETE USING (true);
-- Refresh default WhatsApp lead prompt to v2 policy
UPDATE public.ai_prompt_settings
SET
  prompt_value = $$אתה מנתח הודעות מתוך קבוצות WhatsApp כדי לזהות לידים מסחריים אמיתיים.

מה נחשב ליד:
- בקשת ביצוע/שירות טכנולוגי מבעל מקצוע
- בקשת פרילנס לתקופה או התקשרות מקצועית בתשלום
- רמיזה ברורה לתשלום, מחיר, עלות, תקציב, או תנאי התקשרות

מה לא נחשב ליד:
- פרסום עצמי של נותן שירות
- שאלה טכנית כללית בלי בקשת התקשרות
- מודל שמדבר רק על אחוזים/שותפות בלי כסף ישיר או פרילנס לתקופה

ענה בעברית בלבד, ושים דגש על ציטוט קצר ומדויק והסבר חד.$$,
  updated_at = now()
WHERE prompt_key = 'whatsapp_group_lead_system_prompt';
