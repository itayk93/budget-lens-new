-- Migration to move file-based state to Supabase tables

-- 1. Table for API usage logs (replaces api_usage_log.json)
CREATE TABLE IF NOT EXISTS public.api_usage_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp timestamptz NOT NULL DEFAULT now(),
    method text,
    path text,
    status int,
    duration_ms int,
    ip text,
    user_agent text,
    payload jsonb,
    metadata jsonb
);
ALTER TABLE public.api_usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only access to logs" ON public.api_usage_logs
    FOR ALL TO service_role USING (true) WITH CHECK (true);
-- 2. Table for Zoom analysis results (replaces zoom_analysis.json)
CREATE TABLE IF NOT EXISTS public.zoom_analysis_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    conversation_id text NOT NULL,
    analysis_type text NOT NULL, -- e.g., 'deep', 'whatsapp', 'client'
    results jsonb NOT NULL,
    model text,
    prompt_version text,
    metadata jsonb
);
CREATE INDEX IF NOT EXISTS idx_zoom_analysis_conversation_id ON public.zoom_analysis_results(conversation_id);
ALTER TABLE public.zoom_analysis_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anonymous read access to analysis" ON public.zoom_analysis_results
    FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Service role full access to analysis" ON public.zoom_analysis_results
    FOR ALL TO service_role USING (true) WITH CHECK (true);
