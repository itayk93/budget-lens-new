// Step 2: merchants -> coordinates. Writes data/food-places.local.json
//
// The output holds real merchant names, coordinates and amounts, so it stays
// gitignored. Step 4 uploads it to the owner's row in public.food_map_feed.
//
//   node scripts/foodmap/2-geocode.mjs            # real, needs GOOGLE_MAPS_API_KEY
//   node scripts/foodmap/2-geocode.mjs --osm      # real, OpenStreetMap, no key, ~1 req/sec
//   node scripts/foodmap/2-geocode.mjs --mock     # invented but plausible coords
//
// Cache lives in data/geocode-cache.json so real lookups are paid for once.
import fs from 'node:fs';
import path from 'node:path';

const MOCK = process.argv.includes('--mock');
const OSM = process.argv.includes('--osm');
const REFRESH = process.argv.includes('--refresh');
const PROVIDER = MOCK ? 'mock' : OSM ? 'osm' : 'google';
const CSV = path.resolve('data/food-transactions.csv');
const CACHE = path.resolve('data/geocode-cache.json');
const OUT = path.resolve('data/food-places.local.json');
const AUDIT_OUT = path.resolve('data/geocode-audit.json');

// Reviewed exceptions take precedence over provider caches. Keep this list small:
// it is for identities confirmed from authoritative business/map sources.
const VERIFIED_OVERRIDES = {
  'Hollands Hof': {
    lat: 50.88036,
    lng: 4.6965,
    address: 'Brusselsestraat 80, 3000 Leuven, בלגיה',
    city: 'Leuven',
    country: 'בלגיה',
    confidence: 'verified',
  },
  'Tafelrond Nv': {
    lat: 50.87891,
    lng: 4.70192,
    address: 'Grote Markt 5, 3000 Leuven, בלגיה',
    city: 'Leuven',
    country: 'בלגיה',
    confidence: 'verified',
  },
};

// ---------- csv ----------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

// ---------- city hints ----------
// Merchant strings carry their own location clues. Used to bias the real Places
// query and to place mock pins somewhere believable.
const CITY_HINTS = [
  [/LOUVAIN|LLN|LEUVEN/i, 'Leuven, Belgium', 50.8798, 4.7005],
  [/BRUSSEL|BRUXELLES/i, 'Brussels, Belgium', 50.8476, 4.3572],
  [/\bGENT\b|GHENT/i, 'Ghent, Belgium', 51.0543, 3.7174],
  [/ANTWERP/i, 'Antwerp, Belgium', 51.2194, 4.4025],
  [/OXFORD|JERICHO/i, 'Oxford, UK', 51.7520, -1.2577],
  [/LONDON/i, 'London, UK', 51.5072, -0.1276],
  [/MILANO|MILAN|PORTA NUOVA|P. VETER/i, 'Milan, Italy', 45.4642, 9.1900],
  [/LIDO DI CAMA|VERSILIA|CAMAIORE/i, 'Lido di Camaiore, Italy', 43.9068, 10.2306],
  [/ROMA|ROME/i, 'Rome, Italy', 41.9028, 12.4964],
  [/נתב.?ג|נמל התעופה/, 'Ben Gurion Airport, Israel', 32.0004, 34.8706],
  [/רמת גן|איילון/, 'Ramat Gan, Israel', 32.0684, 34.8248],
  [/הרצליה|גלילות/, 'Herzliya, Israel', 32.1624, 34.8447],
  [/ירושלים/, 'Jerusalem, Israel', 31.7683, 35.2137],
  [/חיפה/, 'Haifa, Israel', 32.7940, 34.9896],
  [/באר שבע/, 'Beer Sheva, Israel', 31.2530, 34.7915],
];

// Tel Aviv neighbourhood anchors, so mock pins spread across the city the way
// real ones would instead of piling onto a single dot.
const TLV_ANCHORS = [
  [/דיזינגוף/, 32.0793, 34.7735],
  [/מידטאון|מנחם בגין/, 32.0716, 34.7908],
  [/רוטשילד/, 32.0637, 34.7738],
  [/שינקין/, 32.0669, 34.7735],
  [/הבימה|בן ציון/, 32.0730, 34.7790],
  [/כיכר המדינה|ויצמן/, 32.0872, 34.7899],
  [/פלורנטין/, 32.0562, 34.7692],
  [/נמל|חוף/, 32.0975, 34.7728],
  [/יפו/, 32.0530, 34.7519],
  [/רמת אביב|ברודצקי/, 32.1133, 34.8044],
  [/איכילוב|השלום/, 32.0800, 34.7940],
];
const TLV = [32.0740, 34.7800];

// deterministic pseudo-random from a string, so mock coords are stable per run
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

function mockCoords(name) {
  for (const [re, label, lat, lng] of CITY_HINTS) {
    if (re.test(name)) {
      return { lat: lat + (hash(name) - 0.5) * 0.02, lng: lng + (hash(name + 'x') - 0.5) * 0.03, city: label.split(',')[0], country: label.split(', ').pop() };
    }
  }
  for (const [re, lat, lng] of TLV_ANCHORS) {
    if (re.test(name)) {
      return { lat: lat + (hash(name) - 0.5) * 0.006, lng: lng + (hash(name + 'x') - 0.5) * 0.008, city: 'Tel Aviv', country: 'Israel' };
    }
  }
  return { lat: TLV[0] + (hash(name) - 0.5) * 0.05, lng: TLV[1] + (hash(name + 'x') - 0.5) * 0.06, city: 'Tel Aviv', country: 'Israel' };
}

function cityBias(name) {
  for (const [re, label] of CITY_HINTS) if (re.test(name)) return label;
  return '';
}

function normalizedWords(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

function candidateMatchesMerchant(merchant, candidate) {
  const merchantWords = normalizedWords(merchant);
  const candidateWords = new Set(normalizedWords(candidate?.displayName?.text));
  if (!merchantWords.length || !candidateWords.size) return false;
  const overlap = merchantWords.filter((word) => candidateWords.has(word)).length;
  return overlap >= Math.min(2, merchantWords.length);
}

async function googleGeocode(name) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      // Billed per SKU by the widest field requested. location + formattedAddress
      // put us in Text Search Pro; rating/types would push it higher for data the
      // map never shows.
      'X-Goog-FieldMask': 'places.displayName,places.location,places.formattedAddress,places.types',
    },
    body: JSON.stringify({
      textQuery: [name, cityBias(name)].filter(Boolean).join(' '),
      maxResultCount: 5,
      languageCode: 'he',
    }),
  });
  if (!res.ok) throw new Error(`places ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const p = json.places?.find((candidate) => candidateMatchesMerchant(name, candidate));
  // Never accept a city, street or unrelated business merely because it is near
  // a fallback location. An uncertain merchant is safer off the map.
  if (!p) return null;
  const addr = p.formattedAddress || '';
  return {
    lat: p.location.latitude,
    lng: p.location.longitude,
    address: addr,
    city: addr.split(',').slice(-2, -1)[0]?.trim() || '',
    country: addr.split(',').pop()?.trim() || '',
  };
}

// Nominatim: free, keyless, but strictly 1 request/second and it wants a real
// User-Agent. Merchant strings carry branch noise ("רולדין דיזינגוף סנטר") that
// OSM will not match, so we retry with progressively shorter queries.
const NOMINATIM_MIN_INTERVAL = 1100;
let lastNominatimCall = 0;

function osmQueries(name) {
  const city = cityBias(name);
  const bare = name
    .replace(/\b(IL|LTD|PLC|INC)\b/gi, '')
    .replace(/\d{2,}/g, '')
    .trim();
  const head = bare.split(/\s+/).slice(0, 2).join(' ');
  return [...new Set([
    city ? `${bare}, ${city}` : bare,
    city ? `${head}, ${city}` : head,
  ])].filter((q) => q.length > 4);
}

async function osmGeocode(name) {
  for (const q of osmQueries(name)) {
    const wait = NOMINATIM_MIN_INTERVAL - (Date.now() - lastNominatimCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatimCall = Date.now();

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('accept-language', 'he,en');

    const res = await fetch(url, {
      headers: { 'User-Agent': 'budget-lens-foodmap/1.0 (personal spending map)' },
    });
    if (res.status === 429 || res.status === 503) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const [hit] = await res.json();
    if (!hit) continue;

    const a = hit.address || {};
    return {
      lat: Number(hit.lat),
      lng: Number(hit.lon),
      address: hit.display_name || '',
      city: a.city || a.town || a.village || a.municipality || a.suburb || '',
      country: a.country || '',
      place_type: hit.type || '',
      rating: null,
    };
  }
  return null;
}

// Google hands back the postal-code form of a locality ("3000 Leuven",
// "6492106", "55041 Camaiore LU"). The city list is unreadable with those, so
// recover the locality from the formatted address instead.
const CITY_ALIASES = new Map([
  ['tel aviv-yafo', 'תל אביב-יפו'],
  ['tel aviv', 'תל אביב-יפו'],
  ['jerusalem', 'ירושלים'],
  ['ramat gan', 'רמת גן'],
  ['givatayim', 'גבעתיים'],
  ['herzliya', 'הרצליה'],
]);

function cleanCity(rawCity, address, country) {
  const candidates = [];
  if (address) {
    const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length && parts[parts.length - 1] === country) parts.pop();
    candidates.push(...parts.filter((p) => !/^\d[\d\s-]*$/.test(p)).reverse());
  }
  candidates.push(rawCity);

  for (const raw of candidates) {
    if (!raw) continue;
    const city = String(raw)
      .replace(/^\d{4,}\s+/, '')      // "3000 Leuven"
      .replace(/\s+\d{4,}$/, '')      // "Leuven 3000"
      .replace(/\s+[A-Z]{2}$/, '')    // Italian province suffix, "Camaiore LU"
      .replace(/^\d+\s*/, '')
      .trim();
    if (!city || /^\d+$/.test(city)) continue;
    if (/^\D*\d+\D*$/.test(city) && /\d/.test(city) && city.length < 6) continue;
    return CITY_ALIASES.get(city.toLowerCase()) || city;
  }
  return '';
}

async function main() {
  // A key is only needed for merchants the cache has never seen. Re-running to
  // reshape the output must not require one.
  const canCallGoogle = PROVIDER !== 'google' || Boolean(process.env.GOOGLE_MAPS_API_KEY);
  let skippedForMissingKey = 0;

  const rows = parseCsv(fs.readFileSync(CSV, 'utf8').replace(/^﻿/, ''));
  const headers = rows.shift();
  const txns = rows
    .filter((r) => r.length === headers.length)
    .map((vals) => Object.fromEntries(headers.map((h, i) => [h, vals[i]])));

  // A merchant name has to contain at least one letter to be a place. Punctuation-only
  // names like "." geocode to a plausible-looking but meaningless pin.
  const isPlaceName = (name) => /\p{L}/u.test(String(name ?? ''));

  // group transactions by merchant
  const byName = new Map();
  for (const t of txns) {
    if (!isPlaceName(t.name)) continue;
    const g = byName.get(t.name) || { name: t.name, visits: 0, total: 0, categories: {}, txns: [], first: t.date, last: t.date, currency: t.currency };
    g.visits++;
    g.total += Number(t.amount) || 0;
    g.categories[t.category] = (g.categories[t.category] || 0) + 1;
    g.txns.push({ date: t.date, amount: Math.round((Number(t.amount) || 0) * 100) / 100, method: t.payment_method || '' });
    if (t.date < g.first) g.first = t.date;
    if (t.date > g.last) g.last = t.date;
    byName.set(t.name, g);
  }

  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  const previousFeed = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { places: [] };
  const previousByName = new Map((previousFeed.places || []).map((place) => [place.name, place]));
  const places = [];
  const audit = { provider: PROVIDER, refreshed: REFRESH, generated_at: new Date().toISOString(), verified: [], changed: [], unresolved: [] };
  let hits = 0, misses = 0, cached = 0;

  let done = 0;
  for (const g of byName.values()) {
    const cacheKey = `${PROVIDER}:${g.name}`;
    const reviewed = VERIFIED_OVERRIDES[g.name];
    let loc = reviewed || (REFRESH ? undefined : cache[cacheKey]);
    if (reviewed) cache[cacheKey] = loc;
    if (loc === undefined) {
      if (PROVIDER === 'mock') loc = mockCoords(g.name);
      else if (PROVIDER === 'osm') {
        try { loc = await osmGeocode(g.name); }
        catch (e) { console.error(`! ${g.name}: ${e.message}`); loc = null; }
      } else if (!canCallGoogle) {
        skippedForMissingKey++;
        continue; // leave it uncached so a later run with a key picks it up
      } else {
        try { loc = await googleGeocode(g.name); }
        catch (e) { console.error(`! ${g.name}: ${e.message}`); loc = null; }
        await new Promise((r) => setTimeout(r, 60));
      }
      cache[cacheKey] = loc;
      // Nominatim runs for minutes; checkpoint so a crash keeps the work.
      if (++done % 25 === 0) {
        fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
        console.log(`  ...${done} looked up`);
      }
    } else cached++;

    if (!loc) {
      misses++;
      audit.unresolved.push({ name: g.name, visits: g.visits, category: Object.entries(g.categories).sort((a, b) => b[1] - a[1])[0][0] });
      continue;
    }
    hits++;
    const category = Object.entries(g.categories).sort((a, b) => b[1] - a[1])[0][0];
    const previous = previousByName.get(g.name);
    const movedKm = previous
      ? Math.hypot((Number(loc.lat) - previous.lat) * 111, (Number(loc.lng) - previous.lng) * 85)
      : null;
    const auditRow = { name: g.name, city: loc.city || '', country: loc.country || '', lat: Number(loc.lat), lng: Number(loc.lng), source: reviewed ? 'verified_override' : PROVIDER };
    if (movedKm !== null && movedKm > 1) audit.changed.push({ ...auditRow, previous_lat: previous.lat, previous_lng: previous.lng, moved_km: Math.round(movedKm) });
    else audit.verified.push(auditRow);
    places.push({
      name: g.name,
      lat: Number(loc.lat.toFixed(6)),
      lng: Number(loc.lng.toFixed(6)),
      city: cleanCity(loc.city, loc.address, loc.country),
      country: loc.country || '',
      address: loc.address || '',
      category,
      visits: g.visits,
      total: Math.round(g.total),
      currency: g.currency,
      first: g.first,
      last: g.last,
      // Powers the drill-down inside the map popup.
      txns: g.txns.sort((a, b) => (a.date < b.date ? 1 : -1)),
      mock: MOCK,
    });
  }

  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  fs.writeFileSync(AUDIT_OUT, JSON.stringify({
    ...audit,
    merchant_count: byName.size,
    located_count: places.length,
    unresolved_count: audit.unresolved.length,
    changed_count: audit.changed.length,
  }, null, 2));
  places.sort((a, b) => b.visits - a.visits);
  fs.writeFileSync(OUT, JSON.stringify({
    generated_at: new Date().toISOString(),
    provider: PROVIDER,
    mock: MOCK,
    merchant_count: byName.size,
    not_found: misses,
    place_count: places.length,
    visit_count: places.reduce((s, p) => s + p.visits, 0),
    total_spent: places.reduce((s, p) => s + p.total, 0),
    places,
  }, null, 2));

  console.log(`merchants: ${byName.size} | located: ${hits} | not found: ${misses} | from cache: ${cached}`);
  if (skippedForMissingKey) console.log(`skipped (no GOOGLE_MAPS_API_KEY, not yet cached): ${skippedForMissingKey}`);
  console.log(`provider: ${PROVIDER}${MOCK ? ' (invented coordinates)' : ''}`);
  console.log(`audit: ${audit.changed.length} changed | ${audit.unresolved.length} unresolved`);
  console.log(`-> ${OUT}`);
  console.log(`-> ${AUDIT_OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
