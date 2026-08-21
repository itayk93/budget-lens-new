create table if not exists public.bank_scraper_ignored_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  bank_scraper_source_id bigint not null,
  reason text not null default 'user_deleted',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, bank_scraper_source_id)
);

create index if not exists bank_scraper_ignored_transactions_user_source_idx
  on public.bank_scraper_ignored_transactions (user_id, bank_scraper_source_id);

alter table public.bank_scraper_ignored_transactions enable row level security;

drop policy if exists "Users can view their ignored bank scraper rows" on public.bank_scraper_ignored_transactions;
create policy "Users can view their ignored bank scraper rows"
on public.bank_scraper_ignored_transactions
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their ignored bank scraper rows" on public.bank_scraper_ignored_transactions;
create policy "Users can insert their ignored bank scraper rows"
on public.bank_scraper_ignored_transactions
for insert
to authenticated
with check (auth.uid() = user_id);

grant all on public.bank_scraper_ignored_transactions to service_role;
