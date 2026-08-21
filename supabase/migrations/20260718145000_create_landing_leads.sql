-- Leads submitted from itaykarkason.com.
-- The public website never receives database credentials with write privileges.
-- Inserts are performed by the same-origin Vercel Function using service_role.

CREATE TABLE IF NOT EXISTS public.landing_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  phone text NOT NULL CHECK (char_length(phone) BETWEEN 7 AND 40),
  message text CHECK (message IS NULL OR char_length(message) <= 2000),
  source text CHECK (source IS NULL OR char_length(source) <= 500),
  page_url text CHECK (page_url IS NULL OR char_length(page_url) <= 1000),
  referrer text CHECK (referrer IS NULL OR char_length(referrer) <= 1000),
  utm_source text CHECK (utm_source IS NULL OR char_length(utm_source) <= 200),
  utm_medium text CHECK (utm_medium IS NULL OR char_length(utm_medium) <= 200),
  utm_campaign text CHECK (utm_campaign IS NULL OR char_length(utm_campaign) <= 200),
  locale text CHECK (locale IS NULL OR char_length(locale) <= 16),
  ip_hash text CHECK (ip_hash IS NULL OR char_length(ip_hash) = 64),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'closed', 'spam')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS landing_leads_created_at_idx
  ON public.landing_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS landing_leads_status_created_at_idx
  ON public.landing_leads (status, created_at DESC);
CREATE INDEX IF NOT EXISTS landing_leads_ip_hash_created_at_idx
  ON public.landing_leads (ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;
ALTER TABLE public.landing_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.landing_leads FROM anon;
REVOKE ALL ON TABLE public.landing_leads FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.landing_leads TO authenticated;
DROP POLICY IF EXISTS landing_leads_authenticated_manage ON public.landing_leads;
CREATE POLICY landing_leads_authenticated_manage
ON public.landing_leads
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
COMMENT ON TABLE public.landing_leads IS
  'Contact leads submitted through itaykarkason.com; public access is blocked by RLS.';
