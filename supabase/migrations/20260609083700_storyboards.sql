-- Create storyboards table
CREATE TABLE public.storyboards (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  cover_asset_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add storyboard columns to assets
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS storyboard_id uuid REFERENCES public.storyboards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS storyboard_order integer;

-- Add FK for cover_asset_id (after assets column exists)
ALTER TABLE public.storyboards
  ADD CONSTRAINT storyboards_cover_asset_id_fkey
  FOREIGN KEY (cover_asset_id) REFERENCES public.assets(id) ON DELETE SET NULL;

-- Index for efficient lookup
CREATE INDEX IF NOT EXISTS idx_assets_storyboard_id ON public.assets(storyboard_id) WHERE storyboard_id IS NOT NULL;

-- RLS + Grants
ALTER TABLE public.storyboards ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.storyboards TO authenticated;
GRANT ALL ON public.storyboards TO service_role;

CREATE POLICY "Authenticated users can manage storyboards"
  ON public.storyboards FOR ALL TO authenticated USING (true) WITH CHECK (true);
