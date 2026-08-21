-- Store per-user Google Sheets integration config.
-- Credentials are stored encrypted (ciphertext only). Decryption happens in Edge Functions.

create extension if not exists pgcrypto;
create table if not exists public.google_sheets_configs (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  spreadsheet_id text not null,
  profit_spreadsheet_id text,
  sales_spreadsheet_id text,
  service_account_email text,
  credentials_ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.google_sheets_configs enable row level security;
-- No RLS policies on purpose: this table is only accessed via Edge Functions (service role).

create or replace function public.set_updated_at_google_sheets_configs()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists set_updated_at_google_sheets_configs on public.google_sheets_configs;
create trigger set_updated_at_google_sheets_configs
before update on public.google_sheets_configs
for each row
execute function public.set_updated_at_google_sheets_configs();
