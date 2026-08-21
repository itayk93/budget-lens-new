-- Create the system audit logs table
CREATE TABLE IF NOT EXISTS public.system_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    tenant_id UUID REFERENCES public.tenants(id)
);
-- Protect it with RLS so regular users cannot read/modify it easily,
-- and it is append-only for admins/services.
ALTER TABLE public.system_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read for tenant admins only" 
ON public.system_audit_logs 
FOR SELECT 
USING (
    tenant_id IN (
        SELECT tenant_id 
        FROM public.tenant_users 
        WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
    )
);
CREATE POLICY "Allow server inserts without RLS block" 
ON public.system_audit_logs 
FOR INSERT 
WITH CHECK (true);
-- Usually, the Service Role will bypass this anyway;
