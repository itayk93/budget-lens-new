-- Use the configured push timezone (instead of hard-coded Asia/Jerusalem) for new-client push quiet hours.

create or replace function public._maybe_send_new_client_push()
returns void
language plpgsql
security definer
set search_path = public, cron, extensions, net
as $$
declare
    tz text;
    now_local timestamp;
    request_id bigint;
begin
    select nullif(btrim(daily_push_timezone), '')
      into tz
      from public.push_system_config
     where id = 1;

    tz := coalesce(tz, 'Asia/Jerusalem');

    begin
        now_local := timezone(tz, now());
    exception
        when invalid_parameter_value then
            tz := 'Asia/Jerusalem';
            now_local := timezone(tz, now());
    end;

    -- Skip night hours (22:00-07:59 local time)
    if extract(hour from now_local)::int < 8 or extract(hour from now_local)::int >= 22 then
        return;
    end if;

    request_id := net.http_post(
        url := 'https://btaxsfkwhsjaqdkyvcnq.functions.supabase.co/new-client-push',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
    );

    perform request_id;
end;
$$;
