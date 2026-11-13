import { notFound } from "next/navigation";
import { connection } from "next/server";
import Link from "next/link";
import { Line } from "@/components/charts";
import RouteMap from "@/components/RouteMap";
import { Badge, Card, Stat } from "@/components/ui";
import { drive, positions } from "@/lib/data";
import { dateTime, duration, fmt, time } from "@/lib/format";

export default async function DrivePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const [d, pts] = await Promise.all([drive(id), positions(id)]);
  if (!d) notFound();

  const coords = pts.map((p) => [Number(p.lon), Number(p.lat)] as [number, number]);
  const series = (key: "speed_kmh" | "soc" | "power_kw") =>
    pts.map((p) => ({ x: Number(p.ms), y: p[key] === null ? null : Number(p[key]) }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Link href="/drives" className="text-sm text-zinc-500 hover:text-zinc-300">
            ← Drives
          </Link>
          <h1 className="mt-1 text-xl font-semibold">
            {dateTime(d.start_ms)} – {time(d.end_ms)} {d.in_progress ? <Badge tone="green">driving</Badge> : null}
          </h1>
        </div>
        <div className="text-sm text-zinc-500">
          Odometer {fmt(d.start_odometer_km, 0)} → {fmt(d.end_odometer_km, 0, "km")}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Distance" value={fmt(d.distance_km, 1, "km")} />
        <Stat label="Duration" value={duration(d.duration_min)} />
        <Stat label="Consumption" value={fmt(d.wh_per_km, 0, "Wh/km")} hint={fmt(d.energy_kwh, 2, "kWh")} />
        <Stat label="Battery" value={`${fmt(d.start_soc, 0)}→${fmt(d.end_soc, 0, "%")}`} />
        <Stat label="Avg / max speed" value={fmt(d.avg_speed_kmh, 0)} hint={fmt(d.max_speed_kmh, 0, "km/h max")} />
        <Stat label="Outside" value={fmt(d.avg_outside_temp_c, 0, "°C")} />
      </div>

      {coords.length > 1 ? <RouteMap routes={[{ id: d.drive_id, coords }]} /> : null}

      <Card>
        <div className="grid gap-6 md:grid-cols-3">
          <Line points={series("speed_kmh")} label="Speed" unit="km/h" color="stroke-sky-400" />
          <Line points={series("power_kw")} label="Power (− regen)" unit="kW" color="stroke-amber-400" />
          <Line points={series("soc")} label="Battery" unit="%" color="stroke-emerald-400" />
        </div>
      </Card>
    </div>
  );
}
