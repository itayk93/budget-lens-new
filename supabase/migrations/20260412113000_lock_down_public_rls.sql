-- Lock down permissive anon access introduced in earlier migrations.
-- Keep tenant-isolated/authenticated access paths and service_role writes.

-- Messenger sync + message tables
DROP POLICY IF EXISTS messenger_sync_state_full_access ON public.messenger_sync_state;
DROP POLICY IF EXISTS messenger_sync_runs_full_access ON public.messenger_sync_runs;
DROP POLICY IF EXISTS messenger_threads_full_access ON public.messenger_threads;
DROP POLICY IF EXISTS messenger_messages_full_access ON public.messenger_messages;
CREATE POLICY messenger_sync_state_authenticated_only
ON public.messenger_sync_state
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
CREATE POLICY messenger_sync_runs_authenticated_only
ON public.messenger_sync_runs
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
-- WhatsApp web capture tables
DROP POLICY IF EXISTS whatsapp_web_threads_full_access ON public.whatsapp_web_threads;
DROP POLICY IF EXISTS whatsapp_web_messages_full_access ON public.whatsapp_web_messages;
DROP POLICY IF EXISTS whatsapp_web_media_full_access ON public.whatsapp_web_media;
DROP POLICY IF EXISTS whatsapp_web_sync_runs_full_access ON public.whatsapp_web_sync_runs;
CREATE POLICY whatsapp_web_media_authenticated_only
ON public.whatsapp_web_media
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
CREATE POLICY whatsapp_web_sync_runs_authenticated_only
ON public.whatsapp_web_sync_runs
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
-- Archive and links tables
DROP POLICY IF EXISTS contact_archive_full_access ON public.contact_archive;
CREATE POLICY contact_archive_authenticated_only
ON public.contact_archive
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
DROP POLICY IF EXISTS messenger_thread_conversation_links_full_access ON public.messenger_thread_conversation_links;
CREATE POLICY messenger_thread_conversation_links_authenticated_only
ON public.messenger_thread_conversation_links
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
-- Storage bucket policies (private bucket remains private and requires authentication)
DROP POLICY IF EXISTS whatsapp_web_media_storage_read ON storage.objects;
DROP POLICY IF EXISTS whatsapp_web_media_storage_write ON storage.objects;
CREATE POLICY whatsapp_web_media_storage_read_authenticated
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'whatsapp-web-media');
CREATE POLICY whatsapp_web_media_storage_write_authenticated
ON storage.objects
FOR ALL
TO authenticated
USING (bucket_id = 'whatsapp-web-media')
WITH CHECK (bucket_id = 'whatsapp-web-media');
