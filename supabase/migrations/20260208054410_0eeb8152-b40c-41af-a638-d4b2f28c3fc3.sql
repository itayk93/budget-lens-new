-- Create table for storing Facebook conversation analysis
CREATE TABLE public.conversation_analyses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Identity
  platform TEXT DEFAULT 'Facebook Messenger',
  full_name TEXT NOT NULL,
  chat_link TEXT,
  
  -- Raw conversation data
  conversation_json JSONB NOT NULL,
  
  -- Timeline
  first_message_date TIMESTAMP WITH TIME ZONE,
  last_message_date TIMESTAMP WITH TIME ZONE,
  conversation_duration TEXT,
  
  -- Volume & Initiative
  messages_sent_by_me INTEGER DEFAULT 0,
  messages_sent_by_them INTEGER DEFAULT 0,
  who_started TEXT,
  follow_ups_without_reply INTEGER DEFAULT 0,
  
  -- Response Times
  my_avg_response_time TEXT,
  their_avg_response_time TEXT,
  who_is_faster TEXT,
  
  -- Depth & Tone
  avg_message_length TEXT,
  questions_count TEXT,
  tone_indicator TEXT,
  emoji_usage TEXT,
  
  -- Contact & Progress
  phone_number_sent TEXT DEFAULT 'No',
  phone_owner TEXT,
  channel_escalation TEXT DEFAULT 'None',
  time_to_escalation TEXT,
  
  -- Business & Sales
  products_discussed TEXT[],
  service_sold TEXT,
  sales_stage TEXT,
  revenue NUMERIC DEFAULT 0,
  deal_status TEXT,
  
  -- Summary
  short_summary TEXT,
  
  -- Custom fields
  had_work_in_end TEXT,
  is_returning_client TEXT DEFAULT 'FALSE',
  whatsapp_name TEXT
);
-- Enable RLS
ALTER TABLE public.conversation_analyses ENABLE ROW LEVEL SECURITY;
-- For now allow all operations (no auth yet)
CREATE POLICY "Allow all read access" ON public.conversation_analyses FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON public.conversation_analyses FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.conversation_analyses FOR UPDATE USING (true);
CREATE POLICY "Allow all delete access" ON public.conversation_analyses FOR DELETE USING (true);
