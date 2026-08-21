-- Create AI rate limits table to track API usage by IP Address
CREATE TABLE IF NOT EXISTS public.ai_rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_address TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1,
    window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
-- Index for fast lookup by IP and endpoint
CREATE INDEX IF NOT EXISTS ai_rate_limits_ip_endpoint_idx ON public.ai_rate_limits (ip_address, endpoint);
-- Function to clean up old rate limits (older than 1 hour)
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.ai_rate_limits
  WHERE window_start < now() - interval '1 hour';
END;
$$;
-- RLS bypass for Edge Functions (or just enable RLS with no policies as functions run as service_role)
ALTER TABLE public.ai_rate_limits ENABLE ROW LEVEL SECURITY;
