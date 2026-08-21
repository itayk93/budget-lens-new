-- Fix conversation records with wrong dates (before July 2025) by using created_at as approximate date
UPDATE conversation_analyses 
SET first_message_date = created_at,
    last_message_date = created_at
WHERE first_message_date < '2025-07-01';
