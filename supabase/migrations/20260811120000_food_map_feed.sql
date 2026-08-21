-- The food map used to ship as public/food-places.json — a static file served to
-- anyone who hit the site, containing real merchant names, coordinates, visit
-- counts and amounts. Move the feed into the database so it is scoped to the
-- signed-in owner and covered by RLS like every other financial table.

create table if not exists public.food_map_feed (
  user_id uuid primary key references auth.users (id) on delete cascade,
  feed jsonb not null,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.food_map_feed enable row level security;

drop policy if exists food_map_feed_select_own on public.food_map_feed;
create policy food_map_feed_select_own on public.food_map_feed
  for select to authenticated
  using (user_id = auth.uid());

-- The geocoding pipeline writes with the service role; no client-side writes.
drop policy if exists food_map_feed_service_role on public.food_map_feed;
create policy food_map_feed_service_role on public.food_map_feed
  for all to service_role
  using (true) with check (true);

grant select on public.food_map_feed to authenticated;
grant all on public.food_map_feed to service_role;
