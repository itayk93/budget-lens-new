-- WhatsApp group chat archive tables

-- 1) Groups
CREATE TABLE public.whatsapp_chat_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_group_id text NOT NULL UNIQUE,
  display_name text,
  source_chat_name text,
  message_count integer NOT NULL DEFAULT 0,
  last_message_timestamp timestamptz,
  last_imported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- 2) Messages
CREATE TABLE public.whatsapp_group_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.whatsapp_chat_groups(id) ON DELETE CASCADE,
  source_file_name text,
  source_line_number integer,
  message_timestamp timestamptz NOT NULL,
  sender_name text,
  message_text text NOT NULL,
  message_type text NOT NULL DEFAULT 'text',
  occurrence_in_chat integer NOT NULL DEFAULT 1,
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_group_messages_message_type_check
    CHECK (message_type IN ('text', 'system', 'media_omitted')),
  CONSTRAINT whatsapp_group_messages_occurrence_positive_check
    CHECK (occurrence_in_chat >= 1),
  CONSTRAINT whatsapp_group_messages_group_dedupe_unique
    UNIQUE (group_id, dedupe_key)
);
CREATE INDEX idx_whatsapp_group_messages_group_timestamp
  ON public.whatsapp_group_messages (group_id, message_timestamp, id);
CREATE INDEX idx_whatsapp_group_messages_group_sender
  ON public.whatsapp_group_messages (group_id, sender_name);
-- 3) Import runs
CREATE TABLE public.whatsapp_group_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.whatsapp_chat_groups(id) ON DELETE CASCADE,
  source_file_name text NOT NULL,
  parsed_messages_count integer NOT NULL DEFAULT 0,
  inserted_messages_count integer NOT NULL DEFAULT 0,
  duplicate_messages_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  error_message text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_group_import_runs_status_check
    CHECK (status IN ('running', 'completed', 'failed'))
);
CREATE INDEX idx_whatsapp_group_import_runs_group_imported_at
  ON public.whatsapp_group_import_runs (group_id, imported_at DESC);
-- RLS
ALTER TABLE public.whatsapp_chat_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_group_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_group_import_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all select on whatsapp_chat_groups"
  ON public.whatsapp_chat_groups FOR SELECT USING (true);
CREATE POLICY "Allow all insert on whatsapp_chat_groups"
  ON public.whatsapp_chat_groups FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on whatsapp_chat_groups"
  ON public.whatsapp_chat_groups FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on whatsapp_chat_groups"
  ON public.whatsapp_chat_groups FOR DELETE USING (true);
CREATE POLICY "Allow all select on whatsapp_group_messages"
  ON public.whatsapp_group_messages FOR SELECT USING (true);
CREATE POLICY "Allow all insert on whatsapp_group_messages"
  ON public.whatsapp_group_messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on whatsapp_group_messages"
  ON public.whatsapp_group_messages FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on whatsapp_group_messages"
  ON public.whatsapp_group_messages FOR DELETE USING (true);
CREATE POLICY "Allow all select on whatsapp_group_import_runs"
  ON public.whatsapp_group_import_runs FOR SELECT USING (true);
CREATE POLICY "Allow all insert on whatsapp_group_import_runs"
  ON public.whatsapp_group_import_runs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on whatsapp_group_import_runs"
  ON public.whatsapp_group_import_runs FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on whatsapp_group_import_runs"
  ON public.whatsapp_group_import_runs FOR DELETE USING (true);
-- Keep updated_at fresh for group rows
CREATE OR REPLACE FUNCTION public.update_whatsapp_chat_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
DROP TRIGGER IF EXISTS update_whatsapp_chat_groups_updated_at ON public.whatsapp_chat_groups;
CREATE TRIGGER update_whatsapp_chat_groups_updated_at
BEFORE UPDATE ON public.whatsapp_chat_groups
FOR EACH ROW
EXECUTE FUNCTION public.update_whatsapp_chat_groups_updated_at();
