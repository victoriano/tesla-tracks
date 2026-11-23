import "server-only";
import { query, rawTelemetry, table } from "./db";
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

export type TireRow = { ms: number; fl: number | null; fr: number | null; rl: number | null; rr: number | null };

/** Tire pressures (bar) over the last `days`, plus the reading just before the window so lines start at the edge. */
export async function tires(days = 30): Promise<TireRow[]> {
  const t = table("tires");
  if (!t) return [];
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const rows = await query<TireRow>(
    `WITH w AS (SELECT * FROM '${t}' WHERE ts >= now() - INTERVAL ${Number(days)} DAY),
          prev AS (SELECT * FROM '${t}' WHERE ts < now() - INTERVAL ${Number(days)} DAY ORDER BY ts DESC LIMIT 1)
     SELECT epoch_ms(ts) AS ms, fl_bar AS fl, fr_bar AS fr, rl_bar AS rl, rr_bar AS rr
     FROM (SELECT * FROM prev UNION ALL SELECT * FROM w) ORDER BY ts`,
  );
  // epoch_ms comes back as a string (BIGINT): make every field a number
  return rows.map((r) => ({ ms: Number(r.ms), fl: n(r.fl), fr: n(r.fr), rl: n(r.rl), rr: n(r.rr) }));
}

/** Current time as seen by the database (keeps render functions pure). */
export async function nowMs(): Promise<number> {
  const [r] = await query<{ ms: number }>("SELECT epoch_ms(now()) AS ms");
  return Number(r.ms);
}

export type CarStatus = {
  sentry: string | null; // Off | Idle | Armed | Aware | Panic | Quiet
  locked: boolean | null;
  soc: number | null;
  charge: string | null;
  rangeKm: number | null;
  insideC: number | null;
  outsideC: number | null;
  odometerKm: number | null;
  chargeLimit: number | null;
  energyKwh: number | null;
  version: string | null;
  lat: number | null;
  lon: number | null;
  lastSeenMs: number | null;
  nowMs: number;
};

/** Latest value of a few state signals, straight from raw telemetry. */
export async function carStatus(): Promise<CarStatus | null> {
  const g = rawTelemetry();
  if (!g) return null;
  try {
    const rows = await query<{ field: string; num: number | null; str: string | null; ms: number }>(
      `SELECT field, arg_max(value_num, ts) AS num, arg_max(value_str, ts) AS str, epoch_ms(max(ts)) AS ms
       FROM read_parquet('${g}', hive_partitioning=false)
       WHERE field IN ('SentryMode', 'Locked', 'BatteryLevel', 'DetailedChargeState', 'EstBatteryRange', 'InsideTemp',
                       'OutsideTemp', 'Odometer', 'ChargeLimitSoc', 'EnergyRemaining', 'Version',
                       'Location.latitude', 'Location.longitude')
         AND ts >= now() - INTERVAL 30 DAY AND coalesce(value_str, '') <> 'invalid'
       GROUP BY field`,
    );
    const [seen] = await query<{ ms: number | null; now: number }>(
      `SELECT epoch_ms(max(received_at)) AS ms, epoch_ms(now()) AS now
       FROM read_parquet('${g}', hive_partitioning=false) WHERE ts >= now() - INTERVAL 30 DAY`,
    );
    const by = Object.fromEntries(rows.map((r) => [r.field, r]));
    const n = (f: string) => (by[f]?.num === null || by[f]?.num === undefined ? null : Number(by[f].num));
    const MI = 1.609344; // telemetry reports miles
    return {
      sentry: by.SentryMode?.str ?? null,
      locked: by.Locked ? Number(by.Locked.num) === 1 : null,
      soc: by.BatteryLevel?.num === undefined || by.BatteryLevel?.num === null ? null : Number(by.BatteryLevel.num),
      charge: by.DetailedChargeState?.str ?? null,
      rangeKm: n("EstBatteryRange") === null ? null : (n("EstBatteryRange") as number) * MI,
      insideC: n("InsideTemp"),
      outsideC: n("OutsideTemp"),
      odometerKm: n("Odometer") === null ? null : (n("Odometer") as number) * MI,
      chargeLimit: n("ChargeLimitSoc"),
      energyKwh: n("EnergyRemaining"),
      version: by.Version?.str ?? null,
      lat: n("Location.latitude"),
      lon: n("Location.longitude"),
      lastSeenMs: seen?.ms === null || seen?.ms === undefined ? null : Number(seen.ms),
      nowMs: Number(seen?.now ?? 0),
    };
  } catch {
    return null; // no raw files yet
  }
}

export type Span = { start: number; end: number };
export type BatteryHistory = {
  points: { ms: number; soc: number }[];
  drives: Span[];
  charges: Span[];
  sentry: Span[];
  startMs: number;
  endMs: number;
};

/** Battery level (one value per 10 minutes) plus the drive, charge and Sentry Mode periods of the window. */
export async function batteryHistory(days: number): Promise<BatteryHistory> {
  const g = rawTelemetry();
  const [{ now }] = await query<{ now: number }>("SELECT epoch_ms(now()) AS now");
  const endMs = Number(now);
  const startMs = endMs - days * 86_400_000;
  const empty = { points: [], drives: [], charges: [], sentry: [], startMs, endMs };
  if (!g) return empty;
  const since = `now() - INTERVAL ${Number(days)} DAY`;
  try {
    const pts = await query<{ ms: number; soc: number }>(
      `SELECT epoch_ms(max(ts)) AS ms, arg_max(value_num, ts) AS soc
       FROM read_parquet('${g}', hive_partitioning=false)
       WHERE field = 'BatteryLevel' AND value_num IS NOT NULL AND ts >= ${since}
       GROUP BY time_bucket(INTERVAL 10 MINUTE, ts) ORDER BY 1`,
    );
    const spans = async (name: "drives" | "charges") => {
      const t = table(name);
      if (!t) return [];
      const r = await query<{ s: number; e: number }>(
        `SELECT epoch_ms(start_ts) AS s, epoch_ms(end_ts) AS e FROM '${t}' WHERE end_ts >= ${since} ORDER BY start_ts`,
      );
      return r.map((x) => ({ start: Number(x.s), end: Number(x.e) }));
    };
    // Sentry: state changes (plus the last one before the window) -> armed intervals
    const sm = await query<{ ms: number; v: string }>(
      `WITH s AS (SELECT ts, value_str AS v FROM read_parquet('${g}', hive_partitioning=false)
                  WHERE field = 'SentryMode' AND value_str IS NOT NULL AND value_str <> 'invalid')
       SELECT epoch_ms(ts) AS ms, v FROM (
         SELECT * FROM s WHERE ts >= ${since}
         UNION ALL (SELECT * FROM s WHERE ts < ${since} ORDER BY ts DESC LIMIT 1)) ORDER BY ts`,
    );
    const sentry: Span[] = [];
    let open: number | null = null;
    for (const r of sm) {
      const on = !["Off", "Unknown"].includes(r.v);
      const t = Math.max(Number(r.ms), startMs);
      if (on && open === null) open = t;
      if (!on && open !== null) {
        sentry.push({ start: open, end: t });
        open = null;
      }
    }
    if (open !== null) sentry.push({ start: open, end: endMs });
    return {
      points: pts.map((p) => ({ ms: Number(p.ms), soc: Number(p.soc) })),
      drives: await spans("drives"),
      charges: await spans("charges"),
      sentry,
      startMs,
      endMs,
    };
  } catch {
    return empty;
  }
}

/** Battery lost while parked (not driving, not charging), split by Sentry Mode, in % per day. */
export function parkedDrain(h: BatteryHistory) {
  const inside = (t: number, spans: Span[]) => spans.some((s) => t >= s.start - 60_000 && t <= s.end + 60_000);
  const acc = { on: { pct: 0, ms: 0 }, off: { pct: 0, ms: 0 } };
  for (let i = 1; i < h.points.length; i++) {
    const a = h.points[i - 1];
    const b = h.points[i];
    const gap = b.ms - a.ms;
    const drop = a.soc - b.soc;
    if (gap > 12 * 3_600_000 || drop < -0.05) continue; // data gap, or it charged
    const overlaps = (spans: Span[]) => spans.some((s) => s.start - 60_000 < b.ms && s.end + 60_000 > a.ms);
    if (overlaps(h.drives) || overlaps(h.charges)) continue; // only purely parked stretches
    const k = inside((a.ms + b.ms) / 2, h.sentry) ? acc.on : acc.off;
    k.pct += Math.max(0, drop);
    k.ms += gap;
  }
  const rate = (x: { pct: number; ms: number }) => (x.ms >= 3_600_000 ? (x.pct / x.ms) * 86_400_000 : null);
  return {
    sentryOn: rate(acc.on),
    sentryOff: rate(acc.off),
    total: acc.on.pct + acc.off.pct,
    hours: (acc.on.ms + acc.off.ms) / 3_600_000,
  };
}

/** Usable pack energy in kWh as reported by the car (NominalFullPackEnergyKwh), if available. */
export async function packKwh(): Promise<number | null> {
  const g = rawTelemetry();
  if (!g) return null;
  try {
    const [r] = await query<{ v: number | null }>(
      `SELECT arg_max(value_num, ts) AS v FROM read_parquet('${g}', hive_partitioning=false)
       WHERE field = 'NominalFullPackEnergyKwh' AND value_num > 10`,
    );
    return r?.v === null || r?.v === undefined ? null : Number(r.v);
  } catch {
    return null;
  }
}
