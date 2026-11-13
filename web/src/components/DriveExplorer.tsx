"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  LngLatBounds,
  Map as MapLibre,
  Marker,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  METRICS,
  metricValues,
  nearestIndex,
  robustRange,
  type MetricKey,
  type TrackPoint,
} from "@/lib/driveMetrics";

const STYLE = process.env.NEXT_PUBLIC_MAP_STYLE || "https://tiles.openfreemap.org/styles/dark";
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

// Low values pale, high values deep red: the darker/more intense, the faster / hungrier the stretch.
const RAMP = ["#fef3c7", "#fcd34d", "#f97316", "#dc2626", "#7f1d1d"];
const RAMP_EXPR: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["get", "v"],
  0,
  RAMP[0],
  0.25,
  RAMP[1],
  0.5,
  RAMP[2],
  0.75,
  RAMP[3],
  1,
  RAMP[4],
];

type Series = { key: "speed" | "power" | "soc"; label: string; unit: string; digits: number; color: string; map: MetricKey };
const SERIES: Series[] = [
  { key: "speed", label: "Speed", unit: "km/h", digits: 0, color: "#38bdf8", map: "speed" },
  { key: "power", label: "Power (− regen)", unit: "kW", digits: 1, color: "#fbbf24", map: "power" },
  { key: "soc", label: "Battery", unit: "%", digits: 1, color: "#34d399", map: "drain" },
];

function segmentsGeoJSON(points: TrackPoint[], values: (number | null)[]) {
  const [lo, hi] = robustRange(values);
  const norm = (v: number | null) => (v === null ? 0 : Math.min(1, Math.max(0, (v - lo) / (hi - lo || 1))));
  const features = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const va = values[i - 1];
    const vb = values[i];
    const v = va !== null && vb !== null ? (va + vb) / 2 : (vb ?? va);
    features.push({
      type: "Feature" as const,
      properties: { v: norm(v) },
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [a.lon, a.lat],
          [b.lon, b.lat],
        ],
      },
    });
  }
  return { geojson: { type: "FeatureCollection" as const, features }, range: [lo, hi] as [number, number] };
}

function fmt(v: number | null | undefined, digits: number, locale: string) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default function DriveExplorer({
  points,
  timeZone,
  locale,
}: {
  points: TrackPoint[];
  timeZone: string;
  locale: string;
}) {
  const [metric, setMetric] = useState<MetricKey>("speed");
  const [hover, setHover] = useState<number | null>(null);
  const values = useMemo(() => metricValues(points), [points]);
  const colored = useMemo(() => segmentsGeoJSON(points, values[metric]), [points, values, metric]);

  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const [ready, setReady] = useState(false);

  // Create the map once.
  useEffect(() => {
    if (!mapDiv.current || points.length < 2) return;
    const map = new MapLibre({ container: mapDiv.current, style: STYLE, attributionControl: { compact: true } });
    mapRef.current = map;
    const bounds = points.reduce(
      (b, p) => b.extend([p.lon, p.lat]),
      new LngLatBounds([points[0].lon, points[0].lat], [points[0].lon, points[0].lat]),
    );
    map.fitBounds(bounds, { padding: 48, duration: 0, maxZoom: 16 });
    map.on("load", () => {
      map.addSource("segments", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("hover", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "segments-casing",
        type: "line",
        source: "segments",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#000", "line-width": 8, "line-opacity": 0.55 },
      });
      map.addLayer({
        id: "segments",
        type: "line",
        source: "segments",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": RAMP_EXPR,
          "line-width": ["interpolate", ["linear"], ["get", "v"], 0, 3.5, 1, 6],
        },
      });
      map.addLayer({
        id: "hover",
        type: "circle",
        source: "hover",
        paint: { "circle-radius": 7, "circle-color": "#fff", "circle-stroke-color": "#000", "circle-stroke-width": 2 },
      });
      new Marker({ color: "#22c55e", scale: 0.7 }).setLngLat([points[0].lon, points[0].lat]).addTo(map);
      const last = points[points.length - 1];
      new Marker({ color: "#ef4444", scale: 0.7 }).setLngLat([last.lon, last.lat]).addTo(map);
      setReady(true);
    });
    // Hovering the route selects the nearest instant (shown on the charts).
    map.on("mousemove", (e) => {
      let best = -1;
      let bestD = 28 * 28;
      for (let i = 0; i < points.length; i++) {
        const p = map.project([points[i].lon, points[i].lat]);
        const d = (p.x - e.point.x) ** 2 + (p.y - e.point.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      setHover(best >= 0 ? best : null);
      map.getCanvas().style.cursor = best >= 0 ? "crosshair" : "";
    });
    map.on("mouseout", () => setHover(null));
    return () => {
      setReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, [points]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    (mapRef.current.getSource("segments") as GeoJSONSource).setData(colored.geojson);
  }, [ready, colored]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const p = hover !== null ? points[hover] : null;
    (mapRef.current.getSource("hover") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: p ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p.lon, p.lat] } }] : [],
    });
  }, [ready, hover, points]);

  // ---- charts ----
  const t0 = points[0]?.t ?? 0;
  const t1 = points[points.length - 1]?.t ?? 1;
  const xPct = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * 100;
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }),
    [locale, timeZone],
  );
  const timeFmtSec = useMemo(
    () => new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    [locale, timeZone],
  );
  const ticks = useMemo(() => Array.from({ length: 6 }, (_, i) => t0 + ((t1 - t0) * i) / 5), [t0, t1]);
  const chartsRef = useRef<HTMLDivElement>(null);

  const onChartMove = (e: React.PointerEvent) => {
    const box = chartsRef.current?.getBoundingClientRect();
    if (!box) return;
    const f = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    setHover(nearestIndex(points, t0 + f * (t1 - t0)));
  };

  const hp = hover !== null ? points[hover] : null;
  const m = METRICS[metric];

  if (points.length < 2) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5 text-sm">
          {(Object.keys(METRICS) as MetricKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setMetric(k)}
              className={`rounded-md px-3 py-1.5 ${metric === k ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              {METRICS[k].label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span>
            {fmt(colored.range[0], m.digits, locale)} {m.unit}
          </span>
          <span className="h-2 w-40 rounded-full" style={{ background: `linear-gradient(90deg, ${RAMP.join(",")})` }} />
          <span>
            {fmt(colored.range[1], m.digits, locale)} {m.unit}
          </span>
        </div>
      </div>

      <div ref={mapDiv} style={{ height: 440 }} className="w-full overflow-hidden rounded-xl border border-zinc-800" />

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="mb-2 flex items-baseline justify-between text-xs text-zinc-500">
          <span>Hover the charts or the route to compare the same moment</span>
          <span className="tabular-nums text-zinc-300">{hp ? timeFmtSec.format(hp.t) : ""}</span>
        </div>
        <div
          ref={chartsRef}
          className="relative select-none"
          onPointerMove={onChartMove}
          onPointerLeave={() => setHover(null)}
        >
          {SERIES.map((s) => (
            <ChartRow
              key={s.key}
              series={s}
              points={points}
              xPct={xPct}
              hoverValue={hp ? (hp[s.key] as number | null) : undefined}
              active={metric === s.map}
              onSelect={() => setMetric(s.map)}
              locale={locale}
            />
          ))}
          {hp ? (
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/60"
              style={{ left: `${xPct(hp.t)}%` }}
            />
          ) : null}
        </div>
        <div className="relative mt-1 h-4 text-[10px] text-zinc-500">
          {ticks.map((t, i) => (
            <span
              key={t}
              className="absolute -translate-x-1/2 tabular-nums"
              style={{ left: `${(i / 5) * 100}%`, transform: i === 0 ? "none" : i === 5 ? "translateX(-100%)" : undefined }}
            >
              {timeFmt.format(t)}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function ChartRow({
  series,
  points,
  xPct,
  hoverValue,
  active,
  onSelect,
  locale,
}: {
  series: Series;
  points: TrackPoint[];
  xPct: (t: number) => number;
  hoverValue: number | null | undefined;
  active: boolean;
  onSelect: () => void;
  locale: string;
}) {
  const H = 100;
  const vals = points.map((p) => p[series.key] as number | null);
  const valid = vals.filter((v): v is number => v !== null && Number.isFinite(v));
  if (valid.length < 2) return null;
  let lo = Math.min(...valid);
  let hi = Math.max(...valid);
  if (series.key === "power") lo = Math.min(lo, 0);
  if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.08;
  const y = (v: number) => H - ((v - lo + pad) / (hi - lo + 2 * pad)) * H;
  let d = "";
  points.forEach((p, i) => {
    const v = vals[i];
    if (v === null || !Number.isFinite(v)) return;
    d += `${d ? "L" : "M"}${xPct(p.t).toFixed(3)},${y(v).toFixed(2)}`;
  });
  const area = `${d}L${xPct(points[points.length - 1].t)},${H}L${xPct(points[0].t)},${H}Z`;
  return (
    <div className="border-b border-zinc-800/70 py-2 last:border-b-0">
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <button
          onClick={onSelect}
          title="Colour the map by this"
          className={`${active ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
        >
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: series.color }} />
          {series.label}
          {active ? <span className="ml-1.5 text-[10px] text-zinc-500">on map</span> : null}
        </button>
        <span className="tabular-nums text-zinc-400">
          {hoverValue !== undefined
            ? `${fmt(hoverValue, series.digits, locale)} ${series.unit}`
            : `${fmt(Math.min(...valid), series.digits, locale)}–${fmt(Math.max(...valid), series.digits, locale)} ${series.unit}`}
        </span>
      </div>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="h-24 w-full overflow-visible">
        {series.key === "power" && lo < 0 ? (
          <line x1="0" x2="100" y1={y(0)} y2={y(0)} stroke="#52525b" strokeDasharray="1 1" vectorEffect="non-scaling-stroke" />
        ) : null}
        <path d={area} fill={series.color} opacity={0.08} />
        <path d={d} fill="none" stroke={series.color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
