import RouteMap from "@/components/RouteMap";
import { Card, Stat } from "@/components/ui";
import type { CarStatus } from "@/lib/data";
import { fmt } from "@/lib/format";

/** What the car reports right now; shown before the first drive (and handy afterwards). */
export default function CarNow({ s }: { s: CarStatus }) {
  const here: [number, number] | null = s.lat !== null && s.lon !== null ? [s.lon, s.lat] : null;
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="grid grid-cols-2 gap-3 lg:col-span-2">
        <Stat label="Battery" value={fmt(s.soc, 0, "%")} hint={s.chargeLimit ? `limit ${fmt(s.chargeLimit, 0, "%")}` : undefined} />
        <Stat label="Range" value={fmt(s.rangeKm, 0, "km")} hint={s.energyKwh ? `${fmt(s.energyKwh, 1, "kWh")} left` : undefined} />
        <Stat label="Inside" value={fmt(s.insideC, 1, "°C")} hint={s.outsideC !== null ? `${fmt(s.outsideC, 1, "°C")} outside` : undefined} />
        <Stat label="Odometer" value={fmt(s.odometerKm, 0, "km")} hint={s.version ? `software ${s.version}` : undefined} />
      </div>
      <Card title="Where it is" className="lg:col-span-3">
        {here ? (
          <RouteMap routes={[{ id: "now", coords: [here, here] }]} height={260} />
        ) : (
          <p className="text-sm text-zinc-500">No location yet.</p>
        )}
      </Card>
    </div>
  );
}
