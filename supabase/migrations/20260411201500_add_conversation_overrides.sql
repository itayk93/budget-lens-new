-- Per-conversation overrides (e.g. mark as "unanswered" even if AI inferred escalation)

CREATE TABLE IF NOT EXISTS public.conversation_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  source TEXT NOT NULL CHECK (source IN ('fb', 'wa', 'wa_web')),
  conversation_id TEXT NOT NULL,
  is_unanswered BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_overrides_source_conversation_id_uidx
ON public.conversation_overrides (source, conversation_id);
CREATE INDEX IF NOT EXISTS conversation_overrides_conversation_id_idx
ON public.conversation_overrides (conversation_id);
-- updated_at trigger
DROP TRIGGER IF EXISTS set_conversation_overrides_updated_at ON public.conversation_overrides;
CREATE TRIGGER set_conversation_overrides_updated_at
BEFORE UPDATE ON public.conversation_overrides
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
-- tenant_id auto-fill
DROP TRIGGER IF EXISTS set_conversation_overrides_tenant_id ON public.conversation_overrides;
CREATE TRIGGER set_conversation_overrides_tenant_id
BEFORE INSERT ON public.conversation_overrides
FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_auth();
-- RLS
ALTER TABLE public.conversation_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for conversation_overrides" ON public.conversation_overrides;
CREATE POLICY "Tenant isolation for conversation_overrides"
ON public.conversation_overrides
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
