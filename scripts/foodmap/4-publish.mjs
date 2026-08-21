// Step 4: upload the generated feed to public.food_map_feed.
//
//   FOOD_MAP_OWNER_EMAIL=you@example.com node scripts/foodmap/4-publish.mjs
//
// The feed is personal spending data, so it is never committed and never served
// as a static file. It lives in one RLS-protected row keyed by the owner's user
// id, and the map reads it with the signed-in user's own session.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const FEED = path.resolve('data/food-places.local.json');

async function resolveOwnerId(supabase) {
  const explicit = process.env.FOOD_MAP_OWNER_USER_ID;
  if (explicit) return explicit;

  const email = process.env.FOOD_MAP_OWNER_EMAIL;
  if (!email) throw new Error('set FOOD_MAP_OWNER_USER_ID or FOOD_MAP_OWNER_EMAIL');

  // listUsers is paginated; the owner account is small-scale so a few pages suffice.
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
  if (!fs.existsSync(FEED)) throw new Error('run scripts/foodmap/2-geocode.mjs first');

  const feed = JSON.parse(fs.readFileSync(FEED, 'utf8'));
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const userId = await resolveOwnerId(supabase);

  const { error } = await supabase
    .from('food_map_feed')
    .upsert({
      user_id: userId,
      feed,
      generated_at: feed.generated_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  if (error) throw error;

  console.log(`published ${feed.places.length} places for ${userId}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
