import Link from "next/link";
import { connection } from "next/server";
import TireChart from "@/components/TireChart";
import { WHEELS, type Band } from "@/lib/tires";
import { Empty } from "@/components/ui";
import { nowMs, tires } from "@/lib/data";
import { LOCALE_CODE, TIMEZONE } from "@/lib/format";

// Recommended cold pressure (Model 3 Highland: 2.9 bar, see the label on the driver's door pillar).
const REC = Number(process.env.TT_TIRE_RECOMMENDED_BAR || "2.9");
const BANDS: Band[] = [
  { from: REC + 0.6, to: 99, label: `>${(REC + 0.6).toFixed(1)} bar · unsafe`, tone: "red" },
  { from: REC + 0.2, to: REC + 0.6, label: `>${(REC + 0.2).toFixed(1)} bar · harsher ride & wear`, tone: "lime" },
  { from: REC - 0.4, to: REC + 0.2, label: "optimal", tone: "green" },
  { from: REC - 1.0, to: REC - 0.4, label: `<${(REC - 0.4).toFixed(1)} bar · reduced handling & efficiency`, tone: "amber" },
  { from: -99, to: REC - 1.0, label: `<${(REC - 1.0).toFixed(1)} bar · unsafe`, tone: "red" },
];
const RANGES = [7, 30, 90];

function status(bar: number | null) {
  if (bar === null) return { icon: "–", cls: "bg-zinc-800 text-zinc-500", note: "no data" };
  if (bar > REC + 0.6 || bar < REC - 1.0) return { icon: "✕", cls: "bg-red-500/15 text-red-400", note: "unsafe" };
  if (bar > REC + 0.2) return { icon: "!", cls: "bg-lime-500/15 text-lime-300", note: "high" };
  if (bar < REC - 0.4) return { icon: "!", cls: "bg-amber-500/15 text-amber-300", note: "low" };
  return { icon: "✓", cls: "bg-emerald-500/15 text-emerald-400", note: "ok" };
}

export default async function TiresPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await connection();
  const { days: d } = await searchParams;
  const days = RANGES.includes(Number(d)) ? Number(d) : 30;
  const [rows, end] = await Promise.all([tires(days), nowMs()]);
  if (!rows.length) return <Empty>No tire pressure readings yet.</Empty>;
  const last = rows[rows.length - 1];
  const anyValue = rows.some((r) => r.fl !== null || r.fr !== null || r.rl !== null || r.rr !== null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">💡 Recommended cold pressure: {REC.toFixed(1)} bar</p>
        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5 text-sm">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/tires?days=${r}`}
              className={`rounded-md px-3 py-1.5 ${r === days ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              {r} d
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {WHEELS.map((w) => {
          const v = last[w.key];
          const s = status(v);
          return (
            <div key={w.key} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
              <span className={`flex h-10 w-10 items-center justify-center rounded-full text-lg ${s.cls}`} title={s.note}>
                {s.icon}
              </span>
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">{w.label}</div>
                <div className="text-xl font-semibold tabular-nums">{v === null ? "—" : `${v.toFixed(2)} bar`}</div>
              </div>
            </div>
          );
        })}
      </div>

      {!anyValue ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-400">
          The tire sensors only report once the car is moving: pressures will show up after the next drive.
        </p>
      ) : null}
      <TireChart points={rows} bands={BANDS} yMin={REC - 1.4} yMax={REC + 1.0} timeZone={TIMEZONE} locale={LOCALE_CODE} endMs={end} />
      <p className="text-xs text-zinc-500">
        Pressure rises about 0.1–0.2 bar once the tires are warm after driving; compare cold readings with the
        recommended value.
      </p>
    </div>
  );
}
