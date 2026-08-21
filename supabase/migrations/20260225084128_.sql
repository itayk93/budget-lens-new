
-- =============================================
-- Tags system: controlled vocabulary + asset tagging
-- =============================================

-- 1. Tags table (controlled vocabulary with archiving)
CREATE TABLE public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Asset-Tags junction table (many-to-many)
CREATE TABLE public.asset_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(asset_id, tag_id)
);

-- 3. Performance indexes
CREATE INDEX idx_asset_tags_asset_id ON public.asset_tags(asset_id);
CREATE INDEX idx_asset_tags_tag_id ON public.asset_tags(tag_id);

-- 4. RLS for tags
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view tags"
  ON public.tags FOR SELECT
  USING (true);

CREATE POLICY "Anon can view tags"
  ON public.tags FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Admins can insert tags"
  ON public.tags FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update tags"
  ON public.tags FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete tags"
  ON public.tags FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 5. RLS for asset_tags
ALTER TABLE public.asset_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view asset_tags"
  ON public.asset_tags FOR SELECT
  USING (true);

CREATE POLICY "Anon can view asset_tags"
  ON public.asset_tags FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Authenticated can insert asset_tags"
  ON public.asset_tags FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can delete asset_tags"
  ON public.asset_tags FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- 6. Slugify function for auto-generating slug from name
CREATE OR REPLACE FUNCTION public.generate_tag_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := lower(regexp_replace(trim(NEW.name), '\s+', '-', 'g'));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_generate_tag_slug
  BEFORE INSERT OR UPDATE ON public.tags
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_tag_slug();

-- 7. Seed minimal tags
INSERT INTO public.tags (name, slug) VALUES
  ('עולם האשראי', 'עולם-האשראי'),
  ('כרטיסי אשראי', 'כרטיסי-אשראי'),
  ('שוק ההון', 'שוק-ההון'),
  ('משכנתה', 'משכנתה'),
  ('ביטוח', 'ביטוח'),
  ('חשבון עו״ש', 'חשבון-עוש'),
  ('הלוואות', 'הלוואות'),
  ('פיקדונות', 'פיקדונות'),
  ('חיסכון', 'חיסכון'),
  ('ארנק דיגיטלי', 'ארנק-דיגיטלי');
;
