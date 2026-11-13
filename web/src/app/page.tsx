import { connection } from "next/server";
import { Bars } from "@/components/charts";
import RouteMap from "@/components/RouteMap";
import { CostValue, PricePicker } from "@/components/Cost";
import { Card, Empty, RowLink, Stat } from "@/components/ui";
import { dailyKm, drives, recentRoutes, summary } from "@/lib/data";
import { CURRENCY, dateTime, duration, fmt, LOCALE_CODE } from "@/lib/format";

export default async function Overview() {
  await connection(); // always read fresh Parquet
  const [s30, s365, days, latest, routes] = await Promise.all([
    summary(30),
    summary(365),
    dailyKm(30),
    drives(8),
    recentRoutes(30),
  ]);

  if (!latest.length) {
    return (
      <Empty>
        No drives yet. Once the car streams to fleet-telemetry and the ingester runs, drives show up here.
      </Empty>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Distance · 30 d" value={fmt(s30.km, 0, "km")} hint={`${fmt(s365.km, 0, "km")} in 12 months`} />
        <Stat label="Drives · 30 d" value={s30.drives} hint={`${fmt(s30.hours, 1, "h")} driving`} />
        <Stat label="Consumption · 30 d" value={fmt(s30.wh_per_km, 0, "Wh/km")} hint={`${fmt(s365.wh_per_km, 0)} over 12 months`} />
        <Stat
          label="Energy used · 30 d"
          value={fmt(s30.kwh, 0, "kWh")}
          hint={
            <span className="flex flex-wrap items-center gap-1">
              ≈ <CostValue kwh={s30.kwh === null ? null : Number(s30.kwh)} currency={CURRENCY} locale={LOCALE_CODE} /> at{" "}
              <PricePicker currency={CURRENCY} locale={LOCALE_CODE} kwh={s30.kwh === null ? null : Number(s30.kwh)} />
            </span>
          }
        />
        <Stat label="Energy charged · 30 d" value={fmt(s30.charged_kwh, 0, "kWh")} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Last 30 days" className="lg:col-span-3">
          <RouteMap routes={routes} height={360} />
        </Card>
        <Card title="Kilometres per day" className="lg:col-span-2">
          <Bars data={days} unit="km" />
        </Card>
      </div>

      <Card title="Latest drives">
        <div className="-mx-3 divide-y divide-zinc-800/70">
          {latest.map((d) => (
            <RowLink key={d.drive_id} href={`/drives/${d.drive_id}`}>
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-zinc-300">{dateTime(d.start_ms)}</span>
                <span className="flex gap-6 text-zinc-400">
                  <span className="w-20 text-right text-zinc-100">{fmt(d.distance_km, 1, "km")}</span>
                  <span className="hidden w-20 text-right sm:inline">{duration(d.duration_min)}</span>
                  <span className="hidden w-24 text-right md:inline">{fmt(d.wh_per_km, 0, "Wh/km")}</span>
                  <span className="w-24 text-right">
                    {fmt(d.start_soc, 0)}→{fmt(d.end_soc, 0, "%")}
                  </span>
                </span>
              </div>
            </RowLink>
          ))}
        </div>
      </Card>
    </div>
  );
}
