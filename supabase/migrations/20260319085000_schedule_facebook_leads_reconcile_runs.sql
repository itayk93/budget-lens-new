-- Reconcile pending Facebook leads runs every minute.
-- This imports results from completed GitHub workflow runs into Supabase and sends push notifications.
DO $do$
BEGIN
  PERFORM set_config('search_path', 'public,cron,extensions,net', true);

  BEGIN
    PERFORM unschedule('facebook-leads-reconcile-runs');
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  PERFORM schedule(
    'facebook-leads-reconcile-runs',
    '* * * * *',
    $cmd$
      select
        net.http_post(
          url:= (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
                || '/functions/v1/facebook-leads-reconcile-runs',
          headers:=jsonb_build_object(
            'Content-type', 'application/json',
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
          ),
          body:='{}'::jsonb
        ) as request_id;
    $cmd$
  );
END
$do$;
