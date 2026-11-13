import { connection } from "next/server";
import { Badge, Empty, Stat } from "@/components/ui";
import { charges } from "@/lib/data";
import { dateTime, duration, fmt, num } from "@/lib/format";

export default async function ChargesPage() {
  await connection();
  const rows = await charges(1000);
  if (!rows.length) return <Empty>No charging sessions yet.</Empty>;

  const total = rows.reduce((s, c) => s + (num(c.energy_added_kwh) ?? 0), 0);
  const dcShare = rows.filter((c) => c.charger === "DC").reduce((s, c) => s + (num(c.energy_added_kwh) ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sessions" value={rows.length} />
        <Stat label="Energy added" value={fmt(total, 0, "kWh")} />
        <Stat label="Fast charging share" value={fmt(total ? (dcShare / total) * 100 : null, 0, "%")} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3">Start</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3 text-right">Duration</th>
              <th className="px-4 py-3 text-right">Battery</th>
              <th className="px-4 py-3 text-right">Added</th>
              <th className="px-4 py-3 text-right">Max power</th>
              <th className="px-4 py-3">Location</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {rows.map((c) => (
              <tr key={c.charge_id} className="hover:bg-zinc-900/70">
                <td className="px-4 py-2.5">
                  {dateTime(c.start_ms)} {c.in_progress ? <Badge tone="green">charging</Badge> : null}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={c.charger === "DC" ? "amber" : "sky"}>{c.charger}</Badge>{" "}
                  <span className="text-xs text-zinc-500">{c.fast_charger_type ?? ""}</span>
                </td>
                <td className="px-4 py-2.5 text-right text-zinc-400">{duration(c.duration_min)}</td>
                <td className="px-4 py-2.5 text-right text-zinc-400">
                  {fmt(c.start_soc, 0)}→{fmt(c.end_soc, 0, "%")}
                </td>
                <td className="px-4 py-2.5 text-right">{fmt(c.energy_added_kwh, 1, "kWh")}</td>
                <td className="px-4 py-2.5 text-right text-zinc-400">{fmt(c.max_power_kw, 0, "kW")}</td>
                <td className="px-4 py-2.5 text-zinc-500">
                  {c.lat !== null && c.lon !== null ? (
                    <a
                      className="hover:text-zinc-300"
                      href={`https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=16/${c.lat}/${c.lon}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {fmt(c.lat, 4)}, {fmt(c.lon, 4)}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
