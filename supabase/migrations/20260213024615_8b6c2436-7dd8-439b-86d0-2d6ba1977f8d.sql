CREATE TABLE public.call_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  client_name text NOT NULL,
  title text,
  transcript text NOT NULL,
  call_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.call_transcripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all read access" ON public.call_transcripts FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON public.call_transcripts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all delete access" ON public.call_transcripts FOR DELETE USING (true);
CREATE POLICY "Allow all update access" ON public.call_transcripts FOR UPDATE USING (true);
CREATE INDEX idx_call_transcripts_client_id ON public.call_transcripts (client_id);
