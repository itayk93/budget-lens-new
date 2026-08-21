alter table public.google_sheets_configs
  add column if not exists income_spreadsheet_id text,
  add column if not exists expense_spreadsheet_id text;
