CREATE TABLE public.client_escalation_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text NOT NULL,
  reason_text text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'manual',
  fb_to_wa boolean NOT NULL DEFAULT false,
  had_meeting boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_name)
);
ALTER TABLE public.client_escalation_reasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all select on client_escalation_reasons" ON public.client_escalation_reasons FOR SELECT USING (true);
CREATE POLICY "Allow all insert on client_escalation_reasons" ON public.client_escalation_reasons FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on client_escalation_reasons" ON public.client_escalation_reasons FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on client_escalation_reasons" ON public.client_escalation_reasons FOR DELETE USING (true);
CREATE OR REPLACE FUNCTION public.update_client_escalation_reasons_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER update_client_escalation_reasons_updated_at
  BEFORE UPDATE ON public.client_escalation_reasons
  FOR EACH ROW
  EXECUTE FUNCTION public.update_client_escalation_reasons_updated_at();
