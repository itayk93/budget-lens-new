-- Fix daily king push target and URL
-- This migration updates the pg_cron helper to call the correct revenue calculation function
-- and uses the standard Supabase functions URL format.

create or replace function public._maybe_send_daily_king_push()
returns void
language plpgsql
security definer
set search_path = public, cron, extensions, net
as $$
declare
    tz text := 'Asia/Jerusalem';
    now_local timestamp;
    cfg record;
    request_id bigint;
begin
    select daily_push_enabled,
           daily_push_hour,
           daily_push_minute,
           daily_push_last_sent_at
      into cfg
      from public.push_system_config
     where id = 1;

    if not found then
        return;
    end if;

    if coalesce(cfg.daily_push_enabled, true) is not true then
        return;
    end if;

    now_local := timezone(tz, now());

    -- Check if it is the correct hour and minute
    if extract(hour from now_local)::int != coalesce(cfg.daily_push_hour, 10) then
        return;
    end if;

    if extract(minute from now_local)::int != coalesce(cfg.daily_push_minute, 0) then
        return;
    end if;

    -- Check if already sent today
    if cfg.daily_push_last_sent_at is not null then
        if date(timezone(tz, cfg.daily_push_last_sent_at)) = date(now_local) then
            -- Already sent today in the target timezone
            return;
        end if;
    end if;

    -- Trigger the actual revenue push function
    -- We use the standard .supabase.co/functions/v1/ format
    request_id := net.http_post(
        url := 'https://btaxsfkwhsjaqdkyvcnq.supabase.co/functions/v1/daily-king-push',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := '{}'::jsonb,
        timeout_milliseconds := 15000
    );

    -- Update last sent at immediately to avoid double-triggering in the next minute
    update public.push_system_config
       set daily_push_last_sent_at = now(),
           updated_at = now()
     where id = 1;
end;
$$;
-- Re-configure the job to ensure it's pointing to the updated helper
-- This will also handle the fallback for older pg_cron versions by running every minute
do $$
declare
    cfg record;
begin
    select daily_push_hour,
           daily_push_minute,
           daily_push_enabled
      into cfg
      from public.push_system_config
     where id = 1;

    if found then
        perform public.configure_daily_king_push(
            cfg.daily_push_hour,
            cfg.daily_push_minute,
            cfg.daily_push_enabled
        );
    end if;
end;
$$;
