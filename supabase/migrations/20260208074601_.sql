-- Create a table for WhatsApp conversation analyses
CREATE TABLE public.whatsapp_analyses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  platform TEXT DEFAULT 'WhatsApp',
  full_name_english TEXT,
  chat_link TEXT,
  first_message_date TIMESTAMP WITH TIME ZONE,
  last_message_date TIMESTAMP WITH TIME ZONE,
  conversation_duration TEXT,
  messages_sent_by_me INTEGER DEFAULT 0,
  messages_sent_by_them INTEGER DEFAULT 0,
  who_started TEXT,
  follow_ups_without_reply INTEGER DEFAULT 0,
  my_avg_response_time TEXT,
  their_avg_response_time TEXT,
  who_is_faster TEXT,
  avg_message_length TEXT,
  questions_count TEXT,
  tone_indicator TEXT,
  emoji_usage TEXT,
  phone_number_sent TEXT DEFAULT 'No',
  phone_owner TEXT,
  channel_escalation TEXT DEFAULT 'None',
  time_to_escalation TEXT,
  products_discussed TEXT[],
  service_sold TEXT,
  sales_stage TEXT,
  revenue NUMERIC DEFAULT 0,
  deal_status TEXT,
  short_summary TEXT,
  conversation_json JSONB NOT NULL,
  had_work_in_end TEXT,
  is_returning_client TEXT DEFAULT 'FALSE',
  facebook_name TEXT,
  receipt_name TEXT,
  is_returning TEXT DEFAULT 'No',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
-- Enable Row Level Security
ALTER TABLE public.whatsapp_analyses ENABLE ROW LEVEL SECURITY;
-- Create permissive policies (matching existing conversation_analyses pattern)
CREATE POLICY "Allow all read access" ON public.whatsapp_analyses FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON public.whatsapp_analyses FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.whatsapp_analyses FOR UPDATE USING (true);
CREATE POLICY "Allow all delete access" ON public.whatsapp_analyses FOR DELETE USING (true);
