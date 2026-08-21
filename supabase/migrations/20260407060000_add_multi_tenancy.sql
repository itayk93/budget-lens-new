-- Add multi-tenancy support

-- 1. Create tenants table
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 2. Create tenant users mapping
CREATE TABLE IF NOT EXISTS public.tenant_users (
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT CHECK (role IN ('owner', 'admin', 'member')) DEFAULT 'member',
    PRIMARY KEY (tenant_id, user_id)
);
-- 3. Add tenant_id to major tables
DO $$ 
DECLARE
    t TEXT;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name IN (
            'messenger_threads', 
            'messenger_messages', 
            'whatsapp_web_threads', 
            'whatsapp_web_messages', 
            'client_links', 
            'conversation_analyses'
          )
    LOOP
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);', t);
        
        -- Enable RLS
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
        
        -- Create default policy
        EXECUTE format('
            CREATE POLICY "Tenant isolation for %I" 
            ON public.%I 
            FOR ALL 
            USING (
                tenant_id IN (
                    SELECT tenant_id 
                    FROM public.tenant_users 
                    WHERE user_id = auth.uid()
                )
            );
        ', t, t);
    END LOOP;
END $$;
