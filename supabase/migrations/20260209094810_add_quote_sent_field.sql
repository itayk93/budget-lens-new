-- Add quote_sent field to conversation_analyses and whatsapp_analyses tables
ALTER TABLE conversation_analyses
ADD COLUMN IF NOT EXISTS quote_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE whatsapp_analyses
ADD COLUMN IF NOT EXISTS quote_sent BOOLEAN DEFAULT FALSE;
-- Backfill existing data based on content analysis
UPDATE conversation_analyses
SET quote_sent = TRUE
WHERE 
  short_summary IS NOT NULL AND (
    LOWER(short_summary) LIKE '%הצעת מחיר%' OR
    LOWER(short_summary) LIKE '%הצעה%' OR
    (LOWER(short_summary) LIKE '%מחיר%' AND short_summary LIKE '%₪%') OR
    LOWER(short_summary) LIKE '%עלות%' OR
    short_summary ~ '\d+\s*₪' OR
    LOWER(short_summary) LIKE '%quote%' OR
    LOWER(short_summary) LIKE '%price%'
  )
  OR products_discussed IS NOT NULL AND (
    array_to_string(products_discussed, ' ') ILIKE '%הצעת מחיר%' OR
    array_to_string(products_discussed, ' ') ILIKE '%הצעה%' OR
    (array_to_string(products_discussed, ' ') ILIKE '%מחיר%' AND array_to_string(products_discussed, ' ') LIKE '%₪%') OR
    array_to_string(products_discussed, ' ') ILIKE '%עלות%' OR
    array_to_string(products_discussed, ' ') ~ '\d+\s*₪' OR
    array_to_string(products_discussed, ' ') ILIKE '%quote%' OR
    array_to_string(products_discussed, ' ') ILIKE '%price%'
  )
  OR service_sold IS NOT NULL AND (
    LOWER(service_sold) LIKE '%הצעת מחיר%' OR
    LOWER(service_sold) LIKE '%הצעה%' OR
    (LOWER(service_sold) LIKE '%מחיר%' AND service_sold LIKE '%₪%') OR
    LOWER(service_sold) LIKE '%עלות%' OR
    service_sold ~ '\d+\s*₪' OR
    LOWER(service_sold) LIKE '%quote%' OR
    LOWER(service_sold) LIKE '%price%'
  );
UPDATE whatsapp_analyses
SET quote_sent = TRUE
WHERE 
  short_summary IS NOT NULL AND (
    LOWER(short_summary) LIKE '%הצעת מחיר%' OR
    LOWER(short_summary) LIKE '%הצעה%' OR
    (LOWER(short_summary) LIKE '%מחיר%' AND short_summary LIKE '%₪%') OR
    LOWER(short_summary) LIKE '%עלות%' OR
    short_summary ~ '\d+\s*₪' OR
    LOWER(short_summary) LIKE '%quote%' OR
    LOWER(short_summary) LIKE '%price%'
  )
  OR products_discussed IS NOT NULL AND (
    array_to_string(products_discussed, ' ') ILIKE '%הצעת מחיר%' OR
    array_to_string(products_discussed, ' ') ILIKE '%הצעה%' OR
    (array_to_string(products_discussed, ' ') ILIKE '%מחיר%' AND array_to_string(products_discussed, ' ') LIKE '%₪%') OR
    array_to_string(products_discussed, ' ') ILIKE '%עלות%' OR
    array_to_string(products_discussed, ' ') ~ '\d+\s*₪' OR
    array_to_string(products_discussed, ' ') ILIKE '%quote%' OR
    array_to_string(products_discussed, ' ') ILIKE '%price%'
  )
  OR service_sold IS NOT NULL AND (
    LOWER(service_sold) LIKE '%הצעת מחיר%' OR
    LOWER(service_sold) LIKE '%הצעה%' OR
    (LOWER(service_sold) LIKE '%מחיר%' AND service_sold LIKE '%₪%') OR
    LOWER(service_sold) LIKE '%עלות%' OR
    service_sold ~ '\d+\s*₪' OR
    LOWER(service_sold) LIKE '%quote%' OR
    LOWER(service_sold) LIKE '%price%'
  );
