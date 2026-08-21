-- Auth foundation for single-tenant private app.

create table if not exists public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'viewer' check (role in ('owner','admin','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.app_users enable row level security;
drop policy if exists app_users_select_self on public.app_users;
create policy app_users_select_self
on public.app_users
for select
to authenticated
using (auth.uid() = user_id and active = true);
drop policy if exists app_users_update_self on public.app_users;
create policy app_users_update_self
on public.app_users
for update
to authenticated
using (auth.uid() = user_id and active = true)
with check (auth.uid() = user_id and active = true);
create or replace function public.get_my_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role
  from public.app_users
  where user_id = auth.uid()
    and active = true
  limit 1;
$$;
revoke all on function public.get_my_role() from public;
grant execute on function public.get_my_role() to authenticated, service_role;
-- This migration used to promote a hardcoded personal address to 'owner'. The
-- owner is now whoever public.app_config('auth').owner_email names; the
-- promotion lives in 20260811121000_scrub_owner_email_default.sql.
-- Tighten RPC grants used by frontend/settings.
do $$
begin
  if to_regprocedure('public.get_notification_preferences()') is not null then
    revoke all on function public.get_notification_preferences() from anon;
    grant execute on function public.get_notification_preferences() to authenticated, service_role;
  end if;

  if to_regprocedure('public.set_notification_preference(text,boolean)') is not null then
    revoke all on function public.set_notification_preference(text,boolean) from anon;
    grant execute on function public.set_notification_preference(text,boolean) to authenticated, service_role;
  end if;

  if to_regprocedure('public.get_daily_king_push_config()') is not null then
    revoke all on function public.get_daily_king_push_config() from anon;
    grant execute on function public.get_daily_king_push_config() to authenticated, service_role;
  end if;

  if to_regprocedure('public.configure_daily_king_push(integer,integer,boolean,text)') is not null then
    revoke all on function public.configure_daily_king_push(integer,integer,boolean,text) from anon;
    grant execute on function public.configure_daily_king_push(integer,integer,boolean,text) to authenticated, service_role;
  end if;
end $$;
-- Lock down all public tables so anonymous traffic cannot read/write.
do $$
declare
  t record;
  p record;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename <> 'app_users'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);

    for p in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = t.tablename
    loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t.tablename);
    end loop;

    execute format(
      'create policy authenticated_full_access on public.%I for all to authenticated using (true) with check (true)',
      t.tablename
    );
  end loop;
end $$;
