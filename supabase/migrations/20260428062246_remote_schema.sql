CREATE UNIQUE INDEX idx_messenger_messages_content_dedupe ON public.messenger_messages USING btree (thread_id, message_timestamp, COALESCE(direction, ''::text), md5(COALESCE(body, ''::text)));
CREATE UNIQUE INDEX idx_whatsapp_web_messages_content_dedupe ON public.whatsapp_web_messages USING btree (thread_id, message_timestamp, COALESCE(direction, ''::text), md5(COALESCE(body, ''::text)));
