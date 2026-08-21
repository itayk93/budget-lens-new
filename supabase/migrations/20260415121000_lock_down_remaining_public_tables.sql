-- Lock down remaining public tables that were created without explicit RLS.

-- Internal log/state tables: enable RLS with no client policies.
ALTER TABLE IF EXISTS public.facebook_leads_scraper_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.facebook_leads_scraper_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.push_client_alerts_state ENABLE ROW LEVEL SECURITY;
-- Multi-tenant metadata tables.
ALTER TABLE IF EXISTS public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tenant_users ENABLE ROW LEVEL SECURITY;
-- tenant_users: users can only see their own membership rows.
DROP POLICY IF EXISTS tenant_users_select_own ON public.tenant_users;
CREATE POLICY tenant_users_select_own
ON public.tenant_users
FOR SELECT
TO authenticated
USING (user_id = auth.uid());
-- tenants: users can only see tenants they belong to.
DROP POLICY IF EXISTS tenants_select_member ON public.tenants;
CREATE POLICY tenants_select_member
ON public.tenants
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tenant_users tu
    WHERE tu.tenant_id = tenants.id
      AND tu.user_id = auth.uid()
  )
);
