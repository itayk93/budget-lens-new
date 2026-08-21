-- Ensure daily push scheduling works when pg_cron lacks timezone support

alter table if exists public.push_system_config
    add column if not exists daily_push_last_sent_at timestamptz;
create or replace function public._maybe_send_daily_king_push()
returns void
language plpgsql
security definer
set search_path = public, cron, extensions
as $$
declare
    tz text := 'Asia/Jerusalem';
    now_local timestamp;
    cfg record;
    resp net.http_response;
    payload text := '{"action":"event","payload":{"title":"בוקר טוב מלך","body":"ההודעה היומית שלך מוכנה","url":"/","tag":"daily-king","requireInteraction":false}}';
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

    resp := net.http_post(
        url := 'https://btaxsfkwhsjaqdkyvcnq.functions.supabase.co/push-notifications',
        headers := '{"Content-Type":"application/json"}',
        body := payload,
        timeout_milliseconds := 10000
    );

    if resp.status between 200 and 299 then
        update public.push_system_config
           set daily_push_last_sent_at = now(),
               updated_at = now()
         where id = 1;
    end if;
end;
$$;
create or replace function public.configure_daily_king_push(
    p_hour integer,
    p_minute integer,
    p_enabled boolean default true
)
returns table(jobname text, schedule text, timezone text, enabled boolean)
language plpgsql
security definer
set search_path = public, cron, extensions
as $$
declare
    cron_expr text;
    job_sql text;
    tz text := 'Asia/Jerusalem';
    has_tz boolean := false;
begin
    if p_hour < 0 or p_hour > 23 then
        raise exception 'Invalid hour % (expected 0-23)', p_hour;
    end if;
    if p_minute < 0 or p_minute > 59 then
        raise exception 'Invalid minute % (expected 0-59)', p_minute;
    end if;

    cron_expr := format('%s %s * * *', p_minute, p_hour);
    job_sql := 'select public._maybe_send_daily_king_push();';

    insert into public.push_system_config as cfg (
        id,
        vapid_subject,
        daily_push_enabled,
        daily_push_hour,
        daily_push_minute,
        daily_push_timezone
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
        select exists (
            select 1
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where p.proname = 'schedule_in_time_zone'
              and n.nspname in ('cron', 'pg_catalog')
        ) into has_tz;

        if has_tz then
            perform schedule_in_time_zone('daily_king_push', cron_expr, tz, job_sql);
        else
            -- Fallback: run every minute and self-check local time (handles DST)
            perform schedule('daily_king_push', '* * * * *', job_sql);
        end if;
    end if;

    return query select 'daily_king_push'::text, cron_expr, tz, coalesce(p_enabled, true);
end;
$$;
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
