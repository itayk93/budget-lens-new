-- Keep the database active with one small, auditable daily write.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.database_keepalive_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  executed_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE private.database_keepalive_log IS
  'One row per scheduled database keep-alive execution.';
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON TABLE private.database_keepalive_log FROM anon, authenticated;
ALTER TABLE private.database_keepalive_log ENABLE ROW LEVEL SECURITY;
DO $do$
DECLARE
  existing_job_id bigint;
BEGIN
  FOR existing_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'database-keepalive-daily'
  LOOP
    PERFORM cron.unschedule(existing_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'database-keepalive-daily',
    '0 3 * * *',
    $command$
      INSERT INTO private.database_keepalive_log DEFAULT VALUES;
    $command$
  );
END
$do$;
