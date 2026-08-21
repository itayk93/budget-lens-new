-- Fix get_daily_king_push_config ambiguity and make it stable for PostgREST

create or replace function public.get_daily_king_push_config()
returns table(
    daily_push_enabled boolean,
    daily_push_hour integer,
    daily_push_minute integer,
    daily_push_timezone text
)
language sql
security definer
set search_path = public
as $$
    select
        coalesce(psc.daily_push_enabled, true) as daily_push_enabled,
        coalesce(psc.daily_push_hour, 10) as daily_push_hour,
        coalesce(psc.daily_push_minute, 0) as daily_push_minute,
        coalesce(psc.daily_push_timezone, 'Asia/Jerusalem') as daily_push_timezone
    from public.push_system_config psc
    where psc.id = 1
    union all
    select true, 10, 0, 'Asia/Jerusalem'
    where not exists (
        select 1 from public.push_system_config where id = 1
    );
$$;
grant execute on function public.get_daily_king_push_config() to anon, authenticated, service_role;
