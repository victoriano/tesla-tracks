import Link from "next/link";
import { connection } from "next/server";
import { CostValue } from "@/components/Cost";
import { Empty } from "@/components/ui";
import { driverStats, type DriverStats } from "@/lib/driverStats";
import { UNKNOWN } from "@/lib/drivers";
import { CURRENCY, fmt, LOCALE_CODE } from "@/lib/format";

const RANGES: { key: string; label: string; days: number | null }[] = [
  { key: "30", label: "30 d", days: 30 },
  { key: "90", label: "90 d", days: 90 },
  { key: "365", label: "1 year", days: 365 },
  { key: "all", label: "All", days: null },
];

const COLORS = ["#f87171", "#38bdf8", "#a78bfa", "#34d399", "#fbbf24"];

function ScoreRing({ score, color }: { score: number | null; color: string }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-20 w-20 shrink-0">
      <svg viewBox="0 0 72 72" className="h-20 w-20 -rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#27272a" strokeWidth="7" />
        {score !== null ? (
          <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold">{score ?? "—"}</span>
        <span className="text-[9px] uppercase tracking-wide text-zinc-500">score</span>
      </div>
    </div>
  );
}

type Metric = {
  label: string;
  get: (s: DriverStats) => number | null;
  show: (v: number) => string;
  better: "low" | "high" | null;
  help: string;
};

const METRICS: Metric[] = [
  { label: "Distance", get: (s) => s.km, show: (v) => fmt(v, 0, "km"), better: null, help: "Total distance driven" },
  { label: "Drives", get: (s) => s.drives, show: (v) => fmt(v, 0), better: null, help: "Number of drives" },
  { label: "Time at the wheel", get: (s) => s.hours, show: (v) => fmt(v, 1, "h"), better: null, help: "" },
  { label: "Average speed", get: (s) => s.avgSpeed, show: (v) => fmt(v, 0, "km/h"), better: null, help: "Distance / time, including stops" },
  { label: "Consumption", get: (s) => s.whPerKm, show: (v) => fmt(v, 0, "Wh/km"), better: "low", help: "Raw energy per km (depends on where and when you drive)" },
  {
    label: "Efficiency vs expected",
    get: (s) => (s.efficiency === null ? null : (s.efficiency - 1) * 100),
    show: (v) => `${v > 0 ? "+" : ""}${fmt(v, 0, "%")}`,
    better: "low",
    help: "Energy used compared with what the car typically needs at the same average speeds and temperatures. Negative = more efficient.",
  },
  { label: "Hard accelerations", get: (s) => s.harshAccel100, show: (v) => `${fmt(v, 1)} /100 km`, better: "low", help: "Speed rising faster than 2.5 m/s²" },
  { label: "Hard braking", get: (s) => s.harshBrake100, show: (v) => `${fmt(v, 1)} /100 km`, better: "low", help: "Slowing down faster than 3 m/s²" },
  { label: "Sharp turns", get: (s) => s.sharpTurns100, show: (v) => `${fmt(v, 1)} /100 km`, better: "low", help: "Estimated sideways force above 3 m/s² (speed × turn rate)" },
  { label: "Energy recovered (regen)", get: (s) => (s.regenShare === null ? null : s.regenShare * 100), show: (v) => fmt(v, 0, "%"), better: "high", help: "Energy returned by regenerative braking / energy used to accelerate and cruise" },
  { label: "Time above 120 km/h", get: (s) => (s.fastShare === null ? null : s.fastShare * 100), show: (v) => fmt(v, 0, "%"), better: "low", help: "Share of moving time" },
];

export default async function DriversPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await connection();
  const { range: q } = await searchParams;
  const range = RANGES.find((r) => r.key === q) ?? RANGES[1];
  const { drivers, unassignedKm } = await driverStats(range.days);
  const people = drivers.filter((d) => d.name !== UNKNOWN);
  if (!drivers.length) return <Empty>No drives in this period yet.</Empty>;
  const color = (i: number) => COLORS[i % COLORS.length];
  const ranked = [...people].filter((p) => p.score !== null).sort((a, b) => (b.score as number) - (a.score as number));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Drivers</h1>
        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5 text-sm">
          {RANGES.map((r) => (
            <Link
              key={r.key}
              href={`/drivers?range=${r.key}`}
              className={`rounded-md px-3 py-1.5 ${r === range ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              {r.label}
            </Link>
          ))}
        </div>
      </div>

      {unassignedKm > 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-700 px-4 py-3 text-sm text-zinc-400">
          {fmt(unassignedKm, 0, "km")} in this period have no driver yet.{" "}
          <Link href="/drives" className="text-zinc-200 underline">
            Assign them in Drives
          </Link>{" "}
          for a fairer comparison.
        </p>
      ) : null}

      {people.length ? (
        <>
          {/* Share of kilometres */}
          <div>
            <div className="flex h-3 overflow-hidden rounded-full bg-zinc-800">
              {people.map((p, i) => (
                <div key={p.name} style={{ width: `${p.share * 100}%`, background: color(i) }} title={`${p.name}: ${fmt(p.share * 100, 0, "%")}`} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-400">
              {people.map((p, i) => (
                <span key={p.name} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: color(i) }} />
                  {p.name} · {fmt(p.share * 100, 0, "%")} of km
                </span>
              ))}
            </div>
          </div>

          {/* One card per driver */}
          <div className={`grid gap-4 ${people.length > 1 ? "md:grid-cols-2" : ""}`}>
            {people.map((p, i) => (
              <section key={p.name} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
                <div className="flex items-center gap-4">
                  <ScoreRing score={p.score} color={color(i)} />
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold">
                      {p.name}
                      {ranked[0] === p && ranked.length > 1 ? <span className="ml-2 text-sm">🏆</span> : null}
                    </h2>
                    <p className="text-sm text-zinc-400">
                      {fmt(p.km, 0, "km")} · {p.drives} drives · <CostValue kwh={p.kwh} currency={CURRENCY} locale={LOCALE_CODE} />
                    </p>
                  </div>
                </div>
                {p.parts ? (
                  <div className="mt-4 grid grid-cols-4 gap-2 text-center text-[11px] text-zinc-500">
                    {(
                      [
                        ["Smooth", p.parts.smooth],
                        ["Efficient", p.parts.efficient],
                        ["Anticipation", p.parts.anticipation],
                        ["Calm", p.parts.calm],
                      ] as const
                    ).map(([label, v]) => (
                      <div key={label}>
                        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                          <div className="h-full rounded-full" style={{ width: `${v}%`, background: color(i) }} />
                        </div>
                        <div className="mt-1">{label}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-zinc-500">Not enough data for a score yet.</p>
                )}
                {p.tips.length ? (
                  <ul className="mt-4 space-y-2 text-sm">
                    {p.tips.map((t, k) => (
                      <li key={k} className="flex gap-2">
                        <span className={t.good ? "text-emerald-400" : "text-amber-400"}>{t.good ? "✓" : "→"}</span>
                        <span className="text-zinc-300">{t.text}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        </>
      ) : (
        <Empty>Assign drivers to your drives in Drives to compare how each of you drives.</Empty>
      )}

      {/* Side by side table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3"> </th>
              {drivers.map((d, i) => (
                <th key={d.name} className="px-4 py-3 text-right" style={{ color: d.name === UNKNOWN ? undefined : color(i) }}>
                  {d.name === UNKNOWN ? "Unassigned" : d.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {METRICS.map((m) => {
              const vals = people.map((p) => m.get(p)).filter((v): v is number => v !== null);
              const best = m.better === "low" ? Math.min(...vals) : m.better === "high" ? Math.max(...vals) : null;
              return (
                <tr key={m.label}>
                  <td className="px-4 py-2.5 text-zinc-400" title={m.help}>
                    {m.label}
                    {m.help ? <span className="ml-1 cursor-help text-zinc-600">ⓘ</span> : null}
                  </td>
                  {drivers.map((d) => {
                    const v = m.get(d);
                    const isBest = best !== null && v === best && people.length > 1 && d.name !== UNKNOWN;
                    return (
                      <td key={d.name} className={`px-4 py-2.5 text-right tabular-nums ${d.name === UNKNOWN ? "text-zinc-500" : isBest ? "text-emerald-300" : ""}`}>
                        {v === null ? "—" : m.show(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
        <summary className="cursor-pointer text-zinc-300">How is this calculated?</summary>
        <div className="mt-3 space-y-2">
          <p>
            <b className="text-zinc-200">Efficiency vs expected</b> compares each driver&apos;s energy with what the car typically
            needs for drives at the same average speed and outside temperature (a model fitted on all your drives), so
            motorway trips or cold days don&apos;t count against anyone.
          </p>
          <p>
            <b className="text-zinc-200">Hard accelerations and braking</b> are counted from the speed the car reports every
            couple of seconds (above 2.5 m/s² speeding up, 3 m/s² slowing down). <b className="text-zinc-200">Sharp turns</b> are
            estimated from speed × change of GPS heading, so they are approximate.
          </p>
          <p>
            <b className="text-zinc-200">Regen</b> is energy returned to the battery while slowing down, relative to the energy
            used to accelerate and cruise: the more you anticipate and lift off instead of braking, the higher.
          </p>
          <p>
            <b className="text-zinc-200">Score</b> (experimental) = 35% smoothness + 35% efficiency + 20% anticipation + 10% calm
            (time above 120 km/h). Compare drivers over similar trips: city driving naturally has more braking.
          </p>
        </div>
      </details>
    </div>
  );
}
