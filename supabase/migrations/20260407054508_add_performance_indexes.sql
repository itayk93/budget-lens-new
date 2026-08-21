-- Phase 1: High frequency indexes for performance improvements

CREATE INDEX IF NOT EXISTS idx_conversation_full_name ON conversation_analyses(full_name);
CREATE INDEX IF NOT EXISTS idx_whatsapp_thread_id ON whatsapp_analyses(wa_thread_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_wa_thread_id ON whatsapp_web_threads(thread_id);
