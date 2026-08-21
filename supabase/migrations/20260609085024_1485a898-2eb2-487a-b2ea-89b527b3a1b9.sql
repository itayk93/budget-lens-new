CREATE TABLE IF NOT EXISTS public.storyboards (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  cover_asset_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.storyboards TO authenticated;
GRANT ALL ON public.storyboards TO service_role;

ALTER TABLE public.storyboards ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can manage storyboards"
    ON public.storyboards FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS storyboard_id uuid REFERENCES public.storyboards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS storyboard_order integer;

DO $$ BEGIN
  ALTER TABLE public.storyboards
    ADD CONSTRAINT storyboards_cover_asset_id_fkey
    FOREIGN KEY (cover_asset_id) REFERENCES public.assets(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_assets_storyboard_id ON public.assets(storyboard_id) WHERE storyboard_id IS NOT NULL;