CREATE TABLE public.deal_risk_scores (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL,
  conversation_source text NOT NULL CHECK (conversation_source IN ('facebook', 'whatsapp')),
  risk_score integer NOT NULL DEFAULT 50,
  risk_level text NOT NULL DEFAULT 'medium',
  risk_factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, conversation_source)
);
ALTER TABLE public.deal_risk_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all select on deal_risk_scores" ON public.deal_risk_scores FOR SELECT USING (true);
CREATE POLICY "Allow all insert on deal_risk_scores" ON public.deal_risk_scores FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on deal_risk_scores" ON public.deal_risk_scores FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on deal_risk_scores" ON public.deal_risk_scores FOR DELETE USING (true);
