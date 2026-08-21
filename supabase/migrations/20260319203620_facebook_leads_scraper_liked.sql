alter table public.facebook_leads_scraper
  add column if not exists liked boolean not null default false,
  add column if not exists liked_at timestamptz;
create index if not exists facebook_leads_scraper_liked_idx
  on public.facebook_leads_scraper (liked, scraped_at desc);
