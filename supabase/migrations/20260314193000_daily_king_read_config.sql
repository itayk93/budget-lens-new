-- Allow clients to read daily push schedule via a safe RPC

create or replace function public.get_daily_king_push_config()
returns table(
    daily_push_enabled boolean,
    daily_push_hour integer,
    daily_push_minute integer,
    daily_push_timezone text
)
language plpgsql
security definer
set search_path = public
as $$
declare
    cfg record;
begin
    select daily_push_enabled,
           daily_push_hour,
           daily_push_minute,
           daily_push_timezone
      into cfg
      from public.push_system_config
     where id = 1;

    if found then
        return query
        select coalesce(cfg.daily_push_enabled, true),
               coalesce(cfg.daily_push_hour, 10),
               coalesce(cfg.daily_push_minute, 0),
               coalesce(cfg.daily_push_timezone, 'Asia/Jerusalem');
    else
        return query select true, 10, 0, 'Asia/Jerusalem';
    end if;
end;
$$;
grant execute on function public.get_daily_king_push_config() to anon, authenticated, service_role;
