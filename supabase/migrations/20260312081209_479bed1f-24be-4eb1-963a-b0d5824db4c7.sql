-- Create push_system_config table
CREATE TABLE IF NOT EXISTS public.push_system_config (
  id integer PRIMARY KEY DEFAULT 1,
  vapid_public_key text NOT NULL DEFAULT '',
  vapid_private_key text NOT NULL DEFAULT '',
  vapid_subject text NOT NULL DEFAULT 'mailto:push@boombark.app',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Create push_subscriptions table
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL UNIQUE,
  subscription jsonb NOT NULL,
  platform text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Enable RLS on both tables
ALTER TABLE public.push_system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
