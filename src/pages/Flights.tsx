import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Minus, Plus, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LAND } from "@/data/worldOutline";

/* An orthographic globe rather than a flat map: a great-circle route drawn on a
   Mercator projection bends into an arc that looks nothing like the straight line
   it actually is, while on a sphere it reads correctly. The chrome around it —
   white panel, blue accents, mobile sheet — deliberately mirrors the food map so
   the two "extra" pages read as one app. */

type Airport = { code: string; lat: number; lng: number; city: string };
type Flight = {
  id: string;
  origin: string;
  destination: string;
  airline: string;
  flight_number: string | null;
  flight_date: string;
  depart_time: string | null;
  arrive_time: string | null;
  duration: string | null;
  email_url: string | null;
  fare_note: string | null;
  source: string | null;
};

/* Where a leg's details came from. A time read off a public timetable is a good
   guess, not what the ticket said, and the card says so rather than passing it
   off as booking data. */
const SOURCE_NOTE: Record<string, string> = {
  gmail: "פרטים מתוך אישור ההזמנה במייל",
  schedule: "חלק מהפרטים הושלמו מלוח זמנים ציבורי, לא מהאישור",
};

/* One blue ramp would lose the airlines, so each carrier keeps a hue — muted to
   sit on a light map the way the food map's dots do. */
const COLORS: Record<string, string> = {
  "אל על": "#1a56c4",
  "ויז אייר": "#b5379d",
  "ריינאייר": "#2f7fd6",
  "בריסלס איירליינס": "#0f8f86",
  "אתיופיאן": "#3f8f3f",
  "בריטיש איירווייס": "#c8385a",
  "בלו בירד": "#1f8bb0",
};
const PALETTE = ["#1a56c4", "#b5379d", "#2f7fd6", "#0f8f86", "#3f8f3f", "#c8385a", "#1f8bb0", "#a06a12"];
const colorOf = (airline: string, index: number) => COLORS[airline] || PALETTE[Math.max(0, index) % PALETTE.length];

const NS = "http://www.w3.org/2000/svg";
const DEG = Math.PI / 180;
const CX = 200;
const CY = 200;
const HOME = { r: 150, lam: 20, phi: 32 };
const PAGE_SIZE = 6;

const svgEl = (tag: string, attrs: Record<string, string | number>) => {
  const node = document.createElementNS(NS, tag);
  for (const key in attrs) node.setAttribute(key, String(attrs[key]));
  return node;
};

/* A line like "TLV → MXP" is all weak/neutral characters, so it inherits the
   surrounding RTL direction and comes out reversed. A leading LRM pins it to LTR. */
const ltr = (s: string) => `‎${s}`;
const dateLabel = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
/* "3ש 45ד" is Hebrew and must stay RTL, while "LY388" or "28/12/2026" must not —
   forcing one direction on both reorders one of them. */
const hasHebrew = (s: string) => /[֐-׿]/.test(s);
const km = (n: number) => Math.round(n).toLocaleString("he-IL");
const gmailSearchUrl = (flight: Flight) => {
  const year = flight.flight_date.slice(0, 4);
  const query = [flight.flight_number, flight.origin, flight.destination, year]
    .filter(Boolean)
    .join(" ");
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`;
};
const openInGmail = (webUrl: string) => {
  const messageId = webUrl.match(/#(?:all|inbox)\/([^/?#]+)/)?.[1];
  if (!messageId) {
    window.location.assign(webUrl);
    return;
  }

  let appOpened = false;
  const onVisibilityChange = () => {
    if (document.hidden) appOpened = true;
  };
  document.addEventListener("visibilitychange", onVisibilityChange, { once: true });
  window.location.href = `googlegmail:///cv=${encodeURIComponent(messageId)}`;
  window.setTimeout(() => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (!appOpened) window.location.assign(webUrl);
  }, 900);
};
const tripOrder = (a: Flight, b: Flight) => {
  const dateOrder = b.flight_date.localeCompare(a.flight_date);
  if (dateOrder) return dateOrder;
  return (a.depart_time || "99:99").localeCompare(b.depart_time || "99:99");
};

/* Graticule: meridians and parallels every 20°, sampled finely enough that the
   horizon clip lands on a smooth curve. */
const GRATICULE: [number, number][][] = [];
for (let lon = -180; lon < 180; lon += 20) {
  const ring: [number, number][] = [];
  for (let lat = -80; lat <= 80; lat += 4) ring.push([lon, lat]);
  GRATICULE.push(ring);
}
for (let lat = -60; lat <= 60; lat += 20) {
  const ring: [number, number][] = [];
  for (let lon = -180; lon <= 180; lon += 4) ring.push([lon, lat]);
  GRATICULE.push(ring);
}

const greatCircleKm = (a: Airport, b: Airport) =>
  2 * 6371 * Math.asin(Math.sqrt(
    Math.sin((b.lat - a.lat) * DEG / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin((b.lng - a.lng) * DEG / 2) ** 2,
  ));

export default function Flights() {
  const navigate = useNavigate();
  const [airports, setAirports] = useState<Record<string, Airport>>({});
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [airline, setAirline] = useState("ALL");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Flight | null>(null);
  const [stats, setStats] = useState({ legs: 0, airports: 0, airlines: 0, km: 0 });
  const [page, setPage] = useState(0);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 720px)").matches);
  const [sheetStop, setSheetStop] = useState(1);
  const [openCode, setOpenCode] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const controlsRef = useRef<{
    in: () => void;
    out: () => void;
    reset: () => void;
    focus: (lat: number, lng: number) => void;
  } | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const selectedRef = useRef<Flight | null>(null);
  selectedRef.current = selected;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const sync = () => setIsMobile(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [ap, fl] = await Promise.all([
        supabase.from("airports").select("code,lat,lng,city"),
        supabase.from("flights").select("*").order("flight_date", { ascending: false }),
      ]);
      if (cancelled) return;
      if (ap.error || fl.error) {
        setError((ap.error || fl.error)?.message ?? "שגיאה בטעינת הטיסות");
      } else {
        const byCode: Record<string, Airport> = {};
        for (const a of (ap.data || []) as Airport[]) byCode[a.code] = a;
        setAirports(byCode);
        setFlights((fl.data || []) as Flight[]);
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const airlines = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of flights) counts.set(f.airline, (counts.get(f.airline) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [flights]);
  const colorFor = (name: string) => colorOf(name, airlines.indexOf(name));

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return flights.filter((f) => {
      if (airline !== "ALL" && f.airline !== airline) return false;
      if (!needle) return true;
      const haystack = [
        f.origin, f.destination, f.airline, f.flight_number,
        airports[f.origin]?.city, airports[f.destination]?.city,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(needle);
    }).sort(tripOrder);
  }, [flights, airline, query, airports]);

  useEffect(() => { setPage(0); }, [airline, query]);

  /* Destinations ranked by how often they appear on either end of a leg — the
     equivalent of the food map's city list. */
  const destinations = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of visible) {
      counts.set(f.origin, (counts.get(f.origin) || 0) + 1);
      counts.set(f.destination, (counts.get(f.destination) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([code, count]) => ({ code, count, city: airports[code]?.city || code }))
      .sort((a, b) => b.count - a.count);
  }, [visible, airports]);
  const maxDestination = destinations[0]?.count || 1;

  const insights = useMemo(() => {
    if (!visible.length) return null;
    const years = new Map<string, number>();
    for (const f of visible) {
      const year = f.flight_date.slice(0, 4);
      years.set(year, (years.get(year) || 0) + 1);
    }
    const busiest = [...years.entries()].sort((a, b) => b[1] - a[1])[0];
    const longest = visible
      .map((f) => ({
        f,
        d: airports[f.origin] && airports[f.destination] ? greatCircleKm(airports[f.origin], airports[f.destination]) : 0,
      }))
      .sort((a, b) => b.d - a.d)[0];
    const counts = new Map<string, number>();
    for (const f of visible) counts.set(f.airline, (counts.get(f.airline) || 0) + 1);
    const topAirline = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const dates = visible.map((f) => f.flight_date).sort();
    return {
      busiest,
      longest,
      topAirline,
      abroad: destinations.filter((d) => d.code !== "TLV").length,
      from: dates[0]?.slice(0, 4),
      to: dates[dates.length - 1]?.slice(0, 4),
    };
  }, [visible, airports, destinations]);

  const pageItems = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));

  /* Swipe through the pages, same gesture and direction as the food map's lists —
     a vertical-ish or short drag is left alone so scrolling still works. */
  /* Everything the modal shows about one airport, derived from the legs already
     in memory — no extra round trip for a detail view. */
  const airportDetail = useMemo(() => {
    if (!openCode) return null;
    const airport = airports[openCode];
    if (!airport) return null;
    const legs = flights
      .filter((f) => f.origin === openCode || f.destination === openCode)
      .sort(tripOrder);
    const carriers = new Map<string, number>();
    for (const leg of legs) carriers.set(leg.airline, (carriers.get(leg.airline) || 0) + 1);
    const home = airports.TLV;
    return {
      airport,
      legs,
      carriers: [...carriers.entries()].sort((a, b) => b[1] - a[1]),
      // Distance from home is the number that makes a code like JNB mean something.
      distance: home && openCode !== "TLV" ? greatCircleKm(home, airport) : null,
      first: legs[legs.length - 1]?.flight_date,
      last: legs[0]?.flight_date,
      arrivals: legs.filter((f) => f.destination === openCode).length,
      departures: legs.filter((f) => f.origin === openCode).length,
    };
  }, [openCode, airports, flights]);

  const openAirport = (code: string) => {
    setOpenCode(code);
    const airport = airports[code];
    if (airport) controlsRef.current?.focus(airport.lat, airport.lng);
  };

  // Escape closes the modal, the one shortcut a dialog is expected to have.
  useEffect(() => {
    if (!openCode) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenCode(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCode]);

  /* globe */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !visible.length) return;

    const groups = {
      grat: svg.querySelector("#fg-grat") as SVGGElement,
      land: svg.querySelector("#fg-land") as SVGGElement,
      arcs: svg.querySelector("#fg-arcs") as SVGGElement,
      apts: svg.querySelector("#fg-apts") as SVGGElement,
    };
    const discs = ["#fg-clip", "#fg-ocean", "#fg-rim"].map((id) => svg.querySelector(id) as SVGCircleElement);
    const view = { ...HOME };

    const project = (lat: number, lon: number) => {
      const p = lat * DEG;
      const l = (lon - view.lam) * DEG;
      const p0 = view.phi * DEG;
      const cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l);
      return {
        x: CX + view.r * Math.cos(p) * Math.sin(l),
        y: CY - view.r * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l)),
        v: cosc >= 0,
      };
    };
    const linePath = (points: [number, number][]) => {
      let d = "";
      let pen = false;
      for (const [lon, lat] of points) {
        const q = project(lat, lon);
        if (q.v) { d += (pen ? "L" : "M") + q.x.toFixed(1) + "," + q.y.toFixed(1); pen = true; }
        else pen = false;
      }
      return d;
    };
    // A ring crossing the horizon cannot be safely closed as a filled SVG path:
    // closing it through projected far-side points can wrap the fill around the
    // entire globe. Keep fully visible land filled; render horizon-crossing land
    // as coastline segments until it rotates fully into view.
    const polyPath = (points: [number, number][]) => {
      let d = "";
      let pen = false;
      let visibleCount = 0;
      for (let i = 0; i < points.length; i++) {
        const [lon, lat] = points[i];
        const q = project(lat, lon);
        if (q.v) {
          d += (pen ? "L" : "M") + q.x.toFixed(1) + "," + q.y.toFixed(1);
          pen = true;
          visibleCount += 1;
        } else {
          pen = false;
        }
      }
      if (!visibleCount) return { d: "", partial: false };
      return { d: visibleCount === points.length ? d + "Z" : d, partial: visibleCount !== points.length };
    };
    // Interpolate along the sphere, breaking the path wherever it crosses the horizon.
    const arcPath = (a: Airport, b: Airport) => {
      const la1 = a.lat * DEG, lo1 = a.lng * DEG, la2 = b.lat * DEG, lo2 = b.lng * DEG;
      const dd = 2 * Math.asin(Math.sqrt(
        Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2,
      ));
      if (!dd) return "";
      let d = "";
      let pen = false;
      for (let i = 0; i <= 72; i++) {
        const f = i / 72;
        const A = Math.sin((1 - f) * dd) / Math.sin(dd);
        const B = Math.sin(f * dd) / Math.sin(dd);
        const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
        const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
        const z = A * Math.sin(la1) + B * Math.sin(la2);
        const q = project(Math.atan2(z, Math.hypot(x, y)) / DEG, Math.atan2(y, x) / DEG);
        if (q.v) { d += (pen ? "L" : "M") + q.x.toFixed(1) + "," + q.y.toFixed(1); pen = true; }
        else pen = false;
      }
      return d;
    };

    const draw = () => {
      // The 400×400 viewBox is stretched to fill the stage, so anything meant to
      // be a fixed size on screen — labels, dots, line weights — has to be divided
      // by that scale or it balloons on a desktop-sized globe.
      const rect = svg.getBoundingClientRect();
      const u = 400 / (Math.min(rect.width, rect.height) || 400);

      discs.forEach((c) => c?.setAttribute("r", String(view.r)));
      groups.grat.textContent = "";
      groups.land.textContent = "";
      groups.arcs.textContent = "";
      groups.apts.textContent = "";

      for (const ring of GRATICULE) {
        const d = linePath(ring);
        if (d) groups.grat.appendChild(svgEl("path", { d, class: "fg-grat", "stroke-width": 0.7 * u }));
      }
      for (const ring of LAND) {
        const land = polyPath(ring);
        if (land.d) groups.land.appendChild(svgEl("path", {
          d: land.d,
          class: land.partial ? "fg-land fg-land-partial" : "fg-land",
          "stroke-width": 0.8 * u,
        }));
      }

      const used = new Set<string>();
      let distance = 0;
      const current = selectedRef.current;
      for (const leg of visible) {
        const from = airports[leg.origin];
        const to = airports[leg.destination];
        if (!from || !to) continue;
        used.add(leg.origin);
        used.add(leg.destination);
        distance += greatCircleKm(from, to);
        const d = arcPath(from, to);
        if (!d) continue;
        const isSelected = current?.id === leg.id;
        groups.arcs.appendChild(svgEl("path", {
          d,
          class: "fg-arc",
          stroke: colorFor(leg.airline),
          "stroke-width": (isSelected ? 3 : 1.4) * u,
          // Dimming the rest is what makes a single selected route readable inside a bundle.
          "stroke-opacity": isSelected ? 1 : current ? 0.2 : 0.6,
        }));
        // A 1px line is impossible to hit on a phone; a fat transparent twin catches the tap.
        const hit = svgEl("path", { d, class: "fg-hit", "stroke-width": 14 * u });
        hit.addEventListener("click", (event) => {
          event.stopPropagation();
          spin = false;
          setSelected(leg);
        });
        groups.arcs.appendChild(hit);
      }
      for (const code of used) {
        const airport = airports[code];
        const q = project(airport.lat, airport.lng);
        if (!q.v) continue;
        const isSelected = current?.origin === code || current?.destination === code;
        groups.apts.appendChild(svgEl("circle", {
          cx: q.x.toFixed(1),
          cy: q.y.toFixed(1),
          r: (isSelected ? 4.4 : 3) * u,
          fill: isSelected ? "#1a56c4" : "#4285f4",
          class: "fg-apt-dot",
          "stroke-width": 1.5 * u,
        }));
        // The dot itself is a target: tapping an airport on the globe should tell
        // you what it is, exactly like tapping its row in the list.
        const hitDot = svgEl("circle", { cx: q.x.toFixed(1), cy: q.y.toFixed(1), r: 9 * u, fill: "transparent", class: "fg-hit-dot" });
        hitDot.addEventListener("click", (event) => {
          event.stopPropagation();
          spin = false;
          setOpenCode(code);
        });
        groups.apts.appendChild(hitDot);
        const label = svgEl("text", {
          x: (q.x + 5 * u).toFixed(1),
          y: (q.y - 4.5 * u).toFixed(1),
          class: "fg-apt-label",
          "font-size": 11 * u,
          "stroke-width": 3 * u,
        });
        label.textContent = code;
        groups.apts.appendChild(label);
      }

      setStats({
        legs: visible.length,
        airports: used.size,
        airlines: new Set(visible.map((f) => f.airline)).size,
        km: Math.round(distance),
      });
    };
    drawRef.current = draw;

    /* interaction */
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let spin = true;
    let pinch = 0;
    const activePointers = new Set<number>();

    // The viewBox is 400×400 letterboxed inside the stage; map client pixels back into it.
    const local = (event: { clientX: number; clientY: number }): [number, number] => {
      const rect = svg.getBoundingClientRect();
      const scale = Math.min(rect.width, rect.height) / 400;
      return [
        (event.clientX - rect.left - (rect.width - 400 * scale) / 2) / scale,
        (event.clientY - rect.top - (rect.height - 400 * scale) / 2) / scale,
      ];
    };
    const onPointerDown = (event: PointerEvent) => {
      activePointers.add(event.pointerId);
      spin = false;
      svg.setPointerCapture(event.pointerId);
      if (activePointers.size > 1) {
        dragging = false;
        svg.classList.remove("fg-dragging");
        return;
      }
      dragging = true;
      svg.classList.add("fg-dragging");
      [lastX, lastY] = local(event);
    };
    const onPointerMove = (event: PointerEvent) => {
      // Touch browsers emit pointer movement and touch movement for a pinch.
      // Only touchmove may change the globe while two fingers are active.
      if (!dragging || activePointers.size !== 1) return;
      const [x, y] = local(event);
      view.lam -= (x - lastX) * 0.32;
      view.phi = Math.max(-88, Math.min(88, view.phi + (y - lastY) * 0.32));
      lastX = x;
      lastY = y;
      draw();
    };
    const onPointerUp = (event: PointerEvent) => {
      activePointers.delete(event.pointerId);
      dragging = false;
      svg.classList.remove("fg-dragging");
    };
    const zoom = (factor: number) => {
      view.r = Math.max(110, Math.min(260, view.r * factor));
      draw();
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      spin = false;
      zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      const [a, b] = [event.touches[0], event.touches[1]];
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinch) zoom(distance / pinch);
      pinch = distance;
      spin = false;
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinch = 0;
    };

    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("pointercancel", onPointerUp);
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("touchmove", onTouchMove, { passive: false });
    svg.addEventListener("touchend", onTouchEnd);

    controlsRef.current = {
      in: () => { spin = false; zoom(1.35); },
      out: () => { spin = false; zoom(1 / 1.35); },
      reset: () => {
        Object.assign(view, HOME);
        spin = true;
        setSelected(null);
        draw();
      },
      focus: (lat: number, lng: number) => {
        spin = false;
        view.r = HOME.r;
        view.lam = lng;
        view.phi = Math.max(-70, Math.min(70, lat));
        draw();
      },
    };

    const reduceMotion = matchMedia("(prefers-reduced-motion:reduce)").matches;
    let frame = 0;
    const tick = () => {
      if (spin && !dragging) { view.lam -= 0.05; draw(); }
      frame = requestAnimationFrame(tick);
    };

    draw();
    if (!reduceMotion) frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      svg.removeEventListener("pointerdown", onPointerDown);
      svg.removeEventListener("pointermove", onPointerMove);
      svg.removeEventListener("pointerup", onPointerUp);
      svg.removeEventListener("pointercancel", onPointerUp);
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("touchmove", onTouchMove);
      svg.removeEventListener("touchend", onTouchEnd);
      drawRef.current = () => {};
      controlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, airports]);

  // Selection only changes stroke weights, so nudge the existing renderer
  // rather than rebuilding the whole globe.
  useEffect(() => { drawRef.current(); }, [selected]);

  const focusLeg = (leg: Flight) => {
    setSelected(leg);
    const from = airports[leg.origin];
    const to = airports[leg.destination];
    // Let React paint the detail sheet before rebuilding the SVG globe. Doing the
    // expensive draw inside the tap handler made mobile taps feel ignored.
    if (from && to) requestAnimationFrame(() => {
      controlsRef.current?.focus((from.lat + to.lat) / 2, (from.lng + to.lng) / 2);
    });
  };

  const sheetHeight = ["24dvh", "52dvh", "86dvh"][sheetStop];
  const isEmpty = loaded && !error && !flights.length;

  const detail = selected && ([
    ["טיסה", selected.flight_number],
    ["תאריך", dateLabel(selected.flight_date)],
    ["המראה", selected.depart_time],
    ["נחיתה", selected.arrive_time],
    ["משך", selected.duration],
    ["מחיר", selected.fare_note],
  ] as [string, string | null][]).map(([label, value]) => [label, value || "—"] as [string, string]);

  return (
    <div style={S.shell} dir="rtl">
      <style>{CSS}</style>

      <div style={{ ...S.stage, ...(isMobile ? { paddingRight: 0, bottom: sheetHeight } : null) }}>
        <svg ref={svgRef} id="fg-sky" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid meet">
          <defs>
            <radialGradient id="fg-ocean-grad" cx=".38" cy=".32" r=".8">
              <stop offset="0" stopColor="#e8f0fb" />
              <stop offset=".6" stopColor="#d3e2f6" />
              <stop offset="1" stopColor="#b9cfec" />
            </radialGradient>
            <clipPath id="fg-disc"><circle id="fg-clip" cx="200" cy="200" r="150" /></clipPath>
          </defs>
          <circle id="fg-ocean" cx="200" cy="200" r="150" fill="url(#fg-ocean-grad)" />
          <g clipPath="url(#fg-disc)">
            <g id="fg-grat" />
            <g id="fg-land" />
            <g id="fg-arcs" />
            <g id="fg-apts" />
          </g>
          <circle id="fg-rim" cx="200" cy="200" r="150" fill="none" stroke="rgba(26,86,196,0.18)" strokeWidth=".9" pointerEvents="none" />
        </svg>
      </div>

      <button
        onClick={() => navigate("/")}
        style={{ ...S.appBack, ...(isMobile ? S.appBackMobile : null) }}
        aria-label="חזרה לאפליקציה"
        title="חזרה לאפליקציה"
      >
        <ArrowRight size={23} strokeWidth={2.4} aria-hidden="true" />
      </button>

      <div
        style={{ ...S.controlDock, ...(isMobile ? { bottom: `calc(${sheetHeight} + 14px)` } : null) }}
        aria-label="פקדי גלובוס"
      >
        <button onClick={() => controlsRef.current?.in()} style={S.controlButton} aria-label="התקרבות" title="התקרבות">
          <Plus size={22} strokeWidth={2.1} aria-hidden="true" />
        </button>
        <span style={S.controlDivider} />
        <button onClick={() => controlsRef.current?.out()} style={S.controlButton} aria-label="התרחקות" title="התרחקות">
          <Minus size={22} strokeWidth={2.1} aria-hidden="true" />
        </button>
        <span style={S.controlDivider} />
        <button onClick={() => controlsRef.current?.reset()} style={S.controlButton} aria-label="איפוס התצוגה" title="איפוס התצוגה">
          <RotateCcw size={20} strokeWidth={2.1} aria-hidden="true" />
        </button>
      </div>

      {!isMobile && <div style={S.spinHint}>גררו לסיבוב · הקישו על קו טיסה</div>}

      <aside dir="rtl" style={{ ...S.panel, ...(isMobile ? { ...S.panelMobile, height: sheetHeight } : null) }}>
        {isMobile && (
          <button
            type="button"
            style={S.sheetHandle}
            aria-label="שינוי גובה החלונית"
            onClick={() => setSheetStop((stop) => (stop + 1) % 3)}
          >
            <span style={S.sheetHandleBar} />
          </button>
        )}

        <div style={{ ...S.panelScroll, ...(isMobile ? S.panelScrollMobile : null) }}>
          <div style={S.head}>
            <div style={S.title}>יומן טיסות ✈️</div>
            {loaded && !isEmpty && !error && (
              <>
                <div style={S.subtitle}>
                  {stats.legs} קטעי טיסה · {stats.airports} שדות תעופה
                  {insights ? ` · ${ltr(`${insights.from} → ${insights.to}`)}` : ""}
                </div>

                <div style={S.bigStats}>
                  <Big value={km(stats.km)} label="קילומטרים" />
                  <Big value={String(stats.legs)} label="קטעי טיסה" />
                  <Big value={String(stats.airlines)} label="חברות" />
                </div>
              </>
            )}

            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="חפש יעד, חברה או מספר טיסה"
              style={S.search}
            />

            <div style={S.filterChips}>
              <button
                aria-pressed={airline === "ALL"}
                onClick={() => { setAirline("ALL"); setSelected(null); }}
                style={{ ...S.filterChip, ...(airline === "ALL" ? S.filterChipOn : null) }}
              >
                כל החברות
              </button>
              {airlines.map((name) => (
                <button
                  key={name}
                  aria-pressed={airline === name}
                  onClick={() => { setAirline(airline === name ? "ALL" : name); setSelected(null); }}
                  style={{ ...S.filterChip, ...(airline === name ? S.filterChipOn : null) }}
                >
                  <span style={{ ...S.chipDot, background: colorFor(name) }} />
                  {name}
                </button>
              ))}
            </div>
          </div>

          {/* Supabase errors come back in English; without the LRM the Latin text
              and its punctuation get reordered by the surrounding RTL context. */}
          {error && (
            <div style={S.error}>
              שגיאה בטעינת הנתונים: <span dir="ltr" style={S.errorDetail}>{ltr(error)}</span>
            </div>
          )}
          {isEmpty && (
            <div style={S.empty}>
              <div style={S.emptyTitle}>עוד אין טיסות ביומן</div>
              <div style={S.emptyBody}>
                היומן נבנה מהזמנות הטיסה שאותרו בתיבת המייל. אחרי הייבוא הבא הטיסות שלך יופיעו כאן ועל הגלובוס.
              </div>
            </div>
          )}
          {!loaded && !error && (
            <div style={S.skeletonWrap}>
              {[1, 2, 3, 4].map((item) => <div key={item} style={S.skeletonRow} />)}
            </div>
          )}

          {insights && (
            <>
              <div style={S.sectionCap}>מה גיליתי?</div>
              <div style={S.insightGrid}>
                <div style={S.insightCard}>
                  <b>{insights.topAirline?.[0]}</b>
                  <span style={S.insightNote}>החברה המובילה · {insights.topAirline?.[1]} טיסות</span>
                </div>
                <div style={S.insightCard}>
                  <b dir="ltr">{insights.busiest?.[0]}</b>
                  <span style={S.insightNote}>השנה העמוסה · {insights.busiest?.[1]} טיסות</span>
                </div>
                <div style={S.insightCard}>
                  <b dir="ltr">{ltr(`${insights.longest?.f.origin} → ${insights.longest?.f.destination}`)}</b>
                  <span style={S.insightNote}>הקו הארוך · {km(insights.longest?.d || 0)} ק״מ</span>
                </div>
                <div style={S.insightCard}>
                  <b>{insights.abroad}</b>
                  <span style={S.insightNote}>יעדים מחוץ לתל אביב</span>
                </div>
              </div>
            </>
          )}

          {destinations.length > 0 && (
            <>
              <div style={S.sectionCap}>
                יעדים
                <span style={S.sectionCapDim}> · לפי מספר טיסות</span>
              </div>
              <div>
                {destinations.map((destination) => (
                  <button
                    key={destination.code}
                    style={S.cityRow}
                    onClick={() => openAirport(destination.code)}
                    aria-haspopup="dialog"
                  >
                    <div style={S.cityTop}>
                      <span style={S.cityName}>{destination.city}</span>
                      <span style={S.cityCode} dir="ltr">{destination.code}</span>
                    </div>
                    <div style={S.barTrack}>
                      <div style={{ ...S.barFill, width: `${Math.max(2, (destination.count / maxDestination) * 100)}%` }} />
                    </div>
                    <div style={S.cityMeta}>{destination.count} טיסות</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {loaded && !isEmpty && (
            <>
              <div style={S.sectionCap}>
                {visible.length} טיסות
                <span style={S.sectionCapDim}> · מהאחרונה לראשונה</span>
              </div>
              <div style={S.pagedSection}>
                {pageItems.map((leg) => (
                  <button
                    key={leg.id}
                    onClick={() => focusLeg(leg)}
                    style={{ ...S.spotRow, ...(selected?.id === leg.id ? S.spotRowOn : null) }}
                  >
                    <span style={{ ...S.spotDot, background: colorFor(leg.airline) }} />
                    <span style={S.spotMain}>
                      <span style={S.spotName} dir="ltr">{ltr(`${leg.origin} → ${leg.destination}`)}</span>
                      <span style={S.spotCity}>{leg.airline} · {airports[leg.destination]?.city}</span>
                    </span>
                    <span style={S.spotRight}>
                      <span style={S.spotDate} dir="ltr">{dateLabel(leg.flight_date)}</span>
                      <span style={S.spotMeta} dir={hasHebrew(leg.duration || "") ? "rtl" : "ltr"}>
                        {leg.duration || leg.flight_number || ""}
                      </span>
                    </span>
                  </button>
                ))}
                {visible.length === 0 && <div style={S.loading}>אין תוצאות</div>}
                {totalPages > 1 && (
                  <div style={S.pagination}>
                    {Array.from({ length: totalPages }, (_, index) => (
                      <button
                        key={index}
                        onClick={() => setPage(index)}
                        aria-label={`עמוד ${index + 1}`}
                        aria-current={page === index}
                        style={{ ...S.paginationDot, ...(page === index ? S.paginationDotActive : null) }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {selected && detail && (
          <section style={{ ...S.detailPane, ...(isMobile ? S.detailPaneMobile : null) }} aria-label="פרטי טיסה">
            <header style={S.detailHeader}>
              <button onClick={() => setSelected(null)} style={S.detailBack} aria-label="חזרה לרשימה">
                <span aria-hidden="true">→</span>
                חזרה לרשימה
              </button>
              <button onClick={() => setSelected(null)} style={S.detailClose} aria-label="סגור פרטי טיסה">×</button>
            </header>
            <div style={S.detailScroll}>
              <div style={S.detailRoute} dir="ltr">{ltr(`${selected.origin} → ${selected.destination}`)}</div>
              <div style={S.detailSub}>
                {airports[selected.origin]?.city} ← {airports[selected.destination]?.city}
              </div>
              <div style={S.detailAirline}>
                <span style={{ ...S.chipDot, background: colorFor(selected.airline) }} />
                {selected.airline}
              </div>
              <div style={S.detailGrid}>
                {detail.map(([label, value]) => (
                  <div key={label}>
                    <div style={S.smallLabel}>{label}</div>
                    <div style={S.smallValue} dir={hasHebrew(value) ? "rtl" : "ltr"}>{value}</div>
                  </div>
                ))}
              </div>
              {selected.source && SOURCE_NOTE[selected.source] && (
                <div style={S.sourceNote}>{SOURCE_NOTE[selected.source]}</div>
              )}
              <button
                type="button"
                onClick={() => openInGmail(selected.email_url || gmailSearchUrl(selected))}
                style={S.emailLink}
              >
                {selected.email_url ? "פתיחת המייל המקורי ב־Gmail" : "חיפוש אישור הטיסה ב־Gmail"}
              </button>
            </div>
          </section>
        )}
      </aside>

      {airportDetail && (
        <div style={S.modalScrim} onClick={() => setOpenCode(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={airportDetail.airport.city}
            dir="rtl"
            style={{ ...S.modal, ...(isMobile ? S.modalMobile : null) }}
            onClick={(event) => event.stopPropagation()}
          >
            <header style={S.modalHead}>
              <div>
                <div style={S.modalTitle}>{airportDetail.airport.city}</div>
                <div style={S.modalSub} dir="ltr">
                  {ltr(`${airportDetail.airport.code} · ${airportDetail.airport.lat.toFixed(2)}, ${airportDetail.airport.lng.toFixed(2)}`)}
                </div>
              </div>
              <button onClick={() => setOpenCode(null)} style={S.detailClose} aria-label="סגירה">×</button>
            </header>

            <div style={S.modalBody}>
              <div style={S.modalStats}>
                <Big value={String(airportDetail.legs.length)} label="טיסות" />
                <Big value={String(airportDetail.arrivals)} label="נחיתות" />
                <Big value={String(airportDetail.departures)} label="המראות" />
                <Big
                  value={airportDetail.distance == null ? "—" : km(airportDetail.distance)}
                  label={airportDetail.distance == null ? "בית" : "ק״מ מתל אביב"}
                />
              </div>

              <div style={S.modalMeta}>
                {airportDetail.first === airportDetail.last
                  ? `ביקור אחד · ${dateLabel(airportDetail.first || "")}`
                  : `${dateLabel(airportDetail.first || "")} ← ${dateLabel(airportDetail.last || "")}`}
              </div>

              <div style={S.modalCarriers}>
                {airportDetail.carriers.map(([name, count]) => (
                  <span key={name} style={S.modalCarrier}>
                    <span style={{ ...S.chipDot, background: colorFor(name) }} />
                    {name} · {count}
                  </span>
                ))}
              </div>

              <div style={S.modalListCap}>כל הטיסות דרך {airportDetail.airport.code}</div>
              <div style={S.modalList}>
                {airportDetail.legs.map((leg) => (
                  <button
                    key={leg.id}
                    style={S.modalRow}
                    onClick={() => { setOpenCode(null); focusLeg(leg); }}
                  >
                    <span style={{ ...S.spotDot, background: colorFor(leg.airline) }} />
                    <span style={S.spotMain}>
                      <span style={S.spotName} dir="ltr">{ltr(`${leg.origin} → ${leg.destination}`)}</span>
                      <span style={S.spotCity}>{leg.airline}{leg.flight_number ? ` · ${leg.flight_number}` : ""}</span>
                    </span>
                    <span style={S.spotDate} dir="ltr">{dateLabel(leg.flight_date)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Big({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div style={S.bigValue}>{value}</div>
      <div style={S.bigLabel}>{label}</div>
    </div>
  );
}

/* Class-based rules for the nodes the renderer creates imperatively. */
const CSS = `
#fg-sky{width:100%;height:100%;display:block;cursor:grab;touch-action:none}
#fg-sky.fg-dragging{cursor:grabbing}
.fg-grat{fill:none;stroke:rgba(26,52,92,.10)}
.fg-land{fill:#f3f1ea;stroke:#d8d3c4;stroke-linejoin:round}
.fg-land-partial{fill:none}
.fg-arc{fill:none;stroke-linecap:round}
.fg-hit{fill:none;stroke:transparent;cursor:pointer}
.fg-hit-dot{cursor:pointer}
.fg-apt-dot{stroke:#fff}
.fg-apt-label{font-weight:800;letter-spacing:.03em;fill:#26303f;direction:ltr;
  paint-order:stroke;stroke:rgba(255,255,255,.92);stroke-linejoin:round}
`;

const S: Record<string, React.CSSProperties> = {
  shell: {
    position: "fixed",
    inset: 0,
    fontFamily: "'Assistant', 'Rubik', system-ui, sans-serif",
    background: "#eef1f6",
    overflow: "hidden",
  },
  // Desktop reserves the panel's column so the globe never sits half-hidden behind it.
  stage: { position: "absolute", inset: 0, paddingRight: 360 },

  appBack: {
    position: "absolute",
    top: 18,
    right: 372,
    zIndex: 14,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "#fff",
    width: 48,
    height: 48,
    borderRadius: 16,
    padding: 0,
    display: "inline-grid",
    placeItems: "center",
    color: "#1f2430",
    cursor: "pointer",
    boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
  },
  appBackMobile: { top: "max(12px, env(safe-area-inset-top))", right: 12, minHeight: 44 },

  controlDock: {
    position: "absolute",
    left: 12,
    bottom: 18,
    zIndex: 12,
    width: 50,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    overflow: "hidden",
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 16,
    background: "rgba(255,255,255,0.96)",
    boxShadow: "0 6px 20px rgba(0,0,0,0.2)",
    backdropFilter: "blur(12px)",
  },
  controlButton: {
    width: 48,
    height: 48,
    display: "grid",
    placeItems: "center",
    border: "none",
    background: "transparent",
    padding: 0,
    cursor: "pointer",
    color: "#1a56c4",
  },
  controlDivider: { width: 28, height: 1, background: "#e4e7ec" },
  spinHint: { position: "absolute", bottom: 26, left: 74, zIndex: 12, fontSize: 12, color: "#6d7481", pointerEvents: "none" },

  // Right-hand side: this is a Hebrew, right-to-left app, so the panel sits
  // where an RTL reader starts.
  panel: {
    position: "absolute",
    top: 14,
    right: 14,
    bottom: 14,
    width: 344,
    display: "flex",
    flexDirection: "column",
    background: "#fff",
    borderRadius: 14,
    boxShadow: "0 14px 44px rgba(5,7,13,0.34)",
    overflow: "hidden",
    zIndex: 10,
  },
  panelMobile: {
    top: "auto",
    right: 0,
    left: 0,
    bottom: 0,
    width: "100%",
    borderRadius: "24px 24px 0 0",
    boxShadow: "0 -12px 36px rgba(5,7,13,0.24)",
    transition: "height 320ms cubic-bezier(0.22, 1, 0.36, 1)",
  },
  sheetHandle: {
    position: "absolute",
    top: 0,
    left: "50%",
    width: 72,
    height: 30,
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    padding: 0,
    background: "transparent",
    zIndex: 24,
    cursor: "pointer",
  },
  sheetHandleBar: { display: "block", width: 38, height: 5, borderRadius: 999, background: "#d5d9e0", pointerEvents: "none" },
  panelScroll: { flex: 1, overflowY: "auto" },
  panelScrollMobile: { paddingTop: 12, paddingBottom: "max(12px, env(safe-area-inset-bottom))", overscrollBehavior: "contain" },

  head: { padding: "16px 16px 12px", borderBottom: "1px solid #eceef2" },
  title: { fontSize: 21, fontWeight: 800, color: "#12141a", letterSpacing: "-0.01em" },
  subtitle: { fontSize: 11.5, color: "#8b929d", marginTop: 3 },

  bigStats: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, margin: "14px 0 12px" },
  bigValue: { fontSize: 19, fontWeight: 800, color: "#12141a", direction: "ltr" },
  bigLabel: { fontSize: 10, color: "#9aa1ac", marginTop: 2, letterSpacing: "0.02em" },

  search: {
    width: "100%",
    height: 44,
    marginTop: 10,
    borderRadius: 9,
    border: "1px solid #e2e5ea",
    background: "#f7f8fa",
    padding: "0 11px",
    fontSize: 16,
    outline: "none",
    boxSizing: "border-box",
  },
  filterChips: { display: "flex", gap: 7, marginTop: 10, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 2 },
  filterChip: {
    minHeight: 44,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    border: "1px solid #dfe4ec",
    borderRadius: 999,
    background: "#fff",
    padding: "0 12px",
    color: "#59616d",
    fontSize: 13,
    fontWeight: 750,
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  },
  filterChipOn: { borderColor: "#4285f4", background: "#eaf2ff", color: "#1a56c4" },
  chipDot: { width: 8, height: 8, borderRadius: 999, flexShrink: 0, display: "inline-block" },

  sectionCap: { padding: "14px 16px 6px", fontSize: 9.5, fontWeight: 800, color: "#9aa1ac", letterSpacing: "0.08em" },
  sectionCapDim: { fontWeight: 600, color: "#b6bcc5" },

  insightGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, padding: "4px 16px 12px" },
  insightCard: {
    minWidth: 0,
    padding: "10px 11px",
    borderRadius: 11,
    background: "#f7f8fa",
    border: "1px solid #eceef2",
    display: "flex",
    flexDirection: "column",
    gap: 3,
    textAlign: "right",
    fontSize: 13,
    fontWeight: 800,
    color: "#12141a",
  },
  insightNote: { fontSize: 10.5, fontWeight: 600, color: "#8b929d" },

  cityRow: {
    display: "block",
    width: "100%",
    padding: "9px 16px 10px",
    border: "none",
    borderBottom: "1px solid #f4f5f8",
    background: "transparent",
    textAlign: "right",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  cityTop: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  cityName: { fontSize: 13, fontWeight: 700, color: "#12141a" },
  cityCode: { fontSize: 12, fontWeight: 800, color: "#6d7481" },
  barTrack: { height: 3, background: "#eef0f4", borderRadius: 999, marginTop: 5 },
  barFill: { height: 3, background: "#4285f4", borderRadius: 999 },
  cityMeta: { fontSize: 10, color: "#a3a9b3", marginTop: 4, textAlign: "left" },

  spotRow: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    width: "100%",
    border: "none",
    background: "transparent",
    padding: "10px 16px",
    cursor: "pointer",
    textAlign: "right",
    fontFamily: "inherit",
    touchAction: "manipulation",
    WebkitTapHighlightColor: "transparent",
  },
  spotRowOn: { background: "#edf4ff" },
  spotDot: { width: 8, height: 8, borderRadius: 999, flexShrink: 0 },
  spotMain: { flex: 1, minWidth: 0 },
  spotName: { display: "block", fontSize: 13, fontWeight: 800, color: "#12141a" },
  spotCity: { display: "block", fontSize: 10, color: "#a3a9b3", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  spotRight: { textAlign: "left", flexShrink: 0 },
  spotDate: { display: "block", fontSize: 12.5, fontWeight: 800, color: "#12141a" },
  spotMeta: { display: "block", fontSize: 10, color: "#a3a9b3" },

  pagedSection: { touchAction: "pan-y" },
  pagination: { minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "8px 16px 10px" },
  paginationDot: {
    width: 8,
    height: 8,
    padding: 0,
    border: "none",
    borderRadius: 999,
    background: "#cfd5df",
    cursor: "pointer",
    transition: "width 180ms ease, background 180ms ease",
  },
  paginationDotActive: { width: 22, background: "#4285f4" },

  detailPane: {
    position: "absolute",
    inset: 0,
    zIndex: 20,
    display: "flex",
    flexDirection: "column",
    background: "#fff",
    borderRadius: 14,
    overflow: "hidden",
  },
  detailPaneMobile: { borderRadius: "24px 24px 0 0" },
  detailHeader: {
    flexShrink: 0,
    minHeight: 58,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 14px 8px",
    borderBottom: "1px solid #eceef2",
  },
  detailBack: {
    minHeight: 44,
    border: "none",
    background: "transparent",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    color: "#1a56c4",
    fontSize: 15,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  detailClose: { width: 44, height: 44, border: "none", background: "transparent", color: "#8b929d", fontSize: 25, cursor: "pointer" },
  detailScroll: { flex: 1, overflowY: "auto", padding: "18px 20px max(20px, env(safe-area-inset-bottom))" },
  detailRoute: { fontSize: 30, lineHeight: 1.1, fontWeight: 850, color: "#1a56c4" },
  detailSub: { marginTop: 6, fontSize: 14, color: "#8b929d" },
  detailAirline: { marginTop: 12, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800, color: "#12141a" },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 14,
    marginTop: 18,
    paddingTop: 16,
    borderTop: "1px solid #eceef2",
  },
  sourceNote: { marginTop: 16, fontSize: 11, lineHeight: 1.5, color: "#8b929d" },
  emailLink: {
    display: "flex",
    width: "100%",
    minHeight: 48,
    marginTop: 14,
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    border: "1px solid #b9cff5",
    borderRadius: 12,
    background: "#edf4ff",
    color: "#1a56c4",
    fontSize: 15,
    fontWeight: 800,
    fontFamily: "inherit",
    cursor: "pointer",
    textDecoration: "none",
    touchAction: "manipulation",
    WebkitTapHighlightColor: "transparent",
  },
  smallValue: { fontSize: 13.5, fontWeight: 800, color: "#12141a" },
  smallLabel: { fontSize: 9.5, color: "#9aa1ac", marginBottom: 3, letterSpacing: "0.06em", fontWeight: 800 },

  modalScrim: {
    position: "absolute",
    inset: 0,
    zIndex: 30,
    background: "rgba(12,16,24,0.42)",
    display: "grid",
    placeItems: "center",
    padding: 16,
  },
  modal: {
    width: "min(440px, 100%)",
    maxHeight: "min(80vh, 640px)",
    display: "flex",
    flexDirection: "column",
    background: "#fff",
    borderRadius: 16,
    overflow: "hidden",
    boxShadow: "0 24px 60px rgba(5,7,13,0.4)",
  },
  // On a phone it reads better as a sheet rising from the bottom than a floating card.
  modalMobile: { alignSelf: "end", width: "100%", maxHeight: "82dvh", borderRadius: "20px 20px 0 0" },
  modalHead: {
    flexShrink: 0,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
    padding: "16px 18px 12px",
    borderBottom: "1px solid #eceef2",
  },
  modalTitle: { fontSize: 22, fontWeight: 850, color: "#12141a", letterSpacing: "-0.01em" },
  modalSub: { marginTop: 4, fontSize: 11.5, color: "#8b929d" },
  modalBody: { flex: 1, overflowY: "auto", padding: "14px 18px max(18px, env(safe-area-inset-bottom))" },
  modalStats: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 },
  modalMeta: { marginTop: 14, fontSize: 12, color: "#6d7481" },
  modalCarriers: { display: "flex", flexWrap: "wrap", gap: 7, marginTop: 12 },
  modalCarrier: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    background: "#f7f8fa",
    border: "1px solid #eceef2",
    fontSize: 11.5,
    fontWeight: 750,
    color: "#59616d",
  },
  modalListCap: { padding: "16px 0 4px", fontSize: 9.5, fontWeight: 800, color: "#9aa1ac", letterSpacing: "0.08em" },
  modalList: { borderTop: "1px solid #eceef2" },
  modalRow: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    width: "100%",
    border: "none",
    borderBottom: "1px solid #f4f5f8",
    background: "transparent",
    padding: "10px 2px",
    cursor: "pointer",
    textAlign: "right",
    fontFamily: "inherit",
  },

  skeletonWrap: { padding: "10px 16px" },
  skeletonRow: { height: 54, marginBottom: 8, borderRadius: 10, background: "#f0f2f5" },
  loading: { padding: 16, fontSize: 13, color: "#8b929d" },
  error: { padding: 16, fontSize: 13, color: "#b91c1c" },
  errorDetail: { display: "inline-block", unicodeBidi: "isolate" },
  empty: { padding: "24px 16px", textAlign: "center" },
  emptyTitle: { fontSize: 15, fontWeight: 600, color: "#2b3140", marginBottom: 6 },
  emptyBody: { fontSize: 13, lineHeight: 1.6, color: "#6d7481" },
};
