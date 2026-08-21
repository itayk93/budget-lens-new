-- Add notification preferences and RPC helpers

alter table if exists public.push_system_config
    add column if not exists notification_preferences jsonb not null default '{}'::jsonb;
create or replace function public.get_notification_preferences()
returns jsonb
language sql
security definer
set search_path = public
as $$
    select coalesce(notification_preferences, '{}'::jsonb)
    from public.push_system_config
    where id = 1
    union all
    select '{}'::jsonb
    where not exists (select 1 from public.push_system_config where id = 1);
$$;
grant execute on function public.get_notification_preferences() to anon, authenticated, service_role;
create or replace function public.set_notification_preference(p_key text, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    next_prefs jsonb;
begin
    if p_key is null or btrim(p_key) = '' then
        raise exception 'Invalid preference key';
    end if;

    insert into public.push_system_config as cfg (id, vapid_subject, notification_preferences)
    values (
        1,
        coalesce((select vapid_subject from public.push_system_config where id = 1), 'mailto:push@boombark.app'),
        jsonb_build_object(p_key, p_enabled)
    )
    on conflict (id) do update
        set notification_preferences = coalesce(cfg.notification_preferences, '{}'::jsonb) || jsonb_build_object(p_key, p_enabled),
            updated_at = now()
    returning notification_preferences into next_prefs;

    return next_prefs;
end;
$$;
grant execute on function public.set_notification_preference(text, boolean) to anon, authenticated, service_role;
