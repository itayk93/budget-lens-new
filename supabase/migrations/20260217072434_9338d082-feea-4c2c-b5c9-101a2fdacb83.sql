-- Add full_name (Hebrew name) to whatsapp_analyses
ALTER TABLE public.whatsapp_analyses ADD COLUMN IF NOT EXISTS full_name text;
