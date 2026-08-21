ALTER TABLE public.client_escalation_reasons ADD COLUMN IF NOT EXISTS notes text DEFAULT '';
