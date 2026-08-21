alter table public.google_sheets_configs
  add column if not exists business_spreadsheet_id text;
