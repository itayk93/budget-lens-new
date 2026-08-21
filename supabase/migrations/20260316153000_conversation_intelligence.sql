-- Advanced Conversational Intelligence scores for call transcripts
CREATE TABLE public.intelligence_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id uuid NOT NULL REFERENCES public.call_transcripts(id) ON DELETE CASCADE,
  talk_to_listen_ratio numeric NOT NULL, -- 0 to 1 (share of representative speech)
  rep_words_count integer NOT NULL DEFAULT 0,
  customer_words_count integer NOT NULL DEFAULT 0,
  interruptions_count integer NOT NULL DEFAULT 0,
  interruption_details jsonb NOT NULL DEFAULT '[]', -- List of { timestamp, message_index, snippet }
  competitors_detected text[] NOT NULL DEFAULT '{}',
  competitor_mentions_count integer NOT NULL DEFAULT 0,
  ai_analysis jsonb NOT NULL DEFAULT '{}', -- Full AI output
  model text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(transcript_id)
);
-- Indices for performance
CREATE INDEX idx_intelligence_scores_transcript ON public.intelligence_scores(transcript_id);
-- Enable RLS
ALTER TABLE public.intelligence_scores ENABLE ROW LEVEL SECURITY;
-- Basic RLS Policies (Allow all for now, mirroring coaching_scores)
CREATE POLICY "Allow all select on intelligence_scores" ON public.intelligence_scores FOR SELECT USING (true);
CREATE POLICY "Allow all insert on intelligence_scores" ON public.intelligence_scores FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on intelligence_scores" ON public.intelligence_scores FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on intelligence_scores" ON public.intelligence_scores FOR DELETE USING (true);
-- Updated at trigger
CREATE OR REPLACE FUNCTION public.update_intelligence_scores_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER update_intelligence_scores_updated_at
BEFORE UPDATE ON public.intelligence_scores
FOR EACH ROW
EXECUTE FUNCTION public.update_intelligence_scores_updated_at();
