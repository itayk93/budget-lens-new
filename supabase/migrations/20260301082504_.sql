
-- Create permission_settings table
CREATE TABLE public.permission_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permission_key text UNIQUE NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: everyone reads, only admin writes
ALTER TABLE public.permission_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read permissions"
  ON public.permission_settings FOR SELECT
  USING (true);

CREATE POLICY "Admins can update permissions"
  ON public.permission_settings FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert permissions"
  ON public.permission_settings FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete permissions"
  ON public.permission_settings FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- Seed default permission values
INSERT INTO public.permission_settings (permission_key, enabled) VALUES
  ('view_campaigns', true),
  ('create_campaigns', true),
  ('delete_campaigns', false),
  ('upload_assets', true),
  ('delete_assets', false),
  ('view_encyclopedia', true),
  ('download_assets', true),
  ('share_assets', true),
  ('export_pdf', true),
  ('view_search', true),
  ('edit_campaigns', true);
;
