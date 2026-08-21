-- Add client quotes journal (multiple quote proposals per client)

-- 1) Table
CREATE TABLE IF NOT EXISTS public.client_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id),
    client_id TEXT NOT NULL,
    client_name TEXT NOT NULL,
    source TEXT CHECK (source IN ('fb', 'wa', 'wa_web', 'manual')),
    conversation_id TEXT,
    project_name TEXT,
    quoted_amount NUMERIC NOT NULL,
    discount_amount NUMERIC,
    discount_percent NUMERIC,
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'canceled')),
    quote_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS client_quotes_client_id_idx ON public.client_quotes (client_id);
CREATE INDEX IF NOT EXISTS client_quotes_quote_date_idx ON public.client_quotes (quote_date DESC);
-- 2) updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS set_client_quotes_updated_at ON public.client_quotes;
CREATE TRIGGER set_client_quotes_updated_at
BEFORE UPDATE ON public.client_quotes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
-- 3) tenant_id auto-fill for inserts (so frontend doesn't need to pass it explicitly)
CREATE OR REPLACE FUNCTION public.set_tenant_id_from_auth()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM public.tenant_users
    WHERE user_id = auth.uid()
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS set_client_quotes_tenant_id ON public.client_quotes;
CREATE TRIGGER set_client_quotes_tenant_id
BEFORE INSERT ON public.client_quotes
FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_auth();
-- 4) RLS
ALTER TABLE public.client_quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for client_quotes" ON public.client_quotes;
CREATE POLICY "Tenant isolation for client_quotes"
ON public.client_quotes
FOR ALL
USING (
  tenant_id IN (
    SELECT tenant_id
    FROM public.tenant_users
    WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  tenant_id IN (
    SELECT tenant_id
    FROM public.tenant_users
    WHERE user_id = auth.uid()
  )
);
