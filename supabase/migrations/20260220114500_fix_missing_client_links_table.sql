-- Ensure client_links exists with the current schema used by the app.
-- This migration is intentionally idempotent and safe for partially-migrated projects.

CREATE TABLE IF NOT EXISTS public.client_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_name TEXT NOT NULL,
  fb_conversation_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
  wa_conversation_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
  sheets_deal_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
  sheets_deal_groups JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.client_links
  ADD COLUMN IF NOT EXISTS client_name TEXT,
  ADD COLUMN IF NOT EXISTS fb_conversation_ids TEXT[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS wa_conversation_ids TEXT[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS sheets_deal_ids TEXT[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS sheets_deal_groups JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();
-- Backfill legacy single-conversation columns into array columns when present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_links'
      AND column_name = 'fb_conversation_id'
  ) THEN
    EXECUTE $sql$
      UPDATE public.client_links
      SET fb_conversation_ids = CASE
        WHEN fb_conversation_id IS NULL THEN COALESCE(fb_conversation_ids, '{}'::text[])
        ELSE ARRAY[fb_conversation_id::text]
      END
    $sql$;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_links'
      AND column_name = 'wa_conversation_id'
  ) THEN
    EXECUTE $sql$
      UPDATE public.client_links
      SET wa_conversation_ids = CASE
        WHEN wa_conversation_id IS NULL THEN COALESCE(wa_conversation_ids, '{}'::text[])
        ELSE ARRAY[wa_conversation_id::text]
      END
    $sql$;
  END IF;
END $$;
ALTER TABLE public.client_links
  DROP COLUMN IF EXISTS fb_conversation_id,
  DROP COLUMN IF EXISTS wa_conversation_id;
UPDATE public.client_links
SET client_name = COALESCE(NULLIF(BTRIM(client_name), ''), 'Unknown Client ' || id::text)
WHERE client_name IS NULL OR BTRIM(client_name) = '';
ALTER TABLE public.client_links
  ALTER COLUMN client_name SET NOT NULL,
  ALTER COLUMN fb_conversation_ids SET DEFAULT '{}'::text[],
  ALTER COLUMN wa_conversation_ids SET DEFAULT '{}'::text[],
  ALTER COLUMN sheets_deal_ids SET DEFAULT '{}'::text[],
  ALTER COLUMN sheets_deal_groups SET DEFAULT '[]'::jsonb,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();
UPDATE public.client_links SET fb_conversation_ids = '{}'::text[] WHERE fb_conversation_ids IS NULL;
UPDATE public.client_links SET wa_conversation_ids = '{}'::text[] WHERE wa_conversation_ids IS NULL;
UPDATE public.client_links SET sheets_deal_ids = '{}'::text[] WHERE sheets_deal_ids IS NULL;
UPDATE public.client_links SET sheets_deal_groups = '[]'::jsonb WHERE sheets_deal_groups IS NULL;
UPDATE public.client_links SET created_at = now() WHERE created_at IS NULL;
UPDATE public.client_links SET updated_at = now() WHERE updated_at IS NULL;
ALTER TABLE public.client_links
  ALTER COLUMN fb_conversation_ids SET NOT NULL,
  ALTER COLUMN wa_conversation_ids SET NOT NULL,
  ALTER COLUMN sheets_deal_ids SET NOT NULL,
  ALTER COLUMN sheets_deal_groups SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE public.client_links ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'client_links'
      AND policyname = 'Allow all read access'
  ) THEN
    CREATE POLICY "Allow all read access"
      ON public.client_links
      FOR SELECT
      USING (true);
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'client_links'
      AND policyname = 'Allow all insert access'
  ) THEN
    CREATE POLICY "Allow all insert access"
      ON public.client_links
      FOR INSERT
      WITH CHECK (true);
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'client_links'
      AND policyname = 'Allow all update access'
  ) THEN
    CREATE POLICY "Allow all update access"
      ON public.client_links
      FOR UPDATE
      USING (true);
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'client_links'
      AND policyname = 'Allow all delete access'
  ) THEN
    CREATE POLICY "Allow all delete access"
      ON public.client_links
      FOR DELETE
      USING (true);
  END IF;
END $$;
