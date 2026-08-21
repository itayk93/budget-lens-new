// Step 2: upload the extracted flight log to public.airports / public.flights.
//
//   FLIGHTS_OWNER_EMAIL=you@example.com node scripts/flights/2-publish.mjs
//
// Airports are shared reference data and get upserted by code. Legs are personal,
// so they are written under the owner's user id and read back through RLS by the
// signed-in session. Re-running updates matching legs and inserts missing ones.
// DB-only legs recovered later from Gmail remain untouched.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const FEED = path.resolve('data/flights.local.json');

async function resolveOwnerId(supabase) {
  const explicit = process.env.FLIGHTS_OWNER_USER_ID;
  if (explicit) return explicit;

  const email = process.env.FLIGHTS_OWNER_EMAIL;
  if (!email) throw new Error('set FLIGHTS_OWNER_USER_ID or FLIGHTS_OWNER_EMAIL');

  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < 200) break;
  }
  throw new Error(`no auth user with email ${email}`);
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('missing SUPABASE_URL / SUPABASE_SECRET');
  if (!fs.existsSync(FEED)) throw new Error('run scripts/flights/1-extract.mjs first');

  const { airports, flights } = JSON.parse(fs.readFileSync(FEED, 'utf8'));
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const userId = await resolveOwnerId(supabase);

  const up = await supabase.from('airports').upsert(airports, { onConflict: 'code' });
  if (up.error) throw up.error;

  for (const flight of flights) {
    const match = await supabase
      .from('flights')
      .select('id')
      .eq('user_id', userId)
      .eq('origin', flight.origin)
      .eq('destination', flight.destination)
      .eq('flight_date', flight.flight_date);
    if (match.error) throw match.error;
    if (match.data.length > 1) {
      throw new Error(`duplicate flight key: ${flight.origin}-${flight.destination} ${flight.flight_date}`);
    }

    if (match.data.length === 1) {
      const update = await supabase.from('flights').update(flight).eq('id', match.data[0].id);
      if (update.error) throw update.error;
    } else {
      const insert = await supabase.from('flights').insert({ ...flight, user_id: userId });
      if (insert.error) throw insert.error;
    }
  }

  console.log(`published ${airports.length} airports and ${flights.length} legs for ${userId}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
