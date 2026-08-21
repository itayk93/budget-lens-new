-- Create lead_alert_logs table
CREATE TABLE public.lead_alert_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  leads_count INTEGER NOT NULL DEFAULT 0,
  -- Recipient is supplied by the caller (LEAD_NOTIFICATION_EMAIL secret); no default owner address here.
  email_to TEXT NOT NULL,
  email_subject TEXT,
  email_content TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
-- Enable RLS
ALTER TABLE public.lead_alert_logs ENABLE ROW LEVEL SECURITY;
-- Public read/insert (no auth in this project)
CREATE POLICY "Allow all read access" ON public.lead_alert_logs FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON public.lead_alert_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all delete access" ON public.lead_alert_logs FOR DELETE USING (true);
