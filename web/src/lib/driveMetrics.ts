/** Per-point metrics of a drive, shared by the map colouring and the stacked charts. */

export type TrackPoint = {
  t: number; // epoch ms
  lat: number;
  lon: number;
  speed: number | null; // km/h
  power: number | null; // kW, negative = regen
  soc: number | null; // %
};

export type MetricKey = "speed" | "power" | "drain";

export const METRICS: Record<MetricKey, { label: string; unit: string; digits: number; color: string }> = {
  speed: { label: "Speed", unit: "km/h", digits: 0, color: "#38bdf8" },
  power: { label: "Power", unit: "kW", digits: 1, color: "#fbbf24" },
  drain: { label: "Battery drain", unit: "%/km", digits: 2, color: "#34d399" },
};

const R = 6371.0088;
export function haversineKm(a: TrackPoint, b: TrackPoint): number {
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Battery drain in % per km around each point. SoC moves in coarse steps, so it is measured over a
 * window of about ±1 km to give a smooth, comparable rate.
 */
export function batteryDrain(points: TrackPoint[], windowKm = 1): (number | null)[] {
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversineKm(points[i - 1], points[i]));
  const out: (number | null)[] = [];
  let a = 0;
  let b = 0;
  for (let i = 0; i < points.length; i++) {
    while (a < i && cum[i] - cum[a] > windowKm) a++;
    if (b < i) b = i;
    while (b < points.length - 1 && cum[b] - cum[i] < windowKm) b++;
    let lo = a;
    let hi = b;
    while (lo < hi && points[lo].soc === null) lo++;
    while (hi > lo && points[hi].soc === null) hi--;
    const dist = cum[hi] - cum[lo];
    const s0 = points[lo].soc;
    const s1 = points[hi].soc;
    out.push(dist > 0.05 && s0 !== null && s1 !== null ? Math.max(0, (s0 - s1) / dist) : null);
  }
  return out;
}

export function metricValues(points: TrackPoint[]): Record<MetricKey, (number | null)[]> {
  return {
    speed: points.map((p) => p.speed),
    power: points.map((p) => p.power),
    drain: batteryDrain(points),
  };
}

/** 5th–95th percentile range, so a single spike does not wash out the colour scale. */
export function robustRange(values: (number | null)[]): [number, number] {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x)).sort((x, y) => x - y);
  if (!v.length) return [0, 1];
  const q = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
  const lo = q(0.05);
  const hi = q(0.95);
  return hi > lo ? [lo, hi] : [v[0], v[v.length - 1] || v[0] + 1];
}

/** Index of the point closest in time to t (points are sorted by time). */
export function nearestIndex(points: TrackPoint[], t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(points[lo - 1].t - t) < Math.abs(points[lo].t - t)) return lo - 1;
  return lo;
}
