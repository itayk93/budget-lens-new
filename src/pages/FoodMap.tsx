import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { Map as MapLibreMap } from "maplibre-gl";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Crosshair, Earth, Map as MapIcon, Search } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import { supabase } from "@/integrations/supabase/client";
// Without this, every Hebrew and Arabic label on the map renders letter-reversed.
// Bundled rather than pulled from a CDN so the map keeps working offline.
import rtlTextPluginUrl from "@mapbox/mapbox-gl-rtl-text/mapbox-gl-rtl-text.min.js?url";

type Place = {
  name: string;
  lat: number;
  lng: number;
  city: string;
  country: string;
  address: string;
  category: string;
  visits: number;
  total: number;
  currency: string;
  first: string;
  last: string;
  txns?: { date: string; amount: number; method: string }[];
  mock: boolean;
};

type Feed = {
  generated_at: string;
  provider?: "mock" | "osm" | "google";
  mock: boolean;
  merchant_count?: number;
  not_found?: number;
  place_count: number;
  visit_count: number;
  total_spent: number;
  places: Place[];
};

/* Spend buckets. Everything on the map is one blue ramp — darker and bigger
   means more money, the way the original does it. Category never colours a dot. */
const BUCKETS = [
  { min: 0, color: "#a8c7f0", label: "< ₪90" },
  { min: 90, color: "#7aa9e8", label: "₪90+" },
  { min: 270, color: "#4285f4", label: "₪270+" },
  { min: 650, color: "#1a56c4", label: "₪650+" },
  { min: 1100, color: "#0b3d91", label: "₪1,100+" },
];

const STYLE_MAP = "https://tiles.openfreemap.org/styles/liberty";
const STYLE_GLOBE = "https://tiles.openfreemap.org/styles/fiord";
const HOME: { center: [number, number]; zoom: number } = { center: [34.78, 32.07], zoom: 10.5 };
const GLOBE_VIEW: { center: [number, number]; zoom: number } = { center: [20, 25], zoom: 1.35 };

const money = (n: number) => "₪" + Math.round(n).toLocaleString("he-IL");
const monthOf = (iso: string) => (iso || "").slice(0, 7);
const dateLabel = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
const placeKey = (place: Place) => `${place.lat.toFixed(5)}:${place.lng.toFixed(5)}`;
const ISRAEL_NAMES = new Set(["ישראל", "Israel", "ISRAEL"]);

function monthlySpend(place: Place) {
  const byMonth = new Map<string, number>();
  for (const txn of place.txns || []) {
    const month = monthOf(txn.date);
    byMonth.set(month, (byMonth.get(month) || 0) + txn.amount);
  }
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/* A line like "₪498 · 2×" is all weak/neutral characters, so it inherits the
   surrounding RTL direction and comes out as "2 · ₪498×". A leading LRM is a
   strong left-to-right character that pins the line to LTR. Isolates (U+2066/
   U+2069) also work in HTML but confuse the map's RTL shaper, which then
   reverses Latin place names too — so the map side must use this. */
const ltr = (s: string) => `‎${s}`;

const PAGE_SIZE = 5;

function useSwipePagination<T>(items: T[], pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    setPage(0);
  }, [items]);

  const previous = () => setPage((current) => Math.max(0, current - 1));
  const next = () => setPage((current) => Math.min(totalPages - 1, current + 1));

  return {
    page,
    totalPages,
    items: items.slice(page * pageSize, (page + 1) * pageSize),
    setPage,
    touchHandlers: {
      onTouchStart: (event: React.TouchEvent<HTMLDivElement>) => {
        const touch = event.touches[0];
        touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
      },
      onTouchEnd: (event: React.TouchEvent<HTMLDivElement>) => {
        const start = touchStart.current;
        const touch = event.changedTouches[0];
        touchStart.current = null;
        if (!start || !touch) return;
        const deltaX = touch.clientX - start.x;
        const deltaY = touch.clientY - start.y;
        if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
        if (deltaX < 0) previous();
        else next();
      },
      onTouchCancel: () => { touchStart.current = null; },
    },
  };
}

function PaginationDots({
  page,
  totalPages,
  onChange,
  label,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  label: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <div style={S.pagination} role="group" aria-label={label}>
      {Array.from({ length: totalPages }, (_, index) => (
        <button
          key={index}
          type="button"
          onClick={() => onChange(index)}
          style={{ ...S.paginationDot, ...(page === index ? S.paginationDotActive : null) }}
          aria-label={`עמוד ${index + 1} מתוך ${totalPages}`}
          aria-current={page === index ? "page" : undefined}
        />
      ))}
    </div>
  );
}

function bucketColor(total: number) {
  let c = BUCKETS[0].color;
  for (const b of BUCKETS) if (total >= b.min) c = b.color;
  return c;
}

function toGeoJson(places: Place[]) {
  return {
    type: "FeatureCollection" as const,
    features: places.map((p, i) => ({
      type: "Feature" as const,
      id: i,
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      properties: {
        idx: i,
        name: p.name,
        total: p.total,
        visits: p.visits,
        color: bucketColor(p.total),
        label: `${p.name}\n${ltr(`${money(p.total)} · ${p.visits}×`)}`,
      },
    })),
  };
}

export default function FoodMap() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [styleEpoch, setStyleEpoch] = useState(0); // bumps whenever layers are (re)added
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEmpty, setIsEmpty] = useState(false);
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<"all" | "year">("all");
  const [region, setRegion] = useState<"all" | "israel" | "abroad">("all");
  const [returningOnly, setReturningOnly] = useState(false);
  const [highSpendOnly, setHighSpendOnly] = useState(false);
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [viewportPlaceKeys, setViewportPlaceKeys] = useState<string[] | null>(null);
  const [searchAreaVisible, setSearchAreaVisible] = useState(false);
  const [areaFeedback, setAreaFeedback] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editLat, setEditLat] = useState("");
  const [editLng, setEditLng] = useState("");
  const [tab, setTab] = useState<"spots" | "heat">("spots");
  const [isGlobe, setIsGlobe] = useState(false);
  const [selected, setSelected] = useState<Place | null>(null);
  const [drillOpen, setDrillOpen] = useState(false);
  const [popupAt, setPopupAt] = useState<{ x: number; y: number } | null>(null);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 720px)").matches);
  const initialSheetHeight = Math.round(window.innerHeight * Number(localStorage.getItem("food-map-sheet-ratio") || 0.32));
  const [sheetHeightPx, setSheetHeightPx] = useState(initialSheetHeight);
  const [isSheetDragging, setIsSheetDragging] = useState(false);
  const sheetHeightRef = useRef(initialSheetHeight);
  const didDragSheetRef = useRef(false);
  const sheetDragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const panelTouchStartRef = useRef<number | null>(null);
  const previousMapViewRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const resultsListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const syncHeight = () => {
      if (sheetDragRef.current) return;
      const ratio = Number(localStorage.getItem("food-map-sheet-ratio") || 0.32);
      const next = Math.round(window.innerHeight * ratio);
      sheetHeightRef.current = next;
      setSheetHeightPx(next);
    };
    window.addEventListener("resize", syncHeight);
    return () => window.removeEventListener("resize", syncHeight);
  }, []);

  useEffect(() => {
    // The feed is personal spending data: it comes from an RLS-protected row
    // keyed by the signed-in user, never from a static file in /public.
    let cancelled = false;
    (async () => {
      try {
        const { data, error: queryError } = await supabase
          .from("food_map_feed")
          .select("feed")
          .maybeSingle();
        if (cancelled) return;
        if (queryError) throw queryError;
        // An owner with no feed row yet is an empty account, not a failure.
        if (!data?.feed) {
          setIsEmpty(true);
          return;
        }
        const nextFeed = data.feed as unknown as Feed;
        const saved = JSON.parse(localStorage.getItem("food-map-corrections") || "{}") as Record<string, Partial<Place>>;
        setFeed({
          ...nextFeed,
          places: nextFeed.places.map((place) => ({ ...place, ...(saved[placeKey(place)] || {}) })),
        });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filteredBeforeViewport = useMemo(() => {
    if (!feed) return [];
    const q = query.trim().toLocaleLowerCase();
    const newest = feed.places.map((p) => p.last).filter(Boolean).sort().pop() || "";
    const cutoff = newest ? `${Number(newest.slice(0, 4)) - 1}-${newest.slice(5, 7)}` : "";
    return feed.places.filter((place) => {
      if (q && ![place.name, place.city, place.country].some((value) =>
        String(value ?? "").toLocaleLowerCase().includes(q),
      )) return false;
      if (period === "year" && place.last < cutoff) return false;
      const inIsrael = ISRAEL_NAMES.has(place.country);
      if (region === "israel" && !inIsrael) return false;
      if (region === "abroad" && inIsrael) return false;
      if (returningOnly && place.visits < 2) return false;
      if (highSpendOnly && place.total < 500) return false;
      if (cityFilter && place.city !== cityFilter) return false;
      return true;
    });
  }, [feed, query, period, region, returningOnly, highSpendOnly, cityFilter]);

  const visible = useMemo(() => {
    if (!viewportPlaceKeys) return filteredBeforeViewport;
    const viewportKeys = new Set(viewportPlaceKeys);
    return filteredBeforeViewport.filter((place) => viewportKeys.has(placeKey(place)));
  }, [filteredBeforeViewport, viewportPlaceKeys]);

  const stats = useMemo(() => {
    const total = visible.reduce((s, p) => s + p.total, 0);
    const visits = visible.reduce((s, p) => s + p.visits, 0);
    const cities = new Set(visible.map((p) => p.city).filter(Boolean));
    const months = visible.flatMap((p) => [monthOf(p.first), monthOf(p.last)]).filter(Boolean).sort();
    return { total, visits, spots: visible.length, cities: cities.size, from: months[0], to: months[months.length - 1] };
  }, [visible]);

  const cityRows = useMemo(() => {
    const by = new Map<string, { city: string; total: number; spots: number; visits: number }>();
    for (const p of visible) {
      const key = p.city || p.country || "—";
      const row = by.get(key) || { city: key, total: 0, spots: 0, visits: 0 };
      row.total += p.total;
      row.spots += 1;
      row.visits += p.visits;
      by.set(key, row);
    }
    return [...by.values()].sort((a, b) => b.total - a.total);
  }, [visible]);

  const topSpots = useMemo(() => [...visible].sort((a, b) => b.total - a.total), [visible]);
  const cityPager = useSwipePagination(cityRows);
  const spotPager = useSwipePagination(topSpots);

  const insights = useMemo(() => {
    if (!visible.length) return null;
    const mostVisited = [...visible].sort((a, b) => b.visits - a.visits)[0];
    const largest = visible.flatMap((place) =>
      (place.txns || []).map((txn) => ({ ...txn, place: place.name })),
    ).sort((a, b) => b.amount - a.amount)[0];
    const months = new Set(visible.flatMap((place) => (place.txns || []).map((txn) => monthOf(txn.date))));
    const israelTotal = visible.filter((place) => ISRAEL_NAMES.has(place.country)).reduce((sum, place) => sum + place.total, 0);
    const abroadTotal = visible.reduce((sum, place) => sum + place.total, 0) - israelTotal;
    const newest = visible.map((place) => place.last).filter(Boolean).sort().pop() || "";
    const dormantCutoff = newest ? `${Number(newest.slice(0, 4)) - 1}-${newest.slice(5, 7)}` : "";
    const dormant = visible.filter((place) => place.last < dormantCutoff).length;
    return {
      topCity: cityRows[0],
      mostVisited,
      largest,
      monthlyAverage: months.size ? stats.total / months.size : 0,
      israelTotal,
      abroadTotal,
      dormant,
    };
  }, [visible, cityRows, stats.total]);

  // ---- map ----
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Must be set before the first map is constructed, and only once per page.
    if (maplibregl.getRTLTextPluginStatus() === "unavailable") {
      maplibregl.setRTLTextPlugin(rtlTextPluginUrl, false).catch(() => {
        /* labels stay reversed, but the map itself still works */
      });
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_MAP,
      center: HOME.center,
      zoom: HOME.zoom,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-left");

    // Re-runs on every style swap, since a new style drops all custom layers.
    map.on("style.load", () => {
      map.addSource("places", {
        type: "geojson",
        data: toGeoJson([]),
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 64,
        clusterProperties: {
          totalSpend: ["+", ["get", "total"]],
        },
      });

      map.addLayer({
        id: "places-heat",
        type: "heatmap",
        source: "places",
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "total"], 0, 0.05, 3000, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 8, 1, 16, 3],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 8, 18, 16, 55],
          "heatmap-opacity": 0.85,
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.2, "#cfe0ff",
            0.4, "#7aa9e8",
            0.6, "#4285f4",
            0.8, "#1a56c4",
            1, "#0b3d91",
          ],
        },
      });

      map.addLayer({
        id: "places-cluster-halo",
        type: "circle",
        source: "places",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "rgba(66,133,244,0.16)",
          "circle-blur": 0.18,
          "circle-radius": ["step", ["get", "point_count"], 24, 20, 29, 80, 34],
        },
      });

      map.addLayer({
        id: "places-cluster",
        type: "circle",
        source: "places",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#ffffff",
          "circle-opacity": 0.97,
          "circle-stroke-color": "#4285f4",
          "circle-stroke-width": 3,
          "circle-radius": ["step", ["get", "point_count"], 16, 20, 19, 80, 22],
        },
      });

      map.addLayer({
        id: "places-cluster-count",
        type: "symbol",
        source: "places",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 12.5,
          "text-font": ["Noto Sans Regular"],
        },
        paint: {
          "text-color": "#1a56c4",
          "text-halo-color": "rgba(255,255,255,0.9)",
          "text-halo-width": 0.6,
        },
      });

      map.addLayer({
        id: "places-dot",
        type: "circle",
        source: "places",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["get", "color"],
          "circle-opacity": 0.82,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1,
          "circle-stroke-opacity": 0.7,
          // sqrt-ish ramp: spend drives area, so a ₪3000 spot doesn't eat the screen
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            1, ["interpolate", ["linear"], ["sqrt", ["get", "total"]], 0, 2, 55, 7],
            10, ["interpolate", ["linear"], ["sqrt", ["get", "total"]], 0, 4, 55, 20],
            16, ["interpolate", ["linear"], ["sqrt", ["get", "total"]], 0, 7, 55, 34],
          ],
        },
      });

      map.addLayer({
        id: "places-label",
        type: "symbol",
        source: "places",
        filter: ["!", ["has", "point_count"]],
        minzoom: 11.5,
        layout: {
          "text-field": ["get", "label"],
          "text-size": 11,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-line-height": 1.15,
        },
        paint: { "text-color": "#1f2430", "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
      });

      setStyleEpoch((n) => n + 1);
    });

    for (const layer of ["places-dot", "places-cluster"]) {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    }

    map.on("moveend", () => setSearchAreaVisible(true));
    map.on("click", (event) => {
      const features = map.queryRenderedFeatures(event.point, {
        layers: ["places-dot", "places-cluster"],
      });
      if (features.length) return;
      setSelected(null);
      collapseSheet();
    });

    // The container only gets its real size after mount; without this the map is
    // born too small and renders in the corner.
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    return () => { observer.disconnect(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleEpoch) return;
    (map.getSource("places") as maplibregl.GeoJSONSource | undefined)?.setData(toGeoJson(visible) as never);
  }, [visible, styleEpoch]);

  // tab + globe both just toggle layer visibility / projection
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleEpoch) return;
    const heat = tab === "heat";
    map.setLayoutProperty("places-heat", "visibility", heat ? "visible" : "none");
    for (const id of ["places-dot", "places-label", "places-cluster-halo", "places-cluster", "places-cluster-count"]) {
      map.setLayoutProperty(id, "visibility", heat ? "none" : "visible");
    }
  }, [tab, styleEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleEpoch) return;
    map.setProjection({ type: isGlobe ? "globe" : "mercator" });
    if (isGlobe) {
      map.setSky({
        "sky-color": "#05070d",
        "sky-horizon-blend": 0.4,
        "horizon-color": "#22364f",
        "horizon-fog-blend": 0.6,
        "fog-color": "#0b1220",
        "fog-ground-blend": 0.6,
      });
    }
  }, [isGlobe, styleEpoch]);

  // Keep the popup glued to its dot while the map pans, zooms or spins.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selected) { setPopupAt(null); return; }
    const sync = () => {
      const p = map.project([selected.lng, selected.lat]);
      setPopupAt({ x: p.x, y: p.y });
    };
    sync();
    map.on("move", sync);
    map.on("resize", sync);
    return () => { map.off("move", sync); map.off("resize", sync); };
  }, [selected]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleEpoch) return;
    const onClusterClick = async (event: maplibregl.MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      const source = map.getSource("places") as maplibregl.GeoJSONSource | undefined;
      if (clusterId === undefined || !source) return;
      const zoom = await source.getClusterExpansionZoom(clusterId);
      const coordinates = (feature?.geometry as GeoJSON.Point | undefined)?.coordinates;
      if (coordinates) map.easeTo({ center: coordinates as [number, number], zoom });
    };
    map.on("click", "places-cluster", onClusterClick);
    return () => { map.off("click", "places-cluster", onClusterClick); };
  }, [styleEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleEpoch) return;
    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      const idx = e.features?.[0]?.properties?.idx;
      if (idx === undefined) return;
      const place = visible[Number(idx)];
      if (place) focusPlace(place);
    };
    map.on("click", "places-dot", onClick);
    return () => { map.off("click", "places-dot", onClick); };
  }, [visible, styleEpoch]);

  function mobileSheetStops() {
    const viewport = window.innerHeight;
    return [
      Math.max(132, Math.round(viewport * 0.22)),
      Math.round(viewport * 0.56),
      Math.round(viewport * 0.9),
    ];
  }

  function setSheetStop(stop: number) {
    sheetHeightRef.current = stop;
    setSheetHeightPx(stop);
    localStorage.setItem("food-map-sheet-ratio", String(stop / window.innerHeight));
    navigator.vibrate?.(8);
  }

  function collapseSheet() {
    if (!window.matchMedia("(max-width: 720px)").matches) return;
    setSheetStop(mobileSheetStops()[0]);
  }

  function expandPeekSheet() {
    const stops = mobileSheetStops();
    if (sheetHeightRef.current <= stops[0] + 12) setSheetStop(stops[1]);
  }

  function onPanelTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    if (!isMobile || sheetHeightRef.current > mobileSheetStops()[0] + 12) return;
    panelTouchStartRef.current = event.touches[0]?.clientY ?? null;
  }

  function onPanelTouchMove(event: React.TouchEvent<HTMLDivElement>) {
    const startY = panelTouchStartRef.current;
    if (startY === null) return;
    const currentY = event.touches[0]?.clientY ?? startY;
    if (startY - currentY < 16) return;
    event.preventDefault();
    panelTouchStartRef.current = null;
    expandPeekSheet();
  }

  function onPanelTouchEnd() {
    panelTouchStartRef.current = null;
  }

  function onPanelWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (event.deltaY <= 0 || sheetHeightRef.current > mobileSheetStops()[0] + 12) return;
    event.preventDefault();
    expandPeekSheet();
  }

  function cycleSheetHeight() {
    if (didDragSheetRef.current) {
      didDragSheetRef.current = false;
      return;
    }
    const stops = mobileSheetStops();
    const currentIndex = stops.reduce((best, stop, index) =>
      Math.abs(stop - sheetHeightRef.current) < Math.abs(stops[best] - sheetHeightRef.current) ? index : best,
    0);
    setSheetStop(stops[(currentIndex + 1) % stops.length]);
  }

  function onSheetPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (!isMobile) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsSheetDragging(true);
    sheetDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: sheetHeightRef.current,
    };
  }

  function onSheetPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = sheetDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const stops = mobileSheetStops();
    const min = stops[0];
    const max = stops[stops.length - 1];
    const delta = event.clientY - drag.startY;
    if (Math.abs(delta) > 4) didDragSheetRef.current = true;
    const next = Math.max(min, Math.min(max, drag.startHeight - delta));
    sheetHeightRef.current = next;
    setSheetHeightPx(next);
  }

  function onSheetPointerEnd(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = sheetDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    sheetDragRef.current = null;
    setIsSheetDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const stops = mobileSheetStops();
    const current = sheetHeightRef.current;
    const snapped = stops.reduce((closest, stop) =>
      Math.abs(stop - current) < Math.abs(closest - current) ? stop : closest,
    );
    setSheetStop(snapped);
  }

  function applySearchArea() {
    const bounds = mapRef.current?.getBounds();
    if (!bounds || !feed) return;
    const west = bounds.getWest();
    const east = bounds.getEast();
    const south = bounds.getSouth();
    const north = bounds.getNorth();
    const keys = filteredBeforeViewport
      .filter((place) => {
        const longitudeInside = west <= east
          ? place.lng >= west && place.lng <= east
          : place.lng >= west || place.lng <= east;
        return longitudeInside && place.lat >= south && place.lat <= north;
      })
      .map(placeKey);

    setViewportPlaceKeys(keys);
    setCityFilter(null);
    previousMapViewRef.current = null;
    setSelected(null);
    setSearchAreaVisible(false);
    setAreaFeedback(keys.length ? `נמצאו ${keys.length} מקומות באזור` : "לא נמצאו מקומות באזור הזה");
    if (isMobile) setSheetStop(mobileSheetStops()[1]);
    navigator.vibrate?.(8);
  }

  function clearViewportFilter() {
    setViewportPlaceKeys(null);
    setSearchAreaVisible(false);
    setAreaFeedback(null);
  }

  function showAreaResults() {
    if (!viewportPlaceKeys?.length) return;
    setAreaFeedback(null);
    setTab("spots");
    if (isMobile) setSheetStop(mobileSheetStops()[2]);
    window.setTimeout(() => resultsListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 180);
  }

  function focusCity(city: string) {
    const places = visible.filter((place) => place.city === city);
    if (!places.length) return;
    const map = mapRef.current;
    if (map && !cityFilter) {
      const center = map.getCenter();
      previousMapViewRef.current = { center: [center.lng, center.lat], zoom: map.getZoom() };
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const place of places) bounds.extend([place.lng, place.lat]);
    setCityFilter(city);
    setSelected(null);
    mapRef.current?.fitBounds(bounds, {
      padding: isMobile ? { top: 80, right: 28, bottom: Math.min(sheetHeightRef.current + 28, 420), left: 28 } : 80,
      maxZoom: 14,
      duration: 800,
    });
  }

  function clearCityFocus() {
    setCityFilter(null);
    setSelected(null);
    const previous = previousMapViewRef.current;
    previousMapViewRef.current = null;
    if (previous) {
      mapRef.current?.flyTo({ center: previous.center, zoom: previous.zoom, duration: 700, essential: true });
    } else {
      mapRef.current?.flyTo({ ...HOME, duration: 700, essential: true });
    }
  }

  function locateMe() {
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError("המיקום אינו נתמך במכשיר הזה");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => mapRef.current?.flyTo({ center: [coords.longitude, coords.latitude], zoom: 14, essential: true }),
      () => setLocationError("לא ניתן לקבל מיקום — בדוק הרשאת מיקום"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function openCorrection(place: Place) {
    setCorrectionOpen(true);
    setEditName(place.name);
    setEditCity(place.city);
    setEditLat(String(place.lat));
    setEditLng(String(place.lng));
  }

  function saveCorrection() {
    if (!selected || !feed) return;
    const corrected: Place = {
      ...selected,
      name: editName.trim() || selected.name,
      city: editCity.trim() || selected.city,
      lat: Number(editLat) || selected.lat,
      lng: Number(editLng) || selected.lng,
    };
    const corrections = JSON.parse(localStorage.getItem("food-map-corrections") || "{}") as Record<string, Partial<Place>>;
    corrections[placeKey(selected)] = {
      name: corrected.name,
      city: corrected.city,
      lat: corrected.lat,
      lng: corrected.lng,
    };
    localStorage.setItem("food-map-corrections", JSON.stringify(corrections));
    setFeed({ ...feed, places: feed.places.map((place) => placeKey(place) === placeKey(selected) ? corrected : place) });
    setSelected(corrected);
    setCorrectionOpen(false);
  }

  function focusPlace(place: Place) {
    setSelected(place);
    setDrillOpen(false);
    setCorrectionOpen(false);
    if (isMobile) setSheetStop(mobileSheetStops()[1]);
    if (isGlobe) toggleGlobe(false);
    // Nudge the target left of centre so the right-hand panel doesn't cover it.
    mapRef.current?.flyTo({
      center: [place.lng, place.lat],
      zoom: 15,
      padding: isMobile ? { right: 0, top: 0, bottom: 280, left: 0 } : { right: 360, top: 0, bottom: 0, left: 0 },
      speed: 1.1,
      essential: true,
    });
  }

  function toggleGlobe(next = !isGlobe) {
    const map = mapRef.current;
    if (!map) return;
    setIsGlobe(next);
    setSelected(null);
    // Style swap fires style.load, which re-adds the layers via styleEpoch.
    map.setStyle(next ? STYLE_GLOBE : STYLE_MAP);
    map.once("style.load", () => {
      map.flyTo({ ...(next ? GLOBE_VIEW : HOME), speed: 1.3, essential: true });
    });
  }

  const maxCityTotal = cityRows[0]?.total || 1;
  const isSheetPeek = isMobile && sheetHeightPx <= mobileSheetStops()[0] + 12;

  return (
    <div style={S.shell}>
      <style>{`@media (prefers-reduced-motion: reduce) { .food-map-motion { transition: none !important; scroll-behavior: auto !important; } }`}</style>
      <div ref={containerRef} style={S.map} data-testid="food-map-canvas" />

      <button
        onClick={() => navigate("/")}
        style={{ ...S.appBack, ...(isMobile ? S.appBackMobile : null) }}
        aria-label="חזרה לאפליקציה"
        data-testid="food-map-app-back"
        title="חזרה לאפליקציה"
      >
        <ArrowRight size={23} strokeWidth={2.4} aria-hidden="true" />
      </button>

      <div
        className="food-map-motion"
        style={{
          ...S.mapControlDock,
          ...(isMobile ? { bottom: sheetHeightPx + 14 } : null),
          transition: isSheetDragging ? "none" : "bottom 320ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        aria-label="פקדי מפה"
        data-testid="food-map-control-dock"
      >
        <button onClick={locateMe} style={S.mapControlButton} aria-label="המיקום שלי" title="המיקום שלי" data-testid="food-map-locate">
          <Crosshair size={23} strokeWidth={2.1} aria-hidden="true" />
        </button>
        <span style={S.mapControlDivider} />
        <button
          onClick={() => toggleGlobe()}
          style={{ ...S.mapControlButton, ...(isGlobe ? S.mapControlButtonActive : null) }}
          aria-label={isGlobe ? "חזור למפה" : "עבור לגלובוס"}
          title={isGlobe ? "חזור למפה" : "עבור לגלובוס"}
          aria-pressed={isGlobe}
          data-testid="food-map-globe"
        >
          {isGlobe
            ? <MapIcon size={23} strokeWidth={2.1} aria-hidden="true" />
            : <Earth size={23} strokeWidth={2.1} aria-hidden="true" />}
        </button>
      </div>

      {searchAreaVisible && !isGlobe && (
        <button onClick={applySearchArea} style={{ ...S.searchAreaBtn, ...(isMobile ? S.searchAreaBtnMobile : null) }} data-testid="food-map-search-area">
          <Search size={17} strokeWidth={2.3} aria-hidden="true" />
          <span>{viewportPlaceKeys ? "עדכן את האזור הזה" : "חפש באזור הזה"}</span>
        </button>
      )}
      {areaFeedback && (
        <button
          type="button"
          onClick={showAreaResults}
          disabled={!viewportPlaceKeys?.length}
          style={{ ...S.areaFeedback, ...(isMobile ? S.areaFeedbackMobile : null), ...(isMobile ? { bottom: sheetHeightPx + 12 } : null) }}
          role="status"
          aria-label={viewportPlaceKeys?.length ? `${areaFeedback}. הצג את המקומות` : areaFeedback}
          data-testid="food-map-area-feedback"
        >
          {areaFeedback}
        </button>
      )}
      {locationError && <div style={S.locationError}>{locationError}</div>}
      {isGlobe && <div style={S.spinHint}>גרור כדי לסובב</div>}

      {selected && popupAt && !isMobile && (
        <div
          dir="rtl"
          data-testid="food-map-popup"
          style={{ ...S.popup, left: popupAt.x, top: popupAt.y }}
        >
          <button onClick={() => setSelected(null)} style={S.popupClose} aria-label="סגור">×</button>
          <div style={S.popupTitle}>{selected.name}</div>
          <div style={S.popupSub}>
            {[selected.city, selected.country].filter(Boolean).join(", ")}
            {selected.address ? ` · ${selected.address}` : ""}
          </div>

          <div style={S.popupBig}>{money(selected.total)}</div>
          <div style={S.popupBigCap}>סה״כ הוצאה</div>

          <div style={S.popupGrid}>
            <Small value={String(selected.visits)} label="ביקורים" />
            <Small value={money(selected.total / selected.visits)} label="ממוצע לביקור" />
            <Small value={ltr(`${monthOf(selected.first)} → ${monthOf(selected.last)}`)} label="מתי" />
          </div>

          {selected.txns?.length ? (
            <>
              <button
                onClick={() => setDrillOpen((v) => !v)}
                style={S.drillToggle}
                data-testid="food-map-drill"
              >
                {drillOpen ? "הסתר עסקאות ▴" : `כל ${selected.txns.length} העסקאות ▾`}
              </button>
              {drillOpen && (
                <div style={S.drillList}>
                  {selected.txns.map((t, i) => (
                    <div key={`${t.date}-${i}`} style={S.drillRow}>
                      <span style={S.drillDate}>{dateLabel(t.date)}</span>
                      <span style={S.drillMethod}>{t.method}</span>
                      <span style={S.drillAmount}>{money(t.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}

          <div style={S.popupTail} />
        </div>
      )}

      <aside
        dir="rtl"
        style={{
          ...S.panel,
          ...(isMobile ? S.panelMobile : null),
          ...(isMobile ? {
            height: sheetHeightPx,
            transition: isSheetDragging ? "none" : "height 320ms cubic-bezier(0.22, 1, 0.36, 1)",
          } : null),
        }}
        className="food-map-motion"
        data-testid="food-map-panel"
      >
        {isMobile && (
          <button
            type="button"
            style={S.sheetHandle}
            aria-label="גרור לשינוי גובה החלונית"
            onPointerDown={onSheetPointerDown}
            onPointerMove={onSheetPointerMove}
            onPointerUp={onSheetPointerEnd}
            onPointerCancel={onSheetPointerEnd}
            onClick={cycleSheetHeight}
            data-testid="food-map-sheet-handle"
          >
            <span style={S.sheetHandleBar} />
          </button>
        )}
        <div
          style={{
            ...S.panelScroll,
            ...(isMobile ? S.panelScrollMobile : null),
            ...(isSheetPeek ? S.panelScrollPeek : null),
          }}
          onTouchStart={onPanelTouchStart}
          onTouchMove={onPanelTouchMove}
          onTouchEnd={onPanelTouchEnd}
          onTouchCancel={onPanelTouchEnd}
          onWheel={onPanelWheel}
        >
          <div style={S.head}>
            {cityFilter && (
              <button onClick={clearCityFocus} style={S.cityBack} data-testid="food-map-city-back">
                <span aria-hidden="true">→</span>
                חזרה לכל הערים
              </button>
            )}
            <div style={S.title}>{cityFilter ? cityFilter : "איפה אכלתי 🌎"}</div>
            {/* Zeros here read as real data, so the summary waits for a feed. */}
            {feed && (
              <>
                <div style={S.subtitle} data-testid="food-map-subtitle">
                  {stats.spots.toLocaleString("he-IL")} מקומות · {stats.cities} ערים · היסטוריית כרטיס{" "}
                  {stats.from} ← {stats.to}
                </div>

                <div style={S.bigStats} data-testid="food-map-stats">
                  <Big value={money(stats.total)} label="סה״כ הוצאה" />
                  <Big value={stats.visits.toLocaleString("he-IL")} label="ביקורים" />
                  <Big value={stats.spots.toLocaleString("he-IL")} label="מקומות" />
                </div>
              </>
            )}

            <div style={S.tabs} role="tablist" aria-label="סוג תצוגה">
              {([["spots", "מקומות"], ["heat", "מפת חום"]] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  data-testid={`tab-${key}`}
                  role="tab"
                  aria-selected={tab === key}
                  style={{ ...S.tab, ...(tab === key ? S.tabOn : null) }}
                >
                  {label}
                </button>
              ))}
            </div>

            <button onClick={() => setLegendOpen((open) => !open)} style={S.legendToggle} aria-expanded={legendOpen}>
              {legendOpen ? "הסתר מקרא" : "איך קוראים את המפה? ⓘ"}
            </button>
            {legendOpen && (
              <div style={S.legend}>
                <div style={S.legendCap}>סה״כ הוצאה לכל מקום</div>
                <div style={S.legendRow}>
                  {BUCKETS.map((b) => (
                    <div key={b.label} style={S.legendCell}>
                      <div style={{ ...S.legendSwatch, background: b.color }} />
                      <div style={S.legendLabel}>{b.label}</div>
                    </div>
                  ))}
                </div>
                <div style={S.legendNote}>גודל העיגול גדל עם ההוצאה; מספר בתוך עיגול הוא קבוצת מקומות</div>
              </div>
            )}

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חפש מקום או עיר"
              style={S.search}
              data-testid="food-map-search"
            />

            <div style={S.filterChips} data-testid="food-map-filters">
              <button aria-pressed={period === "year"} onClick={() => setPeriod((value) => value === "all" ? "year" : "all")} style={{ ...S.filterChip, ...(period === "year" ? S.filterChipOn : null) }}>
                השנה האחרונה
              </button>
              <button aria-pressed={region === "israel"} onClick={() => setRegion(region === "israel" ? "all" : "israel")} style={{ ...S.filterChip, ...(region === "israel" ? S.filterChipOn : null) }}>
                ישראל
              </button>
              <button aria-pressed={region === "abroad"} onClick={() => setRegion(region === "abroad" ? "all" : "abroad")} style={{ ...S.filterChip, ...(region === "abroad" ? S.filterChipOn : null) }}>
                חו״ל
              </button>
              <button aria-pressed={returningOnly} onClick={() => setReturningOnly((value) => !value)} style={{ ...S.filterChip, ...(returningOnly ? S.filterChipOn : null) }}>
                חזרתי שוב
              </button>
              <button aria-pressed={highSpendOnly} onClick={() => setHighSpendOnly((value) => !value)} style={{ ...S.filterChip, ...(highSpendOnly ? S.filterChipOn : null) }}>
                מעל ₪500
              </button>
              {cityFilter && (
                <button onClick={clearCityFocus} style={{ ...S.filterChip, ...S.filterChipOn }}>
                  {cityFilter} ×
                </button>
              )}
              {viewportPlaceKeys && (
                <button onClick={clearViewportFilter} style={{ ...S.filterChip, ...S.filterChipOn }} aria-label="נקה סינון לפי אזור המפה">
                  אזור המפה · {visible.length} ×
                </button>
              )}
            </div>
          </div>

          {/* Supabase errors come back in English; without the LRM the Latin text
              and its punctuation get reordered by the surrounding RTL context. */}
          {error && (
            <div style={S.error}>
              שגיאה בטעינת הנתונים: <span dir="ltr" style={S.errorDetail}>{ltr(error)}</span>
            </div>
          )}
          {isEmpty && !error && (
            <div style={S.empty} data-testid="food-map-empty">
              <div style={S.emptyTitle}>עוד אין מקומות להציג</div>
              <div style={S.emptyBody}>
                המפה נבנית מהעסקאות שלך בקטגוריות האוכל. אחרי הסנכרון הבא המקומות שביקרת בהם יופיעו כאן.
              </div>
            </div>
          )}
          {!feed && !error && !isEmpty && (
            <div style={S.skeletonWrap} data-testid="food-map-loading">
              {[1, 2, 3, 4].map((item) => <div key={item} style={S.skeletonRow} />)}
            </div>
          )}

          {insights && !viewportPlaceKeys && (
            <>
              <div style={S.sectionCap}>מה גיליתי?</div>
              <div style={S.insightGrid} data-testid="food-map-insights">
                <div style={S.insightCard}><b>{insights.topCity?.city}</b><span>העיר המובילה · {money(insights.topCity?.total || 0)}</span></div>
                <div style={S.insightCard}><b>{insights.mostVisited.name}</b><span>חזרת {insights.mostVisited.visits} פעמים</span></div>
                <div style={S.insightCard}><b>{money(insights.monthlyAverage)}</b><span>ממוצע חודשי</span></div>
                <div style={S.insightCard}><b>{insights.largest?.place || "—"}</b><span>הביקור היקר · {money(insights.largest?.amount || 0)}</span></div>
                <div style={S.insightCard}><b>{money(insights.israelTotal)}</b><span>ישראל</span></div>
                <div style={S.insightCard}><b>{money(insights.abroadTotal)}</b><span>חו״ל · {insights.dormant} מקומות ישנים</span></div>
              </div>
            </>
          )}

          {!viewportPlaceKeys && (
            <>
            <div style={S.sectionCap}>ערים</div>
            <div data-testid="food-map-cities" style={S.pagedSection} {...cityPager.touchHandlers}>
              {cityPager.items.map((c) => (
                <button key={c.city} style={{ ...S.cityRow, ...(cityFilter === c.city ? S.cityRowOn : null) }} onClick={() => focusCity(c.city)}>
                  <div style={S.cityTop}>
                    <span style={S.cityName}>{c.city}</span>
                    <span style={S.cityMoney}>{money(c.total)}</span>
                  </div>
                  <div style={S.barTrack}>
                    <div style={{ ...S.barFill, width: `${Math.max(2, (c.total / maxCityTotal) * 100)}%` }} />
                  </div>
                  <div style={S.cityMeta}>{c.spots} מקומות · {c.visits} ביקורים</div>
                </button>
              ))}
              <PaginationDots page={cityPager.page} totalPages={cityPager.totalPages} onChange={cityPager.setPage} label="עמודי ערים" />
            </div>
  
  
            </>
          )}

          <div style={S.sectionCap}>
            {viewportPlaceKeys ? `${visible.length} תוצאות באזור` : "המקומות המובילים"}
            <span style={S.sectionCapDim}> · לפי סה״כ הוצאה</span>
          </div>
          <div ref={resultsListRef} data-testid="food-map-list" style={S.pagedSection} {...spotPager.touchHandlers}>
            {spotPager.items.map((p, i) => (
              <button key={`${p.name}-${p.lat}`} onClick={() => focusPlace(p)} style={{ ...S.spotRow, ...(selected && placeKey(selected) === placeKey(p) ? S.spotRowOn : null) }}>
                <span style={S.spotRank}>{spotPager.page * PAGE_SIZE + i + 1}</span>
                <span style={S.spotMain}>
                  <span style={S.spotName}>{p.name}</span>
                  <span style={S.spotCity}>{p.city || p.country}</span>
                </span>
                <span style={S.spotRight}>
                  <span style={S.spotMoney}>{money(p.total)}</span>
                  <span style={S.spotVisits}>{p.visits}×</span>
                </span>
              </button>
            ))}
            <PaginationDots page={spotPager.page} totalPages={spotPager.totalPages} onChange={spotPager.setPage} label="עמודי מקומות מובילים" />
            {feed && visible.length === 0 && <div style={S.loading}>אין תוצאות</div>}
          </div>
        </div>

        {isMobile && selected && (
          <section style={S.mobileDetail} data-testid="food-map-mobile-detail" aria-label={selected.name}>
            <header style={S.mobileDetailHeader}>
              <button
                onClick={() => {
                  setSelected(null);
                  setDrillOpen(false);
                }}
                style={S.mobileBack}
                aria-label="חזרה למפה"
              >
                <span aria-hidden="true">→</span>
                חזרה למפה
              </button>
              <button
                onClick={() => {
                  setSelected(null);
                  setDrillOpen(false);
                }}
                style={S.mobileClose}
                aria-label="סגור פרטי מקום"
              >
                ×
              </button>
            </header>

            <div style={S.mobileDetailScroll}>
              <div style={S.mobileDetailTitle}>{selected.name}</div>
              <div style={S.mobileDetailSub}>
                {[selected.city, selected.country].filter(Boolean).join(", ")}
                {selected.address ? ` · ${selected.address}` : ""}
              </div>

              <div style={S.mobileDetailBig}>{money(selected.total)}</div>
              <div style={S.popupBigCap}>סה״כ הוצאה</div>

              <div style={S.mobileDetailGrid}>
                <Small value={String(selected.visits)} label="ביקורים" />
                <Small value={money(selected.total / selected.visits)} label="ממוצע לביקור" />
                <Small value={ltr(`${monthOf(selected.first)} → ${monthOf(selected.last)}`)} label="מתי" />
              </div>

              {monthlySpend(selected).length > 1 && (
                <div style={S.monthChart} data-testid="food-map-month-chart">
                  <div style={S.monthChartTitle}>הוצאה לפי חודש</div>
                  <div style={S.monthBars}>
                    {monthlySpend(selected).slice(-12).map(([month, amount]) => {
                      const max = Math.max(...monthlySpend(selected).map(([, value]) => value), 1);
                      return (
                        <div key={month} style={S.monthBarCell} title={`${month}: ${money(amount)}`}>
                          <div style={{ ...S.monthBar, height: `${Math.max(8, (amount / max) * 72)}px` }} />
                          <span>{month.slice(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={S.detailActions}>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${selected.lat},${selected.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  style={S.detailAction}
                >
                  פתיחה במפות
                </a>
                <button onClick={() => openCorrection(selected)} style={S.detailAction}>תיקון פרטים</button>
              </div>

              {correctionOpen && (
                <div style={S.correctionForm}>
                  <input value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="שם המקום" style={S.correctionInput} />
                  <input value={editCity} onChange={(event) => setEditCity(event.target.value)} placeholder="עיר" style={S.correctionInput} />
                  <div style={S.correctionCoords}>
                    <input value={editLat} onChange={(event) => setEditLat(event.target.value)} inputMode="decimal" placeholder="קו רוחב" style={S.correctionInput} />
                    <input value={editLng} onChange={(event) => setEditLng(event.target.value)} inputMode="decimal" placeholder="קו אורך" style={S.correctionInput} />
                  </div>
                  <div style={S.correctionButtons}>
                    <button onClick={() => setCorrectionOpen(false)} style={S.correctionCancel}>ביטול</button>
                    <button onClick={saveCorrection} style={S.correctionSave}>שמירה במכשיר</button>
                  </div>
                </div>
              )}

              {selected.txns?.length ? (
                <>
                  <button
                    onClick={() => setDrillOpen((v) => !v)}
                    style={S.mobileDrillToggle}
                    data-testid="food-map-drill"
                    aria-expanded={drillOpen}
                  >
                    {drillOpen ? "הסתר עסקאות ▴" : `כל ${selected.txns.length} העסקאות ▾`}
                  </button>
                  {drillOpen && (
                    <div style={S.mobileDrillList}>
                      {selected.txns.map((t, i) => (
                        <div key={`${t.date}-${i}`} style={S.mobileDrillRow}>
                          <span style={S.drillDate}>{dateLabel(t.date)}</span>
                          <span style={S.drillMethod}>{t.method}</span>
                          <span style={S.drillAmount}>{money(t.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </section>
        )}

        {feed?.mock && (
          <div style={S.mockNote} data-testid="food-map-mock-note">
            קואורדינטות הדגמה — הרץ geocoding אמיתי עם מפתח Google
          </div>
        )}
        {feed && !feed.mock && feed.provider === "osm" && (
          <div style={S.osmNote} data-testid="food-map-osm-note">
            מיקומים מ־OpenStreetMap
            {feed.not_found ? ` · ${feed.not_found} עסקים לא אותרו ואינם על המפה` : ""}
          </div>
        )}
      </aside>
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

function Small({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div style={S.smallValue}>{value}</div>
      <div style={S.smallLabel}>{label}</div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  shell: {
    position: "fixed",
    inset: 0,
    fontFamily: "'Assistant', 'Rubik', system-ui, sans-serif",
    background: "#05070d",
    overflow: "hidden",
  },
  map: { position: "absolute", inset: 0 },

  appBack: {
    position: "absolute",
    top: 18,
    // Keep the global back action outside the desktop panel. Placing it at the
    // panel's inline start used to cover the Hebrew title at narrow zoom levels.
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
    fontSize: 13,
    fontWeight: 800,
    color: "#1f2430",
    cursor: "pointer",
    boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
  },
  appBackMobile: {
    top: "max(12px, env(safe-area-inset-top))",
    right: 12,
    minHeight: 44,
  },

  mapControlDock: {
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
  mapControlButton: {
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
  mapControlButtonActive: {
    background: "#1a56c4",
    color: "#fff",
  },
  mapControlDivider: {
    width: 28,
    height: 1,
    background: "#e4e7ec",
  },
  locateGlyph: { color: "#1a56c4", fontSize: 27, fontWeight: 800, lineHeight: 1 },
  globeGlyph: { fontSize: 21, lineHeight: 1 },
  searchAreaBtn: {
    position: "absolute",
    top: 20,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 13,
    minHeight: 44,
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 999,
    background: "#fff",
    padding: "0 18px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontSize: 13,
    fontWeight: 800,
    color: "#1a56c4",
    boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
    cursor: "pointer",
  },
  searchAreaBtnMobile: { top: "max(72px, calc(env(safe-area-inset-top) + 60px))" },
  clearAreaBtn: {
    position: "absolute",
    top: 72,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 13,
    minHeight: 36,
    border: "none",
    borderRadius: 999,
    background: "#1a56c4",
    padding: "0 14px",
    color: "#fff",
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
  },
  clearAreaBtnMobile: { top: "max(120px, calc(env(safe-area-inset-top) + 108px))" },
  areaFeedback: {
    position: "absolute",
    top: 116,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 13,
    minWidth: 180,
    padding: "9px 13px",
    borderRadius: 999,
    background: "rgba(18,20,26,0.88)",
    color: "#fff",
    textAlign: "center",
    fontSize: 12,
    fontWeight: 800,
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  areaFeedbackMobile: {
    top: "auto",
    bottom: "calc(22dvh + 12px)",
  },
  locationError: {
    position: "absolute",
    top: 82,
    left: 18,
    zIndex: 13,
    maxWidth: 220,
    padding: "8px 10px",
    borderRadius: 10,
    background: "#fff",
    color: "#b91c1c",
    fontSize: 11,
    boxShadow: "0 4px 14px rgba(0,0,0,0.16)",
  },
  spinHint: {
    position: "absolute",
    bottom: 62,
    left: 20,
    zIndex: 12,
    fontSize: 12,
    color: "rgba(255,255,255,0.72)",
    pointerEvents: "none",
  },

  // Right-hand side: this is a Hebrew, right-to-left app, so the panel sits
  // where an RTL reader starts — mirrored from the original.
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
    height: "58dvh",
    maxHeight: "620px",
    borderRadius: "24px 24px 0 0",
    boxShadow: "0 -12px 36px rgba(5,7,13,0.24)",
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
    cursor: "ns-resize",
    touchAction: "none",
  },
  sheetHandleBar: {
    display: "block",
    width: 38,
    height: 5,
    borderRadius: 999,
    background: "#d5d9e0",
    pointerEvents: "none",
  },
  panelScroll: { flex: 1, overflowY: "auto" },
  panelScrollMobile: {
    paddingTop: 12,
    paddingBottom: "max(12px, env(safe-area-inset-bottom))",
    overscrollBehavior: "contain",
  },
  panelScrollPeek: {
    overflowY: "hidden",
    touchAction: "pan-x",
  },

  mobileDetail: {
    position: "absolute",
    inset: 0,
    zIndex: 20,
    display: "flex",
    flexDirection: "column",
    background: "#fff",
    borderRadius: "24px 24px 0 0",
    overflow: "hidden",
  },
  mobileDetailHeader: {
    position: "relative",
    flexShrink: 0,
    minHeight: 58,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 14px 8px",
    borderBottom: "1px solid #eceef2",
    background: "#fff",
  },
  mobileBack: {
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
  },
  mobileClose: {
    width: 44,
    height: 44,
    border: "none",
    background: "transparent",
    color: "#8b929d",
    fontSize: 25,
    cursor: "pointer",
  },
  mobileDetailScroll: {
    flex: 1,
    overflowY: "auto",
    overscrollBehavior: "contain",
    padding: "18px 20px max(20px, env(safe-area-inset-bottom))",
  },
  mobileDetailTitle: { fontSize: 24, lineHeight: 1.25, fontWeight: 850, color: "#12141a" },
  mobileDetailSub: { marginTop: 5, fontSize: 14, lineHeight: 1.45, color: "#8b929d" },
  mobileDetailBig: { marginTop: 18, fontSize: 38, lineHeight: 1, fontWeight: 850, color: "#1a56c4" },
  mobileDetailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 12,
    marginTop: 18,
    padding: "16px 0",
    borderTop: "1px solid #eceef2",
    borderBottom: "1px solid #eceef2",
  },
  mobileDrillToggle: {
    width: "100%",
    minHeight: 48,
    marginTop: 16,
    border: "1px solid #dfe4ec",
    background: "#f7f8fa",
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 14,
    fontWeight: 800,
    color: "#2874e6",
    cursor: "pointer",
  },
  monthChart: { marginTop: 18, paddingTop: 14, borderTop: "1px solid #eceef2" },
  monthChartTitle: { fontSize: 12, fontWeight: 800, color: "#6d7481", marginBottom: 10 },
  monthBars: { height: 94, display: "flex", alignItems: "flex-end", gap: 5, direction: "ltr" },
  monthBarCell: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 },
  monthBar: { width: "100%", maxWidth: 20, borderRadius: "5px 5px 2px 2px", background: "#4285f4" },
  detailActions: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 9, marginTop: 16 },
  detailAction: {
    minHeight: 46,
    border: "1px solid #dfe4ec",
    borderRadius: 12,
    background: "#fff",
    color: "#1a56c4",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textDecoration: "none",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
  },
  correctionForm: { marginTop: 12, padding: 12, borderRadius: 12, background: "#f7f8fa" },
  correctionInput: {
    width: "100%",
    minHeight: 44,
    marginBottom: 8,
    border: "1px solid #dfe4ec",
    borderRadius: 9,
    padding: "0 10px",
    background: "#fff",
    boxSizing: "border-box",
    fontSize: 16,
  },
  correctionCoords: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 },
  correctionButtons: { display: "flex", justifyContent: "flex-end", gap: 8 },
  correctionCancel: { minHeight: 40, border: "none", background: "transparent", color: "#6d7481", fontWeight: 700 },
  correctionSave: { minHeight: 40, border: "none", borderRadius: 9, background: "#1a56c4", color: "#fff", padding: "0 14px", fontWeight: 800 },
  mobileDrillList: { marginTop: 10, borderTop: "1px solid #eceef2" },
  mobileDrillRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    padding: "9px 2px",
    borderBottom: "1px solid #f0f2f5",
    fontSize: 13,
  },

  head: { padding: "16px 16px 12px", borderBottom: "1px solid #eceef2" },
  cityBack: {
    minHeight: 40,
    margin: "0 0 6px",
    padding: 0,
    border: "none",
    background: "transparent",
    color: "#1a56c4",
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
  },
  title: { fontSize: 21, fontWeight: 800, color: "#12141a", letterSpacing: "-0.01em" },
  subtitle: { fontSize: 11.5, color: "#8b929d", marginTop: 3 },

  bigStats: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, margin: "14px 0 12px" },
  bigValue: { fontSize: 19, fontWeight: 800, color: "#12141a" },
  bigLabel: { fontSize: 10, color: "#9aa1ac", marginTop: 2, letterSpacing: "0.02em" },

  tabs: { display: "flex", gap: 4, background: "#f1f3f6", borderRadius: 11, padding: 3 },
  tab: {
    flex: 1,
    border: "none",
    background: "transparent",
    borderRadius: 7,
    minHeight: 44,
    padding: "7px 0",
    fontSize: 14,
    fontWeight: 700,
    color: "#6d7481",
    cursor: "pointer",
  },
  tabOn: { background: "#fff", color: "#12141a", boxShadow: "0 1px 3px rgba(0,0,0,0.12)" },

  legendToggle: {
    width: "100%",
    minHeight: 44,
    marginTop: 8,
    border: "none",
    background: "transparent",
    color: "#6d7481",
    fontSize: 11.5,
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "right",
  },
  legend: { marginTop: 4 },
  legendCap: { fontSize: 9.5, fontWeight: 800, color: "#9aa1ac", letterSpacing: "0.08em" },
  legendRow: { display: "flex", gap: 3, marginTop: 5 },
  legendCell: { flex: 1 },
  legendSwatch: { height: 7, borderRadius: 3 },
  legendLabel: { fontSize: 9.5, color: "#8b929d", marginTop: 3, textAlign: "center" },
  legendNote: { fontSize: 10.5, color: "#9aa1ac", marginTop: 6 },

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
  filterChips: {
    display: "flex",
    gap: 7,
    marginTop: 10,
    overflowX: "auto",
    scrollbarWidth: "none",
    paddingBottom: 2,
  },
  filterChip: {
    minHeight: 44,
    flexShrink: 0,
    border: "1px solid #dfe4ec",
    borderRadius: 999,
    background: "#fff",
    padding: "0 12px",
    color: "#59616d",
    fontSize: 13,
    fontWeight: 750,
    cursor: "pointer",
  },
  filterChipOn: { borderColor: "#4285f4", background: "#eaf2ff", color: "#1a56c4" },

  popup: {
    position: "absolute",
    zIndex: 11,
    width: 268,
    transform: "translate(-50%, calc(-100% - 16px))",
    background: "#fff",
    borderRadius: 12,
    padding: "13px 14px 12px",
    boxShadow: "0 10px 34px rgba(5,7,13,0.28)",
    border: "1px solid rgba(0,0,0,0.06)",
  },
  popupClose: { position: "absolute", left: 8, top: 5, border: "none", background: "transparent", fontSize: 18, color: "#9aa1ac", cursor: "pointer" },
  popupTitle: { fontSize: 14.5, fontWeight: 800, color: "#12141a", paddingLeft: 18, lineHeight: 1.25 },
  popupSub: { fontSize: 10.5, color: "#8b929d", marginTop: 3, lineHeight: 1.35 },
  popupBig: { fontSize: 26, fontWeight: 800, color: "#1a56c4", marginTop: 9, letterSpacing: "-0.02em" },
  popupBigCap: { fontSize: 9.5, fontWeight: 800, color: "#9aa1ac", letterSpacing: "0.08em" },
  popupGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 11 },
  popupTail: {
    position: "absolute",
    bottom: -7,
    left: "50%",
    width: 13,
    height: 13,
    marginLeft: -6.5,
    background: "#fff",
    borderRight: "1px solid rgba(0,0,0,0.06)",
    borderBottom: "1px solid rgba(0,0,0,0.06)",
    transform: "rotate(45deg)",
  },

  drillToggle: {
    width: "100%",
    marginTop: 11,
    border: "1px solid #e2e5ea",
    background: "#f7f8fa",
    borderRadius: 8,
    padding: "7px 0",
    fontSize: 11.5,
    fontWeight: 700,
    color: "#4285f4",
    cursor: "pointer",
  },
  drillList: { marginTop: 8, maxHeight: 176, overflowY: "auto", borderTop: "1px solid #f0f2f5" },
  drillRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 2px",
    borderBottom: "1px solid #f4f5f8",
    fontSize: 11.5,
  },
  drillDate: { color: "#6d7481", flexShrink: 0, direction: "ltr" },
  drillMethod: { flex: 1, color: "#a3a9b3", fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  drillAmount: { fontWeight: 800, color: "#12141a", flexShrink: 0 },
  smallValue: { fontSize: 12.5, fontWeight: 800, color: "#12141a" },
  smallLabel: { fontSize: 9.5, color: "#9aa1ac", marginTop: 2 },

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
  },
  cityRow: {
    display: "block",
    width: "100%",
    padding: "9px 16px 10px",
    border: "none",
    borderBottom: "1px solid #f4f5f8",
    background: "transparent",
    textAlign: "right",
    cursor: "pointer",
  },
  cityRowOn: { background: "#edf4ff" },
  cityTop: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  cityName: { fontSize: 13, fontWeight: 700, color: "#12141a" },
  cityMoney: { fontSize: 13, fontWeight: 800, color: "#12141a" },
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
    padding: "8px 16px",
    cursor: "pointer",
    textAlign: "right",
  },
  spotRowOn: { background: "#edf4ff" },
  spotRank: { fontSize: 10.5, color: "#b6bcc5", width: 16, flexShrink: 0, fontWeight: 700 },
  spotMain: { flex: 1, minWidth: 0 },
  spotName: { display: "block", fontSize: 12.5, fontWeight: 700, color: "#12141a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  spotCity: { display: "block", fontSize: 10, color: "#a3a9b3", marginTop: 1 },
  spotRight: { textAlign: "left", flexShrink: 0 },
  spotMoney: { display: "block", fontSize: 12.5, fontWeight: 800, color: "#12141a" },
  spotVisits: { display: "block", fontSize: 10, color: "#a3a9b3" },

  pagedSection: {
    touchAction: "pan-y",
    overscrollBehaviorX: "contain",
  },
  pagination: {
    minHeight: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "8px 16px 10px",
  },
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
  paginationDotActive: {
    width: 22,
    background: "#4285f4",
  },

  showAll: {
    width: "100%",
    border: "none",
    background: "transparent",
    padding: "12px 0 16px",
    fontSize: 12,
    fontWeight: 700,
    color: "#4285f4",
    cursor: "pointer",
  },

  skeletonWrap: { padding: "10px 16px" },
  skeletonRow: {
    height: 54,
    marginBottom: 8,
    borderRadius: 10,
    background: "linear-gradient(90deg, #f0f2f5 25%, #fafbfc 50%, #f0f2f5 75%)",
    backgroundSize: "200% 100%",
  },
  loading: { padding: 16, fontSize: 13, color: "#8b929d" },
  error: { padding: 16, fontSize: 13, color: "#b91c1c" },
  errorDetail: { display: "inline-block", unicodeBidi: "isolate" },
  empty: { padding: "24px 16px", textAlign: "center" },
  emptyTitle: { fontSize: 15, fontWeight: 600, color: "#2b3140", marginBottom: 6 },
  emptyBody: { fontSize: 13, lineHeight: 1.6, color: "#6d7481" },
  mockNote: { padding: "8px 16px", fontSize: 10.5, color: "#92400e", background: "#fef3c7", borderTop: "1px solid #fde68a" },
  osmNote: { padding: "8px 16px", fontSize: 10.5, color: "#6d7481", background: "#f4f6f9", borderTop: "1px solid #e6ebf3" },
};
