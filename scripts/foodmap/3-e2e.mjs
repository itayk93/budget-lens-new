// Step 3: end-to-end check of the food map pipeline.
//
//   node scripts/foodmap/3-e2e.mjs                     # data checks only
//   E2E_BASE_URL=http://localhost:8080 node scripts/foodmap/3-e2e.mjs   # + serving checks
//
// Follows the same shape as scripts/e2e-functions.mjs: plain node, no runner.
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.E2E_BASE_URL || '';
const CSV = path.resolve('data/food-transactions.csv');
const JSON_PATH = path.resolve('data/food-places.local.json');
const UI_PATH = path.resolve('src/pages/FoodMap.tsx');

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    const detail = fn();
    passed++;
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log(`  FAIL ${name} — ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log('food map e2e\n');

  console.log('data files');
  check('food-transactions.csv exists', () => {
    assert(fs.existsSync(CSV), 'run scripts/foodmap/1-extract.mjs first');
  });
  check('food-places.local.json exists', () => {
    assert(fs.existsSync(JSON_PATH), 'run scripts/foodmap/2-geocode.mjs first');
  });
  check('the feed is not committed or publicly served', () => {
    assert(!fs.existsSync(path.resolve('public/food-places.json')),
      'public/food-places.json exposes personal spending data to anyone — publish to food_map_feed instead');
  });
  check('FoodMap UI source exists', () => {
    assert(fs.existsSync(UI_PATH), 'src/pages/FoodMap.tsx missing');
  });

  if (failures.length) return report();

  const csvLines = fs.readFileSync(CSV, 'utf8').trim().split('\n');
  const feed = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const places = feed.places;
  const ui = fs.readFileSync(UI_PATH, 'utf8');
  const geocoder = fs.readFileSync(path.resolve('scripts/foodmap/2-geocode.mjs'), 'utf8');

  console.log('\ntransactions');
  check('csv has a header and rows', () => {
    assert(csvLines.length > 1, 'csv is empty');
    return `${csvLines.length - 1} rows`;
  });
  check('csv header matches the extractor contract', () => {
    const header = csvLines[0].replace(/^﻿/, '');
    assert(header === 'id,raw_name,name,category,amount,currency,date,payment_method', `got: ${header}`);
  });

  console.log('\nplaces feed');
  check('feed is non-empty', () => {
    assert(Array.isArray(places) && places.length > 0, 'no places');
    return `${places.length} places`;
  });
  check('counters agree with the array', () => {
    assert(feed.place_count === places.length, `place_count ${feed.place_count} != ${places.length}`);
    const visits = places.reduce((s, p) => s + p.visits, 0);
    assert(feed.visit_count === visits, `visit_count ${feed.visit_count} != ${visits}`);
    return `${feed.visit_count} visits, ₪${feed.total_spent.toLocaleString('en-US')}`;
  });
  check('every place has usable coordinates', () => {
    for (const p of places) {
      assert(Number.isFinite(p.lat) && p.lat >= -90 && p.lat <= 90, `${p.name}: bad lat ${p.lat}`);
      assert(Number.isFinite(p.lng) && p.lng >= -180 && p.lng <= 180, `${p.name}: bad lng ${p.lng}`);
      assert(!(p.lat === 0 && p.lng === 0), `${p.name}: null island`);
    }
  });
  check('every place has a name, category and visit count', () => {
    for (const p of places) {
      assert(p.name && p.name.trim(), 'empty name');
      assert(p.category, `${p.name}: no category`);
      assert(p.visits >= 1, `${p.name}: visits ${p.visits}`);
      assert(p.total >= 0, `${p.name}: total ${p.total}`);
    }
  });
  check('categories are the ones the UI can colour', () => {
    const known = new Set(['בתי קפה', 'אוכל בחוץ', 'סופר', 'פנאי ובילויים', 'יין']);
    const unknown = [...new Set(places.map((p) => p.category))].filter((c) => !known.has(c));
    assert(unknown.length === 0, `unknown: ${unknown.join(', ')}`);
  });
  check('date range is coherent', () => {
    for (const p of places) assert(p.first <= p.last, `${p.name}: ${p.first} > ${p.last}`);
    const first = places.map((p) => p.first).sort()[0];
    const last = places.map((p) => p.last).sort().pop();
    return `${first} → ${last}`;
  });
  check('no duplicate merchants', () => {
    const names = places.map((p) => p.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    assert(dupes.length === 0, `duplicates: ${[...new Set(dupes)].slice(0, 3).join(', ')}`);
  });
  check('payment rails were filtered out', () => {
    const bad = places.filter((p) => /^PAYBOX|^BIT$|העברה|מועדון|רכישות שובר/i.test(p.name));
    assert(bad.length === 0, `leaked: ${bad.slice(0, 3).map((p) => p.name).join(', ')}`);
  });
  check('every place carries its drill-down transactions', () => {
    for (const p of places) {
      assert(Array.isArray(p.txns), `${p.name}: no txns array`);
      assert(p.txns.length === p.visits, `${p.name}: ${p.txns.length} txns but ${p.visits} visits`);
      const sum = Math.round(p.txns.reduce((s, t) => s + t.amount, 0));
      assert(Math.abs(sum - p.total) <= 1, `${p.name}: txns sum ${sum} != total ${p.total}`);
      for (const t of p.txns) assert(/^\d{4}-\d{2}-\d{2}$/.test(t.date), `${p.name}: bad date ${t.date}`);
    }
  });
  check('transactions are newest first', () => {
    for (const p of places) {
      for (let i = 1; i < p.txns.length; i++) {
        assert(p.txns[i - 1].date >= p.txns[i].date, `${p.name}: out of order`);
      }
    }
  });
  check('city names are readable, not postal codes', () => {
    const numeric = places.filter((p) => p.city && /^\d/.test(p.city));
    assert(numeric.length === 0, `numeric cities: ${numeric.slice(0, 3).map((p) => p.city).join(', ')}`);
  });
  check('spread over more than one city', () => {
    const cities = new Set(places.map((p) => p.city).filter(Boolean));
    assert(cities.size > 1, `only ${[...cities].join(', ')}`);
    return `${cities.size} cities`;
  });

  if (feed.mock) console.log('\n  note: feed is MOCK — coordinates are invented');

  console.log('\nmobile exploration UI');
  check('bottom sheet exposes draggable snap points and tap cycling', () => {
    assert(/mobileSheetStops/.test(ui), 'snap points missing');
    assert(/onSheetPointerDown/.test(ui) && /onSheetPointerMove/.test(ui), 'pointer drag handlers missing');
    assert(/cycleSheetHeight/.test(ui), 'tap-to-cycle missing');
    assert(/food-map-sheet-ratio/.test(ui), 'persisted sheet height missing');
  });
  check('mobile text fields prevent iOS focus zoom', () => {
    assert(/search:\s*\{[\s\S]*?fontSize: 16/.test(ui), 'search input font must be at least 16px');
    assert(/correctionInput:\s*\{[\s\S]*?fontSize: 16/.test(ui), 'correction inputs must be at least 16px');
  });
  check('drag handle has an accessible touch target', () => {
    assert(/aria-label="גרור לשינוי גובה החלונית"/.test(ui), 'handle label missing');
    assert(/width: 72/.test(ui) && /height: 30/.test(ui), 'expanded handle hit target missing');
    assert(/touchAction: "none"/.test(ui), 'touch gesture protection missing');
  });
  check('map source clusters dense markers', () => {
    assert(/cluster: true/.test(ui), 'cluster source disabled');
    assert(/places-cluster/.test(ui) && /places-cluster-count/.test(ui), 'cluster layers missing');
    assert(/getClusterExpansionZoom/.test(ui), 'cluster expansion interaction missing');
  });
  check('geocoding rejects unrelated default-city matches', () => {
    const hollands = places.find((place) => place.name === 'Hollands Hof');
    assert(hollands?.city === 'Leuven' && hollands?.country === 'בלגיה', 'verified Hollands Hof location regressed');
    assert(Math.abs(hollands.lat - 50.88036) < 0.001, 'Hollands Hof latitude is wrong');
    assert(/return ''/.test(geocoder), 'unknown merchants must not default to Tel Aviv');
    assert(/candidateMatchesMerchant/.test(geocoder), 'Google candidate name validation missing');
    assert(/VERIFIED_OVERRIDES/.test(geocoder), 'reviewed location overrides missing');
    for (const badName of ['.', 'HARD ROCK CAFE ITALY', 'CENTRE DES MONUMENTS N']) {
      assert(!places.some((place) => place.name === badName), `unverified false pin remains: ${badName}`);
    }
  });
  check('map and list are synchronized', () => {
    assert(/focusCity/.test(ui) && /fitBounds/.test(ui), 'city-to-map navigation missing');
    assert(/focusPlace/.test(ui) && /spotRowOn/.test(ui), 'place selection sync missing');
    assert(/חפש באזור הזה/.test(ui) && /applySearchArea/.test(ui), 'search-this-area action missing');
    assert(/viewportPlaceKeys/.test(ui), 'deterministic viewport snapshot missing');
    assert(/food-map-area-feedback/.test(ui), 'search-area result feedback missing');
    assert(/showAreaResults/.test(ui) && /resultsListRef/.test(ui), 'area feedback must open and reveal results');
    assert(/filteredBeforeViewport/.test(ui), 'area count and visible results must share active filters');
  });
  check('PromptForge mobile UX contract keeps one contextual map action', () => {
    assert(/עדכן את האזור הזה/.test(ui), 'contextual area action copy missing');
    assert(/אזור המפה · \{visible\.length\}/.test(ui), 'viewport reset must live in the filter row');
    assert(/insights && !viewportPlaceKeys/.test(ui), 'area results must precede secondary insights');
    assert(/!viewportPlaceKeys && \(/.test(ui), 'area results must precede city navigation');
  });
  check('map controls use accessible SVG icons without emoji', () => {
    for (const icon of ['ArrowRight', 'Crosshair', 'Earth', 'MapIcon', 'Search']) {
      assert(ui.includes(icon), `SVG control icon missing: ${icon}`);
    }
    // Scoped to controls: a decorative emoji in a heading is fine, an emoji
    // standing in for a button's icon is not.
    const controls = ui.match(/<button[\s\S]*?<\/button>/g) || [];
    assert(controls.length > 0, 'no controls found to check');
    const withEmoji = controls.find((control) => /[🌎🗺️]/u.test(control));
    assert(!withEmoji, 'emoji must not be used as map control icons');
    assert(/title="חזרה לאפליקציה"/.test(ui), 'icon-only back control needs a tooltip');
    assert(/aria-pressed=\{isGlobe\}/.test(ui), 'globe toggle must expose its active state');
  });
  check('mobile controls expose 44px targets and selection semantics', () => {
    assert(/role="tablist"/.test(ui) && /aria-selected/.test(ui), 'tab semantics missing');
    assert(/aria-pressed/.test(ui), 'filter selection semantics missing');
    assert(/filterChip:\s*\{[\s\S]*?minHeight: 44/.test(ui), 'filter touch target too small');
    assert(/tab:\s*\{[\s\S]*?minHeight: 44/.test(ui), 'tab touch target too small');
    assert(/search:\s*\{[\s\S]*?height: 44/.test(ui), 'search touch target too small');
  });
  check('mobile filters cover time, geography, loyalty and spend', () => {
    for (const label of ['השנה האחרונה', 'ישראל', 'חו״ל', 'חזרתי שוב', 'מעל ₪500']) {
      assert(ui.includes(label), `filter missing: ${label}`);
    }
  });
  check('insights summarize the filtered dataset', () => {
    assert(/מה גיליתי/.test(ui), 'insights section missing');
    for (const field of ['monthlyAverage', 'israelTotal', 'abroadTotal', 'mostVisited']) {
      assert(ui.includes(field), `insight missing: ${field}`);
    }
  });
  check('place details include chart, maps, transactions and corrections', () => {
    assert(/food-map-month-chart/.test(ui), 'monthly chart missing');
    assert(/google\.com\/maps\/search/.test(ui), 'external maps action missing');
    assert(/saveCorrection/.test(ui) && /food-map-corrections/.test(ui), 'local corrections missing');
    assert(/כל .*העסקאות/.test(ui), 'transaction drill-down missing');
  });
  check('navigation, geolocation, loading and accessibility states exist', () => {
    assert(/food-map-app-back/.test(ui), 'app back action missing');
    assert(/food-map-locate/.test(ui) && /navigator\.geolocation/.test(ui), 'locate-me flow missing');
    assert(/food-map-control-dock/.test(ui) && /mapControlDivider/.test(ui), 'map controls must be grouped in one dock');
    assert(/bottom: sheetHeightPx \+ 14/.test(ui), 'mobile control dock must track sheet height');
    assert(/height 320ms cubic-bezier/.test(ui) && /bottom 320ms cubic-bezier/.test(ui), 'sheet and dock transitions missing');
    assert(/isSheetDragging/.test(ui) && /prefers-reduced-motion/.test(ui), 'drag and reduced-motion handling missing');
    assert(/food-map-loading/.test(ui), 'loading skeleton missing');
    // An account with no feed yet must get an empty state, not a red error.
    assert(/food-map-empty/.test(ui), 'empty state missing');
    assert(!/scripts\/foodmap/.test(ui), 'the UI must not tell users to run build scripts');
    assert(/aria-expanded/.test(ui), 'expanded-state semantics missing');
  });

  if (BASE_URL) {
    console.log('\nserving');
    await checkAsync('/food-places.json is NOT served', async () => {
      const res = await fetch(`${BASE_URL}/food-places.json`);
      assert(!res.ok || !(await res.clone().json().catch(() => null))?.places,
        'the feed must not be reachable without authentication');
      return `status ${res.status}`;
    });
    await checkAsync('/food-map returns the app shell', async () => {
      const res = await fetch(`${BASE_URL}/food-map`);
      assert(res.ok, `status ${res.status}`);
      const html = await res.text();
      assert(/<div id="root">/.test(html), 'no #root in html');
    });
  } else {
    console.log('\nserving — skipped (set E2E_BASE_URL to include it)');
  }

  report();
}

async function checkAsync(name, fn) {
  try {
    const detail = await fn();
    passed++;
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log(`  FAIL ${name} — ${e.message}`);
  }
}

function report() {
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
