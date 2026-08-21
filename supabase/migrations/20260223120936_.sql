
-- Create app_role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles table (separate from profiles per security best practice)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'user',
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Campaigns table
CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  start_date DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'completed')),
  created_by UUID REFERENCES auth.users(id),
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- Campaign members table
CREATE TABLE public.campaign_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(campaign_id, user_id)
);
ALTER TABLE public.campaign_members ENABLE ROW LEVEL SECURITY;

-- Campaign channels junction table
CREATE TABLE public.campaign_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL,
  UNIQUE(campaign_id, channel_id)
);
ALTER TABLE public.campaign_channels ENABLE ROW LEVEL SECURITY;

-- Media channels table
CREATE TABLE public.media_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.media_channels ENABLE ROW LEVEL SECURITY;

-- Add FK to campaign_channels after media_channels exists
ALTER TABLE public.campaign_channels
  ADD CONSTRAINT campaign_channels_channel_id_fkey
  FOREIGN KEY (channel_id) REFERENCES public.media_channels(id) ON DELETE CASCADE;

-- Channel sizes table
CREATE TABLE public.channel_sizes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES public.media_channels(id) ON DELETE CASCADE,
  width INT NOT NULL,
  height INT NOT NULL,
  description TEXT DEFAULT '',
  allowed_extensions TEXT[] DEFAULT ARRAY['jpg','jpeg','png','gif','mp4','webp','svg','pdf']
);
ALTER TABLE public.channel_sizes ENABLE ROW LEVEL SECURITY;

-- Assets table
CREATE TABLE public.assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES public.media_channels(id),
  file_name TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_hash TEXT,
  file_type TEXT NOT NULL,
  width INT,
  height INT,
  file_size BIGINT,
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

-- Audit logs table
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- System settings table for admin-configurable limits
CREATE TABLE public.system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Insert default system settings
INSERT INTO public.system_settings (key, value) VALUES
  ('max_file_size_mb', '50'),
  ('max_files_per_upload', '20'),
  ('allowed_file_types', '["jpg","jpeg","png","gif","mp4","webp","svg","pdf"]'),
  ('max_assets_per_campaign', '500');

-- ============ RLS POLICIES ============

-- Profiles: everyone can read, users can update own
CREATE POLICY "Anyone authenticated can view profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- User roles: admins can manage, users can read own
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert roles" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update roles" ON public.user_roles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete roles" ON public.user_roles FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Campaigns: admin sees all, users see public or member campaigns
CREATE POLICY "View campaigns" ON public.campaigns FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR is_public = true
    OR EXISTS (SELECT 1 FROM public.campaign_members WHERE campaign_id = id AND user_id = auth.uid())
  );
-- Public can view public campaigns (for share links)
CREATE POLICY "Public view campaigns" ON public.campaigns FOR SELECT TO anon USING (is_public = true);
CREATE POLICY "Admins can insert campaigns" ON public.campaigns FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update campaigns" ON public.campaigns FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete campaigns" ON public.campaigns FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Campaign members
CREATE POLICY "View campaign members" ON public.campaign_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage campaign members" ON public.campaign_members FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete campaign members" ON public.campaign_members FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Campaign channels
CREATE POLICY "View campaign channels" ON public.campaign_channels FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anon view campaign channels" ON public.campaign_channels FOR SELECT TO anon USING (true);
CREATE POLICY "Admins manage campaign channels" ON public.campaign_channels FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete campaign channels" ON public.campaign_channels FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Media channels: everyone can read
CREATE POLICY "Anyone can view channels" ON public.media_channels FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anon can view channels" ON public.media_channels FOR SELECT TO anon USING (true);
CREATE POLICY "Admins manage channels" ON public.media_channels FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update channels" ON public.media_channels FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete channels" ON public.media_channels FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Channel sizes: everyone can read
CREATE POLICY "Anyone can view channel sizes" ON public.channel_sizes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anon can view channel sizes" ON public.channel_sizes FOR SELECT TO anon USING (true);
CREATE POLICY "Admins manage channel sizes" ON public.channel_sizes FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update channel sizes" ON public.channel_sizes FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete channel sizes" ON public.channel_sizes FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Assets: same as campaigns logic
CREATE POLICY "View assets" ON public.assets FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id
      AND (c.is_public = true OR EXISTS (SELECT 1 FROM public.campaign_members cm WHERE cm.campaign_id = c.id AND cm.user_id = auth.uid()))
    )
  );
CREATE POLICY "Public view assets" ON public.assets FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = campaign_id AND c.is_public = true));
CREATE POLICY "Authenticated can upload assets" ON public.assets FOR INSERT TO authenticated WITH CHECK (uploaded_by = auth.uid());
CREATE POLICY "Admins can delete assets" ON public.assets FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR uploaded_by = auth.uid());
CREATE POLICY "Admins can update assets" ON public.assets FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR uploaded_by = auth.uid());

-- Audit logs: admins can read, authenticated can insert
CREATE POLICY "Admins can view audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can insert audit logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- System settings: admins manage, all authenticated read
CREATE POLICY "Anyone can read settings" ON public.system_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can update settings" ON public.system_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ TRIGGER: Auto-create profile on signup ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  
  -- First user becomes admin
  IF (SELECT COUNT(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ SEED: Media channels ============
INSERT INTO public.media_channels (id, name, description) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'Facebook', 'פייסבוק'),
  ('a2222222-2222-2222-2222-222222222222', 'Instagram', 'אינסטגרם'),
  ('a3333333-3333-3333-3333-333333333333', 'Google Ads', 'גוגל אדס'),
  ('a4444444-4444-4444-4444-444444444444', 'YouTube', 'יוטיוב'),
  ('a5555555-5555-5555-5555-555555555555', 'Display', 'באנרים'),
  ('a6666666-6666-6666-6666-666666666666', 'Email', 'דיוור'),
  ('a7777777-7777-7777-7777-777777777777', 'Website', 'אתר'),
  ('a8888888-8888-8888-8888-888888888888', 'Print', 'דפוס');

-- Seed channel sizes
INSERT INTO public.channel_sizes (channel_id, width, height, description) VALUES
  ('a1111111-1111-1111-1111-111111111111', 1200, 630, 'Facebook Post'),
  ('a1111111-1111-1111-1111-111111111111', 1080, 1080, 'Facebook Square'),
  ('a1111111-1111-1111-1111-111111111111', 1200, 628, 'Facebook Ad'),
  ('a2222222-2222-2222-2222-222222222222', 1080, 1080, 'Instagram Post'),
  ('a2222222-2222-2222-2222-222222222222', 1080, 1920, 'Instagram Story'),
  ('a2222222-2222-2222-2222-222222222222', 1080, 1350, 'Instagram Portrait'),
  ('a3333333-3333-3333-3333-333333333333', 300, 250, 'Medium Rectangle'),
  ('a3333333-3333-3333-3333-333333333333', 728, 90, 'Leaderboard'),
  ('a3333333-3333-3333-3333-333333333333', 160, 600, 'Wide Skyscraper'),
  ('a4444444-4444-4444-4444-444444444444', 1920, 1080, 'YouTube Cover'),
  ('a4444444-4444-4444-4444-444444444444', 1280, 720, 'YouTube Thumbnail'),
  ('a5555555-5555-5555-5555-555555555555', 970, 250, 'Billboard'),
  ('a5555555-5555-5555-5555-555555555555', 300, 600, 'Half Page'),
  ('a6666666-6666-6666-6666-666666666666', 600, 200, 'Email Header'),
  ('a6666666-6666-6666-6666-666666666666', 600, 600, 'Email Banner'),
  ('a7777777-7777-7777-7777-777777777777', 1920, 600, 'Website Hero'),
  ('a7777777-7777-7777-7777-777777777777', 800, 600, 'Website Banner'),
  ('a8888888-8888-8888-8888-888888888888', 2480, 3508, 'A4 Portrait'),
  ('a8888888-8888-8888-8888-888888888888', 3508, 2480, 'A4 Landscape');

-- ============ STORAGE ============
INSERT INTO storage.buckets (id, name, public) VALUES ('campaign-assets', 'campaign-assets', true);

CREATE POLICY "Anyone can view campaign assets" ON storage.objects FOR SELECT USING (bucket_id = 'campaign-assets');
CREATE POLICY "Authenticated can upload campaign assets" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'campaign-assets');
CREATE POLICY "Users can delete own campaign assets" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'campaign-assets');
;
