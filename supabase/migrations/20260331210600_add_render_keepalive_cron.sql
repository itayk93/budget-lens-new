-- Keep Render web service warm by invoking a no-op edge function every 5 minutes.
-- The edge function performs a lightweight GET ping to RENDER_KEEPALIVE_URL.

DO $do$
BEGIN
  PERFORM set_config('search_path', 'public,cron,extensions,net', true);

  BEGIN
    PERFORM unschedule('render-keepalive-5min');
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  PERFORM schedule(
    'render-keepalive-5min',
    '*/5 * * * *',
    $cmd$
      select
        net.http_post(
          url:= (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
                || '/functions/v1/render-keepalive',
          headers:=jsonb_build_object(
            'Content-type', 'application/json',
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
            'x-cron-source', 'cron'
          ),
          body:='{}'::jsonb
        ) as request_id;
    $cmd$
  );
END
$do$;
