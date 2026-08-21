-- Add new analysis columns to conversation_analyses
ALTER TABLE public.conversation_analyses
ADD COLUMN IF NOT EXISTS is_technical_support boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS is_future_development boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS quote_amount numeric DEFAULT 0;
-- Add new analysis columns to whatsapp_analyses
ALTER TABLE public.whatsapp_analyses
ADD COLUMN IF NOT EXISTS is_technical_support boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS is_future_development boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS quote_amount numeric DEFAULT 0;
