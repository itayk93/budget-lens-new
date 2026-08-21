-- ============================================================================
-- Security hardening migration (audit 2026-06-10)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- H-1: Storage deletes in campaign-assets did NOT check ownership.
-- The previous policy allowed ANY authenticated user to delete ANY file in the
-- bucket. Restrict deletes (and updates) to the file owner or an admin.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can delete own campaign assets" ON storage.objects;

CREATE POLICY "Users can delete own campaign assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'campaign-assets'
    AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  );

DROP POLICY IF EXISTS "Users can update own campaign assets" ON storage.objects;

CREATE POLICY "Users can update own campaign assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'campaign-assets'
    AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  );

-- ----------------------------------------------------------------------------
-- M-1: Restrict campaign management to admins only (product decision 2026-06-10).
-- Migration 20260224083040 had opened create/update/delete to ALL authenticated
-- users; revert to admin-only. SELECT policies (admin / public / member) are
-- unchanged, so viewing access is preserved.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can insert campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Authenticated can update campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Authenticated can delete campaigns" ON public.campaigns;

CREATE POLICY "Admins can insert campaigns"
  ON public.campaigns FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update campaigns"
  ON public.campaigns FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete campaigns"
  ON public.campaigns FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- campaign_channels: revert to admin-only management.
DROP POLICY IF EXISTS "Authenticated manage campaign channels" ON public.campaign_channels;
DROP POLICY IF EXISTS "Authenticated delete campaign channels" ON public.campaign_channels;

CREATE POLICY "Admins manage campaign channels"
  ON public.campaign_channels FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete campaign channels"
  ON public.campaign_channels FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- campaign_members: revert to admin-only management.
DROP POLICY IF EXISTS "Authenticated manage campaign members" ON public.campaign_members;
DROP POLICY IF EXISTS "Authenticated delete campaign members" ON public.campaign_members;

CREATE POLICY "Admins manage campaign members"
  ON public.campaign_members FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete campaign members"
  ON public.campaign_members FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ----------------------------------------------------------------------------
-- M-4: storyboards had a single "FOR ALL ... USING (true)" policy that let any
-- authenticated user create/update/delete any storyboard. Restrict writes to
-- admins (product decision 2026-06-10) while keeping read access for all
-- authenticated users so storyboards remain viewable.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can manage storyboards" ON public.storyboards;

CREATE POLICY "Authenticated can view storyboards"
  ON public.storyboards FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Admins can insert storyboards"
  ON public.storyboards FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update storyboards"
  ON public.storyboards FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete storyboards"
  ON public.storyboards FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
