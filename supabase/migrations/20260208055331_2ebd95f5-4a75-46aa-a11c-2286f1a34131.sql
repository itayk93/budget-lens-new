-- Add English name column
ALTER TABLE public.conversation_analyses ADD COLUMN IF NOT EXISTS full_name_english TEXT;
-- Add chat_link column if missing
ALTER TABLE public.conversation_analyses ADD COLUMN IF NOT EXISTS chat_link TEXT;
