-- Keep provenance actionable: Gmail provides a stable per-message URL that the
-- authenticated owner can open directly from the flight detail panel.
alter table public.flights
  add column if not exists email_url text;

comment on column public.flights.email_url is
  'Gmail message URL for the booking confirmation or itinerary used as source.';
