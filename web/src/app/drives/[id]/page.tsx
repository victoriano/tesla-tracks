import { notFound } from "next/navigation";
import { connection } from "next/server";
import Link from "next/link";
import { CostValue, PricePicker } from "@/components/Cost";
import DriveExplorer from "@/components/DriveExplorer";
import DriverSelect from "@/components/DriverSelect";
import { driverOptions, readDrivers } from "@/lib/drivers";
import { Badge, Stat } from "@/components/ui";
import { drive, positions } from "@/lib/data";
import { dateTime, duration, fmt, CURRENCY, LOCALE_CODE, time, TIMEZONE } from "@/lib/format";
import type { TrackPoint } from "@/lib/driveMetrics";

export default async function DrivePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const [d, pts] = await Promise.all([drive(id), positions(id)]);
  if (!d) notFound();

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const track: TrackPoint[] = pts.map((p) => ({
    t: Number(p.ms),
    lat: Number(p.lat),
    lon: Number(p.lon),
    speed: num(p.speed_kmh),
    power: num(p.power_kw),
    soc: num(p.soc),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Link href="/drives" className="text-sm text-zinc-500 hover:text-zinc-300">
            ← Drives
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold">
            {dateTime(d.start_ms)} – {time(d.end_ms)} {d.in_progress ? <Badge tone="green">driving</Badge> : null}
          </h1>
            <DriverSelect driveId={d.drive_id} value={readDrivers()[d.drive_id] ?? "Unknown"} options={driverOptions()} size="md" />
          </div>
        </div>
        <div className="text-sm text-zinc-500">
          Odometer {fmt(d.start_odometer_km, 0)} → {fmt(d.end_odometer_km, 0, "km")}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Distance" value={fmt(d.distance_km, 1, "km")} />
        <Stat label="Duration" value={duration(d.duration_min)} hint={`${fmt(d.avg_outside_temp_c, 0, "°C")} outside`} />
        <Stat label="Consumption" value={fmt(d.wh_per_km, 0, "Wh/km")} hint={fmt(d.energy_kwh, 2, "kWh")} />
        <Stat label="Battery" value={`${fmt(d.start_soc, 0)}→${fmt(d.end_soc, 0, "%")}`} />
        <Stat label="Avg / max speed" value={fmt(d.avg_speed_kmh, 0)} hint={fmt(d.max_speed_kmh, 0, "km/h max")} />
        <Stat
          label="Cost"
          value={<CostValue kwh={d.energy_kwh === null ? null : Number(d.energy_kwh)} currency={CURRENCY} locale={LOCALE_CODE} />}
          hint={
            <PricePicker
              currency={CURRENCY}
              locale={LOCALE_CODE}
              align="right"
              kwh={d.energy_kwh === null ? null : Number(d.energy_kwh)}
            />
          }
        />
      </div>

      <DriveExplorer points={track} timeZone={TIMEZONE} locale={LOCALE_CODE} />
    </div>
  );
}
