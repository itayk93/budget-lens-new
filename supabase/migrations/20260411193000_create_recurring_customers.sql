-- Recurring customers: derived from Google Sheets, with manual overrides.

create table if not exists public.recurring_customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,

  -- 'sheet' rows are synced from Google Sheets; 'manual' rows are user-added.
  source text not null default 'sheet' check (source in ('sheet','manual')),

  -- Stable key used to match sheet customers across syncs (typically normalized name).
  sheet_customer_key text,

  -- Sheet-derived fields (safe to overwrite on sync).
  sheet_name text,
  sheet_deal_count integer not null default 0,
  sheet_revenue numeric not null default 0,
  sheet_present boolean not null default true,
  last_synced_at timestamptz,

  -- User overrides (never overwritten by sync).
  custom_name text,
  notes text,
  sort_order integer not null default 0,
  excluded boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recurring_customers_tenant_id_idx on public.recurring_customers (tenant_id);
create index if not exists recurring_customers_excluded_idx on public.recurring_customers (excluded);
create index if not exists recurring_customers_sort_order_idx on public.recurring_customers (sort_order);
create index if not exists recurring_customers_sheet_customer_key_idx on public.recurring_customers (sheet_customer_key);
create index if not exists recurring_customers_sheet_present_idx on public.recurring_customers (sheet_present);
-- Prevent duplicate sheet-based rows per tenant.
create unique index if not exists recurring_customers_unique_sheet_key
  on public.recurring_customers (tenant_id, sheet_customer_key)
  where source = 'sheet' and sheet_customer_key is not null;
-- updated_at trigger (uses shared function created in earlier migrations)
drop trigger if exists set_recurring_customers_updated_at on public.recurring_customers;
create trigger set_recurring_customers_updated_at
before update on public.recurring_customers
for each row execute function public.set_updated_at();
-- Auto-fill tenant_id on insert (uses shared function created in earlier migrations)
drop trigger if exists set_recurring_customers_tenant_id on public.recurring_customers;
create trigger set_recurring_customers_tenant_id
before insert on public.recurring_customers
for each row execute function public.set_tenant_id_from_auth();
-- RLS: tenant isolation
alter table public.recurring_customers enable row level security;
drop policy if exists "Tenant isolation for recurring_customers" on public.recurring_customers;
create policy "Tenant isolation for recurring_customers"
on public.recurring_customers
for all
using (
  tenant_id in (
    select tenant_id
    from public.tenant_users
    where user_id = auth.uid()
  )
)
with check (
  tenant_id in (
    select tenant_id
    from public.tenant_users
    where user_id = auth.uid()
  )
);
