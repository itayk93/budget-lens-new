-- Add revenue delta tracking for daily king push

alter table if exists public.push_system_config
    add column if not exists daily_push_last_revenue numeric,
    add column if not exists daily_push_last_client_count integer;
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

    if extract(hour from now_local)::int != coalesce(cfg.daily_push_hour, 0) then
        return;
    end if;

    if extract(minute from now_local)::int != coalesce(cfg.daily_push_minute, 0) then
        return;
    end if;

    if cfg.daily_push_last_sent_at is not null then
        if date(timezone(tz, cfg.daily_push_last_sent_at)) = date(now_local) then
            return;
        end if;
    end if;

    request_id := net.http_post(
        url := 'https://btaxsfkwhsjaqdkyvcnq.functions.supabase.co/daily-king-push',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
    );

    -- request_id is returned for traceability; response is handled asynchronously
    perform request_id;
end;
$$;
