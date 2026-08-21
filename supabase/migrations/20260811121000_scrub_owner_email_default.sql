-- The owner address used to be hardcoded in two places: the lead_alert_logs
-- default recipient and the auth-lockdown promotion. Neither belongs in a public
-- repository, and Supabase does not allow `alter database ... set` for a custom
-- GUC, so the address lives in the app_config row instead.

alter table if exists public.lead_alert_logs alter column email_to drop default;

create table if not exists public.app_config (
  id text primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Set your own address once per environment:
--   insert into public.app_config (id, settings) values ('auth', jsonb_build_object('owner_email','you@example.com'))
--   on conflict (id) do update set settings = public.app_config.settings || excluded.settings, updated_at = now();
create or replace function public.owner_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(lower(settings ->> 'owner_email'), '')
  from public.app_config
  where id = 'auth';
$$;

revoke all on function public.owner_email() from public, anon;
grant execute on function public.owner_email() to authenticated, service_role;

-- Promote whoever app_config points at. Idempotent, and a no-op until it is set.
insert into public.app_users (user_id, email, role, active)
select u.id, u.email, 'owner', true
from auth.users u
where public.owner_email() is not null
  and lower(u.email) = public.owner_email()
on conflict (email) do update
set user_id = excluded.user_id,
    role = excluded.role,
    active = true,
    updated_at = now();
