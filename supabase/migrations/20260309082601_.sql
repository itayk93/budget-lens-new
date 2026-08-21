
-- Create sftp_connections table
CREATE TABLE public.sftp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  host text NOT NULL,
  port integer NOT NULL DEFAULT 22,
  username text NOT NULL,
  remote_directory text NOT NULL DEFAULT '/',
  is_active boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create sftp_files table
CREATE TABLE public.sftp_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid REFERENCES public.sftp_connections(id) ON DELETE CASCADE NOT NULL,
  remote_path text NOT NULL,
  file_name text NOT NULL,
  file_size bigint,
  file_type text,
  storage_path text,
  status text NOT NULL DEFAULT 'pending',
  synced_at timestamptz NOT NULL DEFAULT now(),
  imported_at timestamptz,
  imported_to_campaign uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS for sftp_connections
ALTER TABLE public.sftp_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view sftp_connections"
  ON public.sftp_connections FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert sftp_connections"
  ON public.sftp_connections FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update sftp_connections"
  ON public.sftp_connections FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete sftp_connections"
  ON public.sftp_connections FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS for sftp_files
ALTER TABLE public.sftp_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view sftp_files"
  ON public.sftp_files FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert sftp_files"
  ON public.sftp_files FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update sftp_files"
  ON public.sftp_files FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete sftp_files"
  ON public.sftp_files FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Service role policy for edge functions
CREATE POLICY "Service role full access sftp_files"
  ON public.sftp_files FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access sftp_connections"
  ON public.sftp_connections FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create sftp-imports storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('sftp-imports', 'sftp-imports', false);

-- Storage RLS: service role can manage, admins can read
CREATE POLICY "Service role manage sftp-imports"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'sftp-imports')
  WITH CHECK (bucket_id = 'sftp-imports');

CREATE POLICY "Authenticated read sftp-imports"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'sftp-imports');
;
