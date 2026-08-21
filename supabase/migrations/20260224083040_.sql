
-- Add title column to assets table for image captions
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS title text DEFAULT '';

-- Update RLS policies for campaigns to allow all authenticated users to insert/update/delete
-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Admins can insert campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Admins can update campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Admins can delete campaigns" ON public.campaigns;

-- Create new policies allowing all authenticated users
CREATE POLICY "Authenticated can insert campaigns"
ON public.campaigns FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can update campaigns"
ON public.campaigns FOR UPDATE
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can delete campaigns"
ON public.campaigns FOR DELETE
USING (auth.uid() IS NOT NULL);

-- Also allow all authenticated users to manage campaign_channels and campaign_members
DROP POLICY IF EXISTS "Admins manage campaign channels" ON public.campaign_channels;
DROP POLICY IF EXISTS "Admins delete campaign channels" ON public.campaign_channels;
DROP POLICY IF EXISTS "Admins manage campaign members" ON public.campaign_members;
DROP POLICY IF EXISTS "Admins delete campaign members" ON public.campaign_members;

CREATE POLICY "Authenticated manage campaign channels"
ON public.campaign_channels FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated delete campaign channels"
ON public.campaign_channels FOR DELETE
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated manage campaign members"
ON public.campaign_members FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated delete campaign members"
ON public.campaign_members FOR DELETE
USING (auth.uid() IS NOT NULL);
;
