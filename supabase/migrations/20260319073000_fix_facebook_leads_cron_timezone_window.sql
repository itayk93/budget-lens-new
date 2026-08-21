-- Run every 10 minutes in UTC and let the Edge Function enforce 07:00-23:59 Asia/Jerusalem.
-- This avoids DST drift when pg_cron has no schedule_in_time_zone support.
DO $do$
BEGIN
  PERFORM set_config('search_path', 'public,cron,extensions,net', true);

  BEGIN
    PERFORM unschedule('run-facebook-leads-10min-7to23');
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  PERFORM schedule(
    'run-facebook-leads-10min-7to23',
    '*/10 * * * *',
    $cmd$
      select
        net.http_post(
          url:= (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
                || '/functions/v1/run-facebook-leads-scraper',
          headers:=jsonb_build_object(
            'Content-type', 'application/json',
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
            'x-cron-source', 'cron'
          ),
          body:='{"source":"cron"}'::jsonb
        ) as request_id;
    $cmd$
  );
END
$do$;
