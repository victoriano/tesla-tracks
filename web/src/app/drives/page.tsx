import { connection } from "next/server";
import { CostValue, PricePicker } from "@/components/Cost";
import { Badge, Empty } from "@/components/ui";
import { drives } from "@/lib/data";
import { CURRENCY, dateTime, duration, fmt, LOCALE_CODE, time } from "@/lib/format";
import Link from "next/link";

export default async function DrivesPage() {
  await connection();
  const rows = await drives(1000);
  if (!rows.length) return <Empty>No drives yet.</Empty>;

  return (
    <div className="space-y-3">
    <div className="flex items-center justify-end gap-2 text-xs text-zinc-500">
      Costs at <PricePicker currency={CURRENCY} locale={LOCALE_CODE} align="right" />
    </div>
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="px-4 py-3">Start</th>
            <th className="px-4 py-3">End</th>
            <th className="px-4 py-3 text-right">Distance</th>
            <th className="px-4 py-3 text-right">Duration</th>
            <th className="px-4 py-3 text-right">Battery</th>
            <th className="px-4 py-3 text-right">Energy</th>
            <th className="px-4 py-3 text-right">Consumption</th>
            <th className="px-4 py-3 text-right">Cost</th>
            <th className="px-4 py-3 text-right">Max speed</th>
            <th className="px-4 py-3 text-right">Outside</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/70">
          {rows.map((d) => (
            <tr key={d.drive_id} className="hover:bg-zinc-900/70">
              <td className="px-4 py-2.5">
                <Link href={`/drives/${d.drive_id}`} className="hover:text-red-400">
                  {dateTime(d.start_ms)}
                </Link>{" "}
                {d.in_progress ? <Badge tone="green">driving</Badge> : null}
              </td>
              <td className="px-4 py-2.5 text-zinc-400">{time(d.end_ms)}</td>
              <td className="px-4 py-2.5 text-right">{fmt(d.distance_km, 1, "km")}</td>
              <td className="px-4 py-2.5 text-right text-zinc-400">{duration(d.duration_min)}</td>
              <td className="px-4 py-2.5 text-right text-zinc-400">
                {fmt(d.start_soc, 0)}→{fmt(d.end_soc, 0, "%")}
              </td>
              <td className="px-4 py-2.5 text-right text-zinc-400">{fmt(d.energy_kwh, 1, "kWh")}</td>
              <td className="px-4 py-2.5 text-right">{fmt(d.wh_per_km, 0, "Wh/km")}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                <CostValue kwh={d.energy_kwh === null ? null : Number(d.energy_kwh)} currency={CURRENCY} locale={LOCALE_CODE} />
              </td>
              <td className="px-4 py-2.5 text-right text-zinc-400">{fmt(d.max_speed_kmh, 0, "km/h")}</td>
              <td className="px-4 py-2.5 text-right text-zinc-400">{fmt(d.avg_outside_temp_c, 0, "°C")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  );
}
