-- Create junction table for many-to-many assets <-> campaigns
CREATE TABLE public.asset_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(asset_id, campaign_id)
);

-- Enable RLS
ALTER TABLE public.asset_campaigns ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "View asset_campaigns" ON public.asset_campaigns
  FOR SELECT USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = asset_campaigns.campaign_id
        AND (c.is_public = true OR EXISTS (
          SELECT 1 FROM campaign_members cm
          WHERE cm.campaign_id = c.id AND cm.user_id = auth.uid()
        ))
    )
  );

CREATE POLICY "Public view asset_campaigns" ON public.asset_campaigns
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = asset_campaigns.campaign_id AND c.is_public = true
    )
  );

CREATE POLICY "Authenticated can insert asset_campaigns" ON public.asset_campaigns
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can delete asset_campaigns" ON public.asset_campaigns
  FOR DELETE USING (auth.uid() IS NOT NULL);

-- Migrate existing data
INSERT INTO public.asset_campaigns (asset_id, campaign_id)
SELECT id, campaign_id FROM public.assets
WHERE campaign_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Index for performance
CREATE INDEX idx_asset_campaigns_asset_id ON public.asset_campaigns(asset_id);
CREATE INDEX idx_asset_campaigns_campaign_id ON public.asset_campaigns(campaign_id);;
