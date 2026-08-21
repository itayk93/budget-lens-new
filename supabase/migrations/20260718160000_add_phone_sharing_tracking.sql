ALTER TABLE public.conversation_analyses
  ADD COLUMN IF NOT EXISTS phone_number TEXT,
  ADD COLUMN IF NOT EXISTS phone_shared_by TEXT;
-- Backfill existing Messenger conversations from their preserved message JSON.
WITH extracted AS (
  SELECT
    c.id,
    m.value ->> 'direction' AS direction,
    regexp_replace(
      (regexp_match(
        coalesce(m.value ->> 'text', m.value ->> 'message', m.value ->> 'body', ''),
        '((?:\\+?972[- .]?)?0?5[0-9][- .]?[0-9]{3}[- .]?[0-9]{4}|\\+?[1-9][0-9]{7,14})'
      ))[1],
      '[^0-9+]', '', 'g'
    ) AS phone_number
  FROM public.conversation_analyses c
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(c.conversation_json -> 'messages') = 'array'
      THEN c.conversation_json -> 'messages' ELSE '[]'::jsonb END
  ) AS m(value)
), grouped AS (
  SELECT
    id,
    min(phone_number) FILTER (WHERE phone_number IS NOT NULL) AS phone_number,
    CASE
      WHEN bool_or(phone_number IS NOT NULL AND direction = 'incoming')
       AND bool_or(phone_number IS NOT NULL AND direction = 'outgoing') THEN 'both'
      WHEN bool_or(phone_number IS NOT NULL AND direction = 'incoming') THEN 'client'
      WHEN bool_or(phone_number IS NOT NULL AND direction = 'outgoing') THEN 'me'
      ELSE NULL
    END AS phone_shared_by
  FROM extracted
  GROUP BY id
)
UPDATE public.conversation_analyses c
SET phone_number = g.phone_number,
    phone_shared_by = g.phone_shared_by,
    phone_number_sent = CASE WHEN g.phone_number IS NOT NULL THEN 'Yes' ELSE c.phone_number_sent END
FROM grouped g
WHERE c.id = g.id AND g.phone_number IS NOT NULL;
COMMENT ON COLUMN public.conversation_analyses.phone_shared_by IS 'client, me, or both';
