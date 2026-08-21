-- Migration to move app settings to Supabase
CREATE TABLE IF NOT EXISTS public.app_config (
    id text PRIMARY KEY DEFAULT 'default', -- We only expect one config set for now
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anonymous read access to config" ON public.app_config
    FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Service role full access to config" ON public.app_config
    FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Seed with current keys if needed (optional, we'll do it via code);
