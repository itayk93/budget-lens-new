-- Ensure new-client push cron remains active at 3-minute cadence.

select public.schedule_new_client_push();
