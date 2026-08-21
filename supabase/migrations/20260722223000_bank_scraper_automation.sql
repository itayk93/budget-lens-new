create table if not exists public.merchant_category_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  normalized_business_name text not null,
  display_business_name text,
  category_name text not null,
  source text not null default 'transactions',
  confidence numeric(4,3),
  reasoning text,
  metadata jsonb not null default '{}'::jsonb,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, normalized_business_name)
);

create index if not exists merchant_category_memory_user_last_used_idx
  on public.merchant_category_memory (user_id, last_used_at desc);

create table if not exists public.bank_scraper_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  triggered_by text not null default 'manual',
  source text not null default 'local-script',
  providers text[] not null default '{}'::text[],
  total_scraped integer not null default 0,
  total_new_sources integer not null default 0,
  total_new_pending integer not null default 0,
  total_classified_from_memory integer not null default 0,
  total_classified_from_ai integer not null default 0,
  total_failed_providers integer not null default 0,
  error_summary text,
  details jsonb not null default '{}'::jsonb
);

create index if not exists bank_scraper_sync_runs_user_started_idx
  on public.bank_scraper_sync_runs (user_id, started_at desc);

create index if not exists bank_scraper_pending_transactions_user_status_created_idx
  on public.bank_scraper_pending_transactions (user_id, status, created_at desc);

alter table public.merchant_category_memory enable row level security;
alter table public.bank_scraper_sync_runs enable row level security;

drop policy if exists "Users can view their merchant category memory" on public.merchant_category_memory;
create policy "Users can view their merchant category memory"
on public.merchant_category_memory
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their merchant category memory" on public.merchant_category_memory;
create policy "Users can insert their merchant category memory"
on public.merchant_category_memory
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their merchant category memory" on public.merchant_category_memory;
create policy "Users can update their merchant category memory"
on public.merchant_category_memory
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can view their bank scraper sync runs" on public.bank_scraper_sync_runs;
create policy "Users can view their bank scraper sync runs"
on public.bank_scraper_sync_runs
for select
to authenticated
using (auth.uid() = user_id);

grant all on public.merchant_category_memory to service_role;
grant all on public.bank_scraper_sync_runs to service_role;

