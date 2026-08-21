ALTER TABLE public.facebook_groups
ADD COLUMN IF NOT EXISTS keyword_filters text[] NOT NULL DEFAULT '{}'::text[];
