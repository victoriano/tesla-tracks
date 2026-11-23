import "server-only";
import { query, table } from "./db";
import { readDrivers, UNKNOWN } from "./drivers";

type DriveRow = {
  drive_id: string;
  distance_km: number;
  duration_min: number;
  energy_kwh: number | null;
  avg_speed_kmh: number | null;
  avg_outside_temp_c: number | null;
  harsh_accel: number | null;
  harsh_brake: number | null;
  sharp_turns: number | null;
  traction_kwh: number | null;
  regen_kwh: number | null;
  fast_min: number | null;
  moving_min: number | null;
};

export type DriverStats = {
  name: string;
  drives: number;
  km: number;
  hours: number;
  kwh: number;
  share: number; // of all km in the period
  avgSpeed: number | null;
  whPerKm: number | null;
  efficiency: number | null; // actual / expected energy for the same speeds & temperatures (1 = typical)
  harshAccel100: number | null;
  harshBrake100: number | null;
  sharpTurns100: number | null;
  regenShare: number | null; // energy recovered / energy used for traction
  fastShare: number | null; // share of moving time above 120 km/h
  score: number | null;
  parts: { smooth: number; efficient: number; anticipation: number; calm: number } | null;
  tips: { good: boolean; text: string }[];
};

/** Least squares with a little ridge: returns coefficients for X·b ≈ y. */
function fit(X: number[][], y: number[]): number[] | null {
  const k = X[0]?.length ?? 0;
  const A = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0) + (i === j && i > 0 ? 1e-3 : 0)),
  );
  const b = Array.from({ length: k }, (_, i) => X.reduce((s, r, n) => s + r[i] * y[n], 0));
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j < k; j++) A[r][j] -= f * A[c][j];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}

const feats = (d: DriveRow) => {
  const v = (d.avg_speed_kmh ?? 40) / 100;
  const t = Math.min(20, d.avg_outside_temp_c ?? 15) / 10;
  return [1, v, v * v, t];
};

const clamp = (x: number) => Math.max(0, Math.min(100, x));
const fmt1 = (x: number) => x.toFixed(1);

export async function driverStats(days: number | null): Promise<{ drivers: DriverStats[]; unassignedKm: number }> {
  const t = table("drives");
  if (!t) return { drivers: [], unassignedKm: 0 };
  const where = days ? `WHERE start_ts >= now() - INTERVAL ${Number(days)} DAY` : "";
  let rows: DriveRow[] = [];
  try {
    rows = await query<DriveRow>(
      `SELECT drive_id, distance_km, duration_min, energy_kwh, avg_speed_kmh, avg_outside_temp_c,
              harsh_accel, harsh_brake, sharp_turns, traction_kwh, regen_kwh, fast_min, moving_min
       FROM '${t}' ${where}`,
    );
  } catch {
    // older drives.parquet without style columns
    rows = (
      await query<DriveRow>(
        `SELECT drive_id, distance_km, duration_min, energy_kwh, avg_speed_kmh, avg_outside_temp_c FROM '${t}' ${where}`,
      )
    ).map((r) => ({ ...r, harsh_accel: null, harsh_brake: null, sharp_turns: null, traction_kwh: null, regen_kwh: null, fast_min: null, moving_min: null }));
  }
  rows = rows
    .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === "drive_id" || v === null ? v : Number(v)])) as DriveRow)
    .filter((r) => r.distance_km > 0.3);

  // Expected Wh/km for a drive's speed and temperature, fitted on all drives (everyone's).
  const usable = rows.filter((r) => r.distance_km >= 2 && r.energy_kwh !== null && r.energy_kwh > 0);
  const coef = usable.length >= 8 ? fit(usable.map(feats), usable.map((r) => ((r.energy_kwh as number) * 1000) / r.distance_km)) : null;
  const fleetWh = usable.reduce((s, r) => s + (r.energy_kwh as number), 0) * 1000 / Math.max(1e-9, usable.reduce((s, r) => s + r.distance_km, 0));
  const expectedWh = (r: DriveRow) => (coef ? Math.max(60, feats(r).reduce((s, x, i) => s + x * coef[i], 0)) : fleetWh);

  const who = readDrivers();
  const groups = new Map<string, DriveRow[]>();
  for (const r of rows) {
    const name = who[r.drive_id] ?? UNKNOWN;
    groups.set(name, [...(groups.get(name) ?? []), r]);
  }
  const totalKm = rows.reduce((s, r) => s + r.distance_km, 0);

  const stats: DriverStats[] = [...groups.entries()].map(([name, ds]) => {
    const km = ds.reduce((s, r) => s + r.distance_km, 0);
    const hours = ds.reduce((s, r) => s + r.duration_min, 0) / 60;
    const withE = ds.filter((r) => r.energy_kwh !== null && r.energy_kwh > 0 && r.distance_km >= 2);
    const kwh = withE.reduce((s, r) => s + (r.energy_kwh as number), 0);
    const kmE = withE.reduce((s, r) => s + r.distance_km, 0);
    const expKwh = withE.reduce((s, r) => s + (expectedWh(r) * r.distance_km) / 1000, 0);
    const styled = ds.filter((r) => r.harsh_accel !== null);
    const kmS = styled.reduce((s, r) => s + r.distance_km, 0);
    const per100 = (f: (r: DriveRow) => number) => (kmS >= 5 ? (styled.reduce((s, r) => s + f(r), 0) * 100) / kmS : null);
    const traction = styled.reduce((s, r) => s + (r.traction_kwh ?? 0), 0);
    const moving = styled.reduce((s, r) => s + (r.moving_min ?? 0), 0);
    const st: DriverStats = {
      name,
      drives: ds.length,
      km,
      hours,
      kwh,
      share: totalKm ? km / totalKm : 0,
      avgSpeed: hours > 0 ? km / hours : null,
      whPerKm: kmE > 0 ? (kwh * 1000) / kmE : null,
      efficiency: expKwh > 0 && kmE >= 5 ? kwh / expKwh : null,
      harshAccel100: per100((r) => r.harsh_accel ?? 0),
      harshBrake100: per100((r) => r.harsh_brake ?? 0),
      sharpTurns100: per100((r) => r.sharp_turns ?? 0),
      regenShare: traction > 0.2 ? styled.reduce((s, r) => s + (r.regen_kwh ?? 0), 0) / traction : null,
      fastShare: moving > 5 ? styled.reduce((s, r) => s + (r.fast_min ?? 0), 0) / moving : null,
      score: null,
      parts: null,
      tips: [],
    };
    if (st.harshAccel100 !== null && st.efficiency !== null && st.regenShare !== null) {
      const parts = {
        smooth: clamp(100 - 4 * (st.harshAccel100 ?? 0) - 4 * (st.harshBrake100 ?? 0) - 3 * (st.sharpTurns100 ?? 0)),
        efficient: clamp(75 - (st.efficiency - 1) * 250),
        anticipation: clamp(st.regenShare * 500),
        calm: clamp(100 - 300 * (st.fastShare ?? 0)),
      };
      st.parts = parts;
      st.score = Math.round(0.35 * parts.smooth + 0.35 * parts.efficient + 0.2 * parts.anticipation + 0.1 * parts.calm);
    }
    return st;
  });

  const people = stats.filter((s) => s.name !== UNKNOWN);
  for (const s of people) {
    const others = people.filter((o) => o !== s);
    const best = (key: keyof DriverStats, low = true) => {
      const vals = others.map((o) => o[key]).filter((v): v is number => typeof v === "number");
      return vals.length ? (low ? Math.min(...vals) : Math.max(...vals)) : null;
    };
    const tip = (good: boolean, text: string) => s.tips.push({ good, text });
    if (s.efficiency !== null) {
      const pct = Math.round((s.efficiency - 1) * 100);
      if (pct >= 5) tip(false, `Uses ${pct}% more energy than expected for the same speeds and temperatures. Smoother throttle and earlier lift-off are the cheapest fixes.`);
      else if (pct <= -5) tip(true, `Very efficient: ${-pct}% less energy than expected for the same speeds and temperatures.`);
    }
    if (s.harshAccel100 !== null) {
      const o = best("harshAccel100");
      if (s.harshAccel100 >= 2) tip(false, `${fmt1(s.harshAccel100)} hard accelerations per 100 km${o !== null ? ` (others: ${fmt1(o)})` : ""}. Squeeze the pedal over 2–3 s instead of flooring it: same speed, less energy and tyre wear.`);
      else tip(true, "Gentle on the accelerator.");
    }
    if (s.harshBrake100 !== null && s.harshBrake100 >= 2) {
      tip(false, `${fmt1(s.harshBrake100)} hard brakes per 100 km. Look further ahead and lift off earlier: regenerative braking recovers energy that the friction brakes waste.`);
    }
    if (s.regenShare !== null) {
      const o = best("regenShare", false);
      if (o !== null && s.regenShare < o * 0.75)
        tip(false, `Recovers ${Math.round(s.regenShare * 100)}% of the energy back through regen vs ${Math.round(o * 100)}% for others: anticipate stops and slow down by lifting off.`);
      else if (s.regenShare >= 0.12) tip(true, `Good anticipation: ${Math.round(s.regenShare * 100)}% of the energy comes back through regen.`);
    }
    if (s.sharpTurns100 !== null && s.sharpTurns100 >= 5) {
      tip(false, `${fmt1(s.sharpTurns100)} sharp turns per 100 km. Brake before the bend, not in it, and turn in more gradually.`);
    }
    if (s.fastShare !== null && s.fastShare >= 0.08) {
      tip(false, `${Math.round(s.fastShare * 100)}% of driving time above 120 km/h. Air drag grows with the square of speed; cruising a bit slower is the biggest efficiency win on the motorway.`);
    }
  }

  const order = (s: DriverStats) => (s.name === UNKNOWN ? 1 : 0);
  stats.sort((a, b) => order(a) - order(b) || b.km - a.km);
  const unassignedKm = stats.find((s) => s.name === UNKNOWN)?.km ?? 0;
  return { drivers: stats, unassignedKm };
}
