-- Add wa_thread_id to whatsapp_analyses for deduplication when re-analyzing
-- a captured WhatsApp Web thread.
ALTER TABLE whatsapp_analyses
  ADD COLUMN IF NOT EXISTS wa_thread_id text;
CREATE INDEX IF NOT EXISTS idx_whatsapp_analyses_wa_thread_id
  ON whatsapp_analyses (wa_thread_id)
  WHERE wa_thread_id IS NOT NULL;
