-- GPT lead-analysis logs for WhatsApp group messages

CREATE TABLE public.whatsapp_group_lead_analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.whatsapp_chat_groups(id) ON DELETE CASCADE,
  analysis_mode text NOT NULL DEFAULT 'new_only',
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  analyzed_count integer NOT NULL DEFAULT 0,
  leads_count integer NOT NULL DEFAULT 0,
  suspicious_count integer NOT NULL DEFAULT 0,
  deeply_analyzed_count integer NOT NULL DEFAULT 0,
  total_fetched integer NOT NULL DEFAULT 0,
  screened_successfully integer NOT NULL DEFAULT 0,
  remaining_unanalyzed integer NOT NULL DEFAULT 0,
  failed_screening_chunks integer NOT NULL DEFAULT 0,
  failed_deep_chunks integer NOT NULL DEFAULT 0,
  failed_screening_messages integer NOT NULL DEFAULT 0,
  failed_deep_messages integer NOT NULL DEFAULT 0,
  update_errors integer NOT NULL DEFAULT 0,
  last_screening_error text,
  last_deep_error text,
  error_message text,
  system_prompt text,
  request_payload jsonb,
  response_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_group_lead_analysis_runs_mode_check
    CHECK (analysis_mode IN ('new_only', 'full_scan')),
  CONSTRAINT whatsapp_group_lead_analysis_runs_status_check
    CHECK (status IN ('running', 'completed', 'failed'))
);
CREATE INDEX idx_wa_lead_runs_group_started
  ON public.whatsapp_group_lead_analysis_runs (group_id, started_at DESC);
CREATE TABLE public.whatsapp_group_lead_analysis_chunk_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.whatsapp_group_lead_analysis_runs(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.whatsapp_chat_groups(id) ON DELETE CASCADE,
  stage text NOT NULL,
  chunk_index integer NOT NULL,
  model_used text,
  success boolean NOT NULL DEFAULT false,
  http_status integer,
  error_text text,
  request_payload jsonb,
  response_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_group_lead_analysis_chunk_logs_stage_check
    CHECK (stage IN ('screening', 'deep'))
);
CREATE INDEX idx_wa_lead_chunk_logs_run
  ON public.whatsapp_group_lead_analysis_chunk_logs (run_id, created_at DESC);
ALTER TABLE public.whatsapp_group_lead_analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_group_lead_analysis_chunk_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all select on whatsapp_group_lead_analysis_runs"
  ON public.whatsapp_group_lead_analysis_runs FOR SELECT USING (true);
CREATE POLICY "Allow all insert on whatsapp_group_lead_analysis_runs"
  ON public.whatsapp_group_lead_analysis_runs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on whatsapp_group_lead_analysis_runs"
  ON public.whatsapp_group_lead_analysis_runs FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on whatsapp_group_lead_analysis_runs"
  ON public.whatsapp_group_lead_analysis_runs FOR DELETE USING (true);
CREATE POLICY "Allow all select on whatsapp_group_lead_analysis_chunk_logs"
  ON public.whatsapp_group_lead_analysis_chunk_logs FOR SELECT USING (true);
CREATE POLICY "Allow all insert on whatsapp_group_lead_analysis_chunk_logs"
  ON public.whatsapp_group_lead_analysis_chunk_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on whatsapp_group_lead_analysis_chunk_logs"
  ON public.whatsapp_group_lead_analysis_chunk_logs FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on whatsapp_group_lead_analysis_chunk_logs"
  ON public.whatsapp_group_lead_analysis_chunk_logs FOR DELETE USING (true);
