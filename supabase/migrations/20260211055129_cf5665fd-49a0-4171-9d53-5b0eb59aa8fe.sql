-- Drop foreign key constraints
ALTER TABLE public.client_links DROP CONSTRAINT IF EXISTS client_links_fb_conversation_id_fkey;
ALTER TABLE public.client_links DROP CONSTRAINT IF EXISTS client_links_wa_conversation_id_fkey;
-- Add new array columns
ALTER TABLE public.client_links ADD COLUMN fb_conversation_ids text[] DEFAULT '{}';
ALTER TABLE public.client_links ADD COLUMN wa_conversation_ids text[] DEFAULT '{}';
-- Migrate existing data
UPDATE public.client_links 
SET fb_conversation_ids = ARRAY[fb_conversation_id::text]
WHERE fb_conversation_id IS NOT NULL;
UPDATE public.client_links 
SET wa_conversation_ids = ARRAY[wa_conversation_id::text]
WHERE wa_conversation_id IS NOT NULL;
-- Drop old columns
ALTER TABLE public.client_links DROP COLUMN fb_conversation_id;
ALTER TABLE public.client_links DROP COLUMN wa_conversation_id;
