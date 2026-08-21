// Step 1: pull the flight log out of the standalone flight-globe page.
//
//   node scripts/flights/1-extract.mjs [path/to/flight-globe/index.html]
//
// The legs are personal travel history, so the extracted file is gitignored and
// only ever lands in the owner's RLS-protected rows (step 2).
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2] || path.resolve('../flight-globe/index.html');
const OUT = path.resolve('data/flights.local.json');

// Both blocks are plain JS literals in the page; grab them by name and evaluate.
function literal(html, name, open, close) {
  const start = html.indexOf(`const ${name}=${open}`);
  if (start < 0) throw new Error(`no ${name} block in ${SRC}`);
  const from = start + `const ${name}=`.length;
  const end = html.indexOf(`${close};`, from);
  if (end < 0) throw new Error(`unterminated ${name} block`);
  return new Function(`return ${html.slice(from, end + 1)}`)();
}

const html = fs.readFileSync(SRC, 'utf8');
const ap = literal(html, 'AP', '{', '}');
const legs = literal(html, 'LEGS', '[', ']');

const airports = Object.entries(ap).map(([code, [lat, lng, city]]) => ({ code, lat, lng, city }));
const flights = legs.map(([origin, destination, airline, flightNumber, date, dep, arr, duration, fare]) => ({
  origin,
  destination,
  airline,
  // The page writes an em dash where the detail is unknown; store null instead.
  flight_number: flightNumber === '—' ? null : flightNumber,
  flight_date: date,
  depart_time: dep === '—' ? null : dep,
  arrive_time: arr === '—' ? null : arr,
  duration: duration === '—' ? null : duration,
  fare_note: fare === '—' ? null : fare,
}));

const missing = flights.flatMap((f) => [f.origin, f.destination]).filter((c) => !ap[c]);
if (missing.length) throw new Error(`legs reference unknown airports: ${[...new Set(missing)].join(', ')}`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ airports, flights }, null, 2));
console.log(`extracted ${airports.length} airports and ${flights.length} legs -> ${OUT}`);
