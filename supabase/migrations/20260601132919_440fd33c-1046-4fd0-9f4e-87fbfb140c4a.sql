-- Create keepalive table to track daily pings
CREATE TABLE public.keepalive_pings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pinged_at timestamp with time zone NOT NULL DEFAULT now(),
  note text DEFAULT 'daily keepalive'
);

GRANT SELECT, INSERT ON public.keepalive_pings TO authenticated;
GRANT ALL ON public.keepalive_pings TO service_role;

ALTER TABLE public.keepalive_pings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view keepalive_pings"
ON public.keepalive_pings
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Enable pg_cron extension for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule a job to insert a row once per day (08:00 UTC)
SELECT cron.schedule(
  'keepalive-daily-insert',
  '0 8 * * *',
  $$ INSERT INTO public.keepalive_pings (note) VALUES ('cron daily keepalive') $$
);
