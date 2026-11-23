import Link from "next/link";
import { connection } from "next/server";
import BatteryChart from "@/components/BatteryChart";
import { Empty, Stat } from "@/components/ui";
import { batteryHistory, packKwh, parkedDrain } from "@/lib/data";
import { fmt, LOCALE_CODE, TIMEZONE } from "@/lib/format";

const RANGES = [1, 3, 7, 30];

export default async function BatteryPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await connection();
  const { days: q } = await searchParams;
  const days = RANGES.includes(Number(q)) ? Number(q) : 7;
  const [h, reported] = await Promise.all([batteryHistory(days), packKwh()]);
  // Battery capacity: what the car reports, else TT_BATTERY_KWH, else a Model 3 RWD estimate.
  const KWH_PER_PCT = (reported ?? Number(process.env.TT_BATTERY_KWH || "57.5")) / 100;
  if (!h.points.length) return <Empty>No battery readings in this period yet.</Empty>;
  const drain = parkedDrain(h);
  const last = h.points[h.points.length - 1];
  const kwhDay = (pct: number | null) => (pct === null ? null : pct * KWH_PER_PCT);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Battery</h1>
        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5 text-sm">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/battery?days=${r}`}
              className={`rounded-md px-3 py-1.5 ${r === days ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              {r === 1 ? "24 h" : `${r} d`}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Now" value={fmt(last.soc, 1, "%")} />
        <Stat
          label="Lost while parked"
          value={fmt(drain.total, 1, "%")}
          hint={`over ${fmt(drain.hours, 0, "h")} parked · ≈ ${fmt(drain.total * KWH_PER_PCT, 1, "kWh")}`}
        />
        <Stat
          label="Parked, Sentry on"
          value={drain.sentryOn === null ? "—" : `${fmt(drain.sentryOn, 1)} %/day`}
          hint={drain.sentryOn === null ? "no data" : `≈ ${fmt(kwhDay(drain.sentryOn), 1, "kWh/day")}`}
        />
        <Stat
          label="Parked, Sentry off"
          value={drain.sentryOff === null ? "—" : `${fmt(drain.sentryOff, 1)} %/day`}
          hint={drain.sentryOff === null ? "no data" : `≈ ${fmt(kwhDay(drain.sentryOff), 1, "kWh/day")}`}
        />
      </div>

      <BatteryChart h={h} timeZone={TIMEZONE} locale={LOCALE_CODE} />
      <p className="text-xs text-zinc-500">
        The car only reports while it is awake; a sleeping car shows as a straight line between readings. kWh are
        estimated from a {fmt(KWH_PER_PCT * 100, 1)} kWh battery{reported ? " (as reported by the car)" : ""}.
      </p>
    </div>
  );
}
