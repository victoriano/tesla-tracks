"use client";

import { useMemo, useRef, useState } from "react";
import type { BatteryHistory, Span } from "@/lib/data";

const BANDS = [
  { key: "sentry", label: "Sentry on", color: "rgba(251,191,36,0.10)", dot: "#fbbf24" },
  { key: "drives", label: "Driving", color: "rgba(56,189,248,0.16)", dot: "#38bdf8" },
  { key: "charges", label: "Charging", color: "rgba(52,211,153,0.18)", dot: "#34d399" },
] as const;

export default function BatteryChart({ h, timeZone, locale }: { h: BatteryHistory; timeZone: string; locale: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const { startMs: t0, endMs: t1 } = h;
  const x = (ms: number) => ((ms - t0) / Math.max(1, t1 - t0)) * 100;
  const socs = h.points.map((p) => p.soc);
  const lo = Math.max(0, Math.floor((Math.min(...socs, 100) - 5) / 10) * 10);
  const hi = Math.min(100, Math.ceil((Math.max(...socs, 0) + 5) / 10) * 10);
  const H = 300;
  const y = (v: number) => H - ((v - lo) / Math.max(1, hi - lo)) * H;
  const fmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    [locale, timeZone],
  );

  // Connect points, but break the line across long gaps (car asleep with nothing to report).
  let d = "";
  h.points.forEach((p, i) => {
    const gap = i > 0 && p.ms - h.points[i - 1].ms > 6 * 3_600_000;
    d += `${!d ? "M" : gap ? `L${x(p.ms).toFixed(3)},${y(h.points[i - 1].soc).toFixed(1)}L` : "L"}${x(p.ms).toFixed(3)},${y(p.soc).toFixed(1)}`;
  });

  const onMove = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !h.points.length) return;
    const t = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
    let best = 0;
    h.points.forEach((p, i) => {
      if (Math.abs(p.ms - t) < Math.abs(h.points[best].ms - t)) best = i;
    });
    setHover(best);
  };
  const hp = hover !== null ? h.points[hover] : null;
  const spanOf = (spans: Span[], t: number) => spans.some((s) => t >= s.start && t <= s.end);
  const ticks = Array.from({ length: 5 }, (_, i) => t0 + ((t1 - t0) * i) / 4);

  return (
    <div>
      <div
        ref={box}
        className="relative h-72 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {BANDS.map((b) =>
          h[b.key].map((s, i) => (
            <div
              key={`${b.key}${i}`}
              className="absolute inset-y-0"
              style={{ left: `${x(Math.max(s.start, t0))}%`, width: `${Math.max(0.15, x(Math.min(s.end, t1)) - x(Math.max(s.start, t0)))}%`, background: b.color }}
            />
          )),
        )}
        {[lo, (lo + hi) / 2, hi].map((v) => (
          <div key={v} className="absolute inset-x-0 border-t border-dashed border-zinc-800" style={{ top: `${(y(v) / H) * 100}%` }}>
            <span className="absolute left-1 -translate-y-full text-[10px] text-zinc-500">{Math.round(v)}%</span>
          </div>
        ))}
        <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <path d={d} fill="none" stroke="#e4e4e7" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
        {hp ? (
          <>
            <div className="pointer-events-none absolute inset-y-0 w-px bg-white/50" style={{ left: `${x(hp.ms)}%` }} />
            <div className="pointer-events-none absolute top-2 right-2 rounded-lg border border-zinc-700 bg-zinc-950/90 px-3 py-2 text-xs tabular-nums">
              <div className="text-zinc-400">{fmt.format(hp.ms)}</div>
              <div className="text-base font-semibold">{hp.soc.toFixed(1)} %</div>
              <div className="text-zinc-400">
                {spanOf(h.charges, hp.ms) ? "charging" : spanOf(h.drives, hp.ms) ? "driving" : "parked"}
                {spanOf(h.sentry, hp.ms) ? " · Sentry on" : ""}
              </div>
            </div>
          </>
        ) : null}
      </div>
      <div className="relative mt-1 h-4 text-[10px] text-zinc-500 tabular-nums">
        {ticks.map((t, i) => (
          <span
            key={t}
            className="absolute whitespace-nowrap"
            style={{ left: `${(i / 4) * 100}%`, transform: i === 0 ? "none" : i === 4 ? "translateX(-100%)" : "translateX(-50%)" }}
          >
            {fmt.format(t)}
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-400">
        {BANDS.map((b) => (
          <span key={b.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: b.dot, opacity: 0.6 }} />
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}
