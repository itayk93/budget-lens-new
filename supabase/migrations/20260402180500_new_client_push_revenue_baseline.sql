-- Track total revenue baseline for new-client-push so revenue increases trigger notifications.

alter table if exists public.push_client_alerts_state
    add column if not exists last_seen_total_revenue numeric not null default 0;
