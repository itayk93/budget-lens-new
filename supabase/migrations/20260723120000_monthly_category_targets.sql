-- Per-month category forecasts.
--
-- Riseup keeps a plan per category PER MONTH, not one global figure: fixed expenses and
-- income roll over to the new month, while variable categories start empty and are set
-- by hand ("עריכת סכום" in the category's kebab menu). category_order.monthly_target can
-- only hold one number per category, which is why stale figures such as a one-off trip
-- kept being counted every month.
--
-- This table holds the plan for a given flow_month. A missing row means "no forecast set
-- for that month" and the app falls back to category_order.monthly_target.

create table if not exists public.monthly_category_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  cash_flow_id uuid not null,
  category_name text not null,
  flow_month text not null check (flow_month ~ '^\d{4}-\d{2}$'),
  amount numeric not null default 0,
  -- true when the app seeded it automatically, false once the user edited it, so the
  -- monthly rollover never overwrites a number the user chose deliberately.
  is_suggestion boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, cash_flow_id, category_name, flow_month)
);

create index if not exists monthly_category_targets_lookup
  on public.monthly_category_targets (user_id, cash_flow_id, flow_month);

alter table public.monthly_category_targets enable row level security;

-- Mirrors the policy already used by category_order / shared_category_targets here.
drop policy if exists authenticated_full_access on public.monthly_category_targets;
create policy authenticated_full_access on public.monthly_category_targets
  for all to authenticated using (true) with check (true);

create or replace function public.touch_monthly_category_targets()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists monthly_category_targets_touch on public.monthly_category_targets;
create trigger monthly_category_targets_touch
  before update on public.monthly_category_targets
  for each row execute function public.touch_monthly_category_targets();
