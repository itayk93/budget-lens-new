-- Add new client push alert state + cron scheduler

create table if not exists public.push_client_alerts_state (
    id integer primary key default 1,
    last_seen_client_ids jsonb not null default '[]'::jsonb,
    last_checked_at timestamptz,
    last_notified_at timestamptz,
    last_notified_client_id text,
    last_notified_client_name text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create or replace function public._unschedule_new_client_push()
returns void
language plpgsql
security definer
set search_path = public, cron, extensions
as $$
begin
    begin
        perform unschedule('new_client_push');
    exception when undefined_function then
        null;
    when others then
        null;
    end;
end;
$$;
create or replace function public._maybe_send_new_client_push()
returns void
language plpgsql
security definer
set search_path = public, cron, extensions, net
as $$
declare
    tz text := 'Asia/Jerusalem';
    now_local timestamp;
    request_id bigint;
begin
    now_local := timezone(tz, now());

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
create or replace function public.schedule_new_client_push()
returns void
language plpgsql
security definer
set search_path = public, cron, extensions
as $$
begin
    perform public._unschedule_new_client_push();
    begin
        perform schedule('new_client_push', '* * * * *', 'select public._maybe_send_new_client_push();');
    exception when undefined_function then
        null;
    end;
end;
$$;
select public.schedule_new_client_push();
grant execute on function public._unschedule_new_client_push() to anon, authenticated, service_role;
grant execute on function public._maybe_send_new_client_push() to anon, authenticated, service_role;
grant execute on function public.schedule_new_client_push() to anon, authenticated, service_role;
