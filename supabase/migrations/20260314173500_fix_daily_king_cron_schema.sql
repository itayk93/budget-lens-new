-- Fix daily king scheduling for pg_cron schema differences (cron vs pg_catalog)
create or replace function public._unschedule_daily_king_push()
returns void
language plpgsql
security definer
set search_path = public, cron, extensions
as $$
begin
    begin
        perform unschedule('daily_king_push');
    exception when undefined_function then
        -- pg_cron might not be installed yet
        null;
    when others then
        -- swallow errors (job may not exist or schema not available)
        null;
    end;
end;
$$;
create or replace function public.configure_daily_king_push(p_hour integer, p_minute integer, p_enabled boolean default true)
returns table(jobname text, schedule text, timezone text, enabled boolean)
language plpgsql
security definer
set search_path = public, cron, extensions
as $$
declare
    cron_expr text;
    payload text;
    job_sql text;
    tz text := 'Asia/Jerusalem';
begin
    if p_hour < 0 or p_hour > 23 then
        raise exception 'Invalid hour % (expected 0-23)', p_hour;
    end if;
    if p_minute < 0 or p_minute > 59 then
        raise exception 'Invalid minute % (expected 0-59)', p_minute;
    end if;

    cron_expr := format('%s %s * * *', p_minute, p_hour);

    -- Persist chosen time + state
    insert into public.push_system_config as cfg (
        id, vapid_subject, daily_push_enabled, daily_push_hour, daily_push_minute, daily_push_timezone
    )
    values (
        1,
        coalesce((select vapid_subject from public.push_system_config where id = 1), 'mailto:push@boombark.app'),
        coalesce(p_enabled, true),
        p_hour,
        p_minute,
        tz
    )
    on conflict (id) do update
        set daily_push_enabled = coalesce(excluded.daily_push_enabled, cfg.daily_push_enabled),
            daily_push_hour = excluded.daily_push_hour,
            daily_push_minute = excluded.daily_push_minute,
            daily_push_timezone = excluded.daily_push_timezone,
            updated_at = now();

    perform public._unschedule_daily_king_push();

    if coalesce(p_enabled, true) then
        payload := '{"action":"event","payload":{"title":"בוקר טוב מלך","body":"ההודעה היומית שלך מוכנה","url":"/","tag":"daily-king","requireInteraction":false}}';
        job_sql := format(
            $job$select net.http_post(
                url := 'https://btaxsfkwhsjaqdkyvcnq.functions.supabase.co/push-notifications',
                headers := '{"Content-Type":"application/json"}',
                body := %L,
                timeout_milliseconds := 10000
            );$job$,
            payload
        );

        begin
            perform schedule_in_time_zone('daily_king_push', cron_expr, tz, job_sql);
        exception
            when undefined_function then
                -- Fallback for older pg_cron without timezone support
                perform schedule('daily_king_push', cron_expr, job_sql);
        end;
    end if;

    return query select 'daily_king_push'::text, cron_expr, tz, coalesce(p_enabled, true);
end;
$$;
grant execute on function public._unschedule_daily_king_push() to anon, authenticated, service_role;
grant execute on function public.configure_daily_king_push(integer, integer, boolean) to anon, authenticated, service_role;
