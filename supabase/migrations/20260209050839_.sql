-- Table to store unified client records with links to FB and WA conversations
CREATE TABLE public.client_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_name TEXT NOT NULL,
  fb_conversation_id UUID REFERENCES public.conversation_analyses(id) ON DELETE SET NULL,
  wa_conversation_id UUID REFERENCES public.whatsapp_analyses(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
-- Enable RLS
ALTER TABLE public.client_links ENABLE ROW LEVEL SECURITY;
-- Open policies (same pattern as existing tables)
CREATE POLICY "Allow all read access" ON public.client_links FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON public.client_links FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.client_links FOR UPDATE USING (true);
CREATE POLICY "Allow all delete access" ON public.client_links FOR DELETE USING (true);
