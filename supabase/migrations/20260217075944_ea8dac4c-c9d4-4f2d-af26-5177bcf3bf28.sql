CREATE TABLE public.client_analyses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  client_name text NOT NULL,
  model text NOT NULL,
  reasoning_effort text,
  result text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.client_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all read access" ON public.client_analyses FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON public.client_analyses FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all delete access" ON public.client_analyses FOR DELETE USING (true);
CREATE INDEX idx_client_analyses_client_id ON public.client_analyses (client_id);
