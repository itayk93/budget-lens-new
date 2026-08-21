-- Expand allowed analysis modes for WhatsApp lead analysis runs

ALTER TABLE public.whatsapp_group_lead_analysis_runs
  DROP CONSTRAINT IF EXISTS whatsapp_group_lead_analysis_runs_mode_check;
ALTER TABLE public.whatsapp_group_lead_analysis_runs
  ADD CONSTRAINT whatsapp_group_lead_analysis_runs_mode_check
  CHECK (analysis_mode IN ('new_only', 'full_scan', 'last_month', 'all_messages'));
