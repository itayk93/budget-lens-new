ALTER TABLE public.campaigns DROP CONSTRAINT campaigns_status_check;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_status_check CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'completed'::text, 'campaign'::text, 'project'::text, 'journey'::text, 'general'::text, 'other'::text]));;
