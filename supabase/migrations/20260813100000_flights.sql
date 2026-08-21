-- The flight log used to live in a standalone static page (flight-globe), with
-- every leg hardcoded in the HTML. Move it into the database next to the rest of
-- the personal data: legs are owner-scoped under RLS, airports are plain geo
-- reference data shared by every reader.

create table if not exists public.airports (
  code text primary key,
  lat double precision not null,
  lng double precision not null,
  city text not null
);

create table if not exists public.flights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  origin text not null references public.airports (code),
  destination text not null references public.airports (code),
  airline text not null,
  flight_number text,
  flight_date date not null,
  depart_time text,
  arrive_time text,
  duration text,
  -- Free text: a fare ("EUR 200.83"), a pointer to the booking it shares
  -- ("אותה הזמנה"), or a status note. Never a booking reference — PNRs stay out.
  fare_note text,
  -- Provenance, so a time read off a public timetable is never mistaken for what
  -- the ticket said: original (the standalone page) | gmail | schedule.
  source text not null default 'original',
  created_at timestamptz not null default now()
);

create index if not exists flights_user_date_idx on public.flights (user_id, flight_date desc);

alter table public.airports enable row level security;
alter table public.flights enable row level security;

drop policy if exists airports_select_all on public.airports;
create policy airports_select_all on public.airports
  for select to authenticated using (true);

drop policy if exists airports_service_role on public.airports;
create policy airports_service_role on public.airports
  for all to service_role using (true) with check (true);

drop policy if exists flights_select_own on public.flights;
create policy flights_select_own on public.flights
  for select to authenticated using (user_id = auth.uid());

-- Legs are published by the import script with the service role; the page reads only.
drop policy if exists flights_service_role on public.flights;
create policy flights_service_role on public.flights
  for all to service_role using (true) with check (true);

grant select on public.airports to authenticated;
grant select on public.flights to authenticated;
grant all on public.airports to service_role;
grant all on public.flights to service_role;
