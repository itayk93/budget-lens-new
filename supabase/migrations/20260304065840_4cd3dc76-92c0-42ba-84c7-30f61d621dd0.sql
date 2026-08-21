-- Coaching scorecard results for call transcripts
CREATE TABLE public.coaching_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id uuid NOT NULL REFERENCES public.call_transcripts(id) ON DELETE CASCADE,
  overall_score integer NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  open_questions_score integer NOT NULL CHECK (open_questions_score BETWEEN 0 AND 100),
  value_proposition_score integer NOT NULL CHECK (value_proposition_score BETWEEN 0 AND 100),
  objection_handling_score integer NOT NULL CHECK (objection_handling_score BETWEEN 0 AND 100),
  follow_up_score integer NOT NULL CHECK (follow_up_score BETWEEN 0 AND 100),
  active_listening_score integer NOT NULL CHECK (active_listening_score BETWEEN 0 AND 100),
  closing_score integer NOT NULL CHECK (closing_score BETWEEN 0 AND 100),
  strengths text[] NOT NULL DEFAULT '{}',
  improvements text[] NOT NULL DEFAULT '{}',
  ai_summary text,
  model text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(transcript_id)
);
ALTER TABLE public.coaching_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all select on coaching_scores" ON public.coaching_scores FOR SELECT USING (true);
CREATE POLICY "Allow all insert on coaching_scores" ON public.coaching_scores FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on coaching_scores" ON public.coaching_scores FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on coaching_scores" ON public.coaching_scores FOR DELETE USING (true);
