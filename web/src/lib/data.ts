import "server-only";
import { query, table } from "./db";
import { TIMEZONE } from "./format";

export type Drive = {
  drive_id: string;
  start_ms: number;
  end_ms: number;
  in_progress: boolean;
  duration_min: number | null;
  distance_km: number | null;
  start_soc: number | null;
  end_soc: number | null;
  energy_kwh: number | null;
  wh_per_km: number | null;
  avg_speed_kmh: number | null;
  max_speed_kmh: number | null;
  avg_outside_temp_c: number | null;
  start_lat: number | null;
  start_lon: number | null;
  end_lat: number | null;
  end_lon: number | null;
  start_odometer_km: number | null;
  end_odometer_km: number | null;
};

export type Charge = {
  charge_id: string;
  start_ms: number;
  end_ms: number;
  in_progress: boolean;
  duration_min: number | null;
  charger: string;
  fast_charger_type: string | null;
  start_soc: number | null;
  end_soc: number | null;
  energy_added_kwh: number | null;
  max_power_kw: number | null;
  lat: number | null;
  lon: number | null;
};

const DRIVE_COLS = `* EXCLUDE (start_ts, end_ts), epoch_ms(start_ts) AS start_ms, epoch_ms(end_ts) AS end_ms`;

export async function drives(limit = 500): Promise<Drive[]> {
  const t = table("drives");
  if (!t) return [];
  return query<Drive>(`SELECT ${DRIVE_COLS} FROM '${t}' ORDER BY start_ts DESC LIMIT ${Number(limit)}`);
}

export async function drive(id: string): Promise<Drive | null> {
  const t = table("drives");
  if (!t) return null;
  const rows = await query<Drive>(`SELECT ${DRIVE_COLS} FROM '${t}' WHERE drive_id = $id`, { id });
  return rows[0] ?? null;
}

export type Position = {
  ms: number;
  lat: number;
  lon: number;
  speed_kmh: number | null;
  power_kw: number | null;
  soc: number | null;
};

export async function positions(driveId: string): Promise<Position[]> {
  const t = table("positions");
  if (!t) return [];
  return query<Position>(
    `SELECT epoch_ms(ts) AS ms, lat, lon, speed_kmh, power_kw, soc FROM '${t}' WHERE drive_id = $id ORDER BY ts`,
    { id: driveId },
  );
}

/** Simplified routes of recent drives (every Nth point) for the overview map. */
export async function recentRoutes(days = 30): Promise<{ id: string; coords: [number, number][] }[]> {
  const t = table("positions");
  if (!t) return [];
  const rows = await query<{ drive_id: string; coords: string }>(
    `WITH p AS (
       SELECT drive_id, ts, lon, lat, row_number() OVER (PARTITION BY drive_id ORDER BY ts) AS n
       FROM '${t}' WHERE ts >= now() - INTERVAL ${Number(days)} DAY)
     SELECT drive_id, to_json(list([lon, lat] ORDER BY ts))::VARCHAR AS coords
     FROM p WHERE n % 5 = 1 GROUP BY drive_id`,
  );
  return rows.map((r) => ({ id: r.drive_id, coords: JSON.parse(r.coords) }));
}

export async function charges(limit = 500): Promise<Charge[]> {
  const t = table("charges");
  if (!t) return [];
  return query<Charge>(
    `SELECT * EXCLUDE (start_ts, end_ts), epoch_ms(start_ts) AS start_ms, epoch_ms(end_ts) AS end_ms
     FROM '${t}' ORDER BY start_ts DESC LIMIT ${Number(limit)}`,
  );
}

export type Summary = {
  drives: number;
  km: number | null;
  kwh: number | null;
  wh_per_km: number | null;
  hours: number | null;
  charged_kwh: number | null;
};

export async function summary(days: number): Promise<Summary> {
  const d = table("drives");
  const c = table("charges");
  const empty = { drives: 0, km: null, kwh: null, wh_per_km: null, hours: null, charged_kwh: null };
  if (!d) return empty;
  const [s] = await query<Summary>(
    `SELECT count(*) AS drives, sum(distance_km) AS km, sum(energy_kwh) AS kwh,
            sum(energy_kwh) * 1000 / nullif(sum(distance_km) FILTER (WHERE energy_kwh IS NOT NULL), 0) AS wh_per_km,
            sum(duration_min) / 60 AS hours,
            ${c ? `(SELECT sum(energy_added_kwh) FROM '${c}' WHERE start_ts >= now() - INTERVAL ${Number(days)} DAY)` : "NULL"} AS charged_kwh
     FROM '${d}' WHERE start_ts >= now() - INTERVAL ${Number(days)} DAY`,
  );
  return s ?? empty;
}

export async function dailyKm(days = 30): Promise<{ label: string; value: number }[]> {
  const t = table("drives");
  if (!t) return [];
  const rows = await query<{ day: string; km: number }>(
    `WITH days AS (
       SELECT unnest(range(current_date - INTERVAL ${Number(days) - 1} DAY, current_date + INTERVAL 1 DAY, INTERVAL 1 DAY))::DATE AS day),
     k AS (
       SELECT (start_ts AT TIME ZONE '${TIMEZONE}')::DATE AS day, sum(distance_km) AS km FROM '${t}' GROUP BY 1)
     SELECT strftime(days.day, '%d/%m') AS day, coalesce(k.km, 0) AS km FROM days LEFT JOIN k USING (day) ORDER BY days.day`,
  );
  return rows.map((r) => ({ label: r.day, value: Number(r.km) }));
}
