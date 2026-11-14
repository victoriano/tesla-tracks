"use client";

import { useMemo, useRef, useState } from "react";
import { WHEELS, type Band, type TirePoint } from "@/lib/tires";

const TONES = {
  red: { bg: "rgba(239,68,68,0.13)", text: "#f87171", line: "#ef4444" },
  lime: { bg: "rgba(163,230,53,0.10)", text: "#a3e635", line: "#a3e635" },
  green: { bg: "rgba(34,197,94,0.12)", text: "#4ade80", line: "#22c55e" },
  amber: { bg: "rgba(245,158,11,0.16)", text: "#fbbf24", line: "#f59e0b" },
};

/** Pressure history drawn over the safety bands, as step lines (pressure only changes when reported). */
export default function TireChart({
  points,
  bands,
  yMin,
  yMax,
  timeZone,
  locale,
  endMs,
}: {
  points: TirePoint[];
  bands: Band[];
  yMin: number;
  yMax: number;
  timeZone: string;
  locale: string;
  endMs: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const H = 1000;
  const t0 = points[0]?.ms ?? 0;
  const t1 = Math.max(points[points.length - 1]?.ms ?? 1, endMs);
  const x = (ms: number) => ((ms - t0) / Math.max(1, t1 - t0)) * 100;
  const y = (bar: number) => H - ((Math.min(yMax, Math.max(yMin, bar)) - yMin) / (yMax - yMin)) * H;
  const fmtTime = useMemo(
    () => new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    [locale, timeZone],
  );

  const paths = WHEELS.map((w) => {
    let d = "";
    let last: number | null = null;
    for (const p of points) {
      const v = p[w.key];
      if (v === null) continue;
      d += d ? `H${x(p.ms).toFixed(3)}V${y(v).toFixed(1)}` : `M${x(p.ms).toFixed(3)},${y(v).toFixed(1)}`;
      last = v;
    }
    if (d && last !== null) d += `H${x(t1).toFixed(3)}`;
    return { ...w, d };
  });

  const onMove = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !points.length) return;
    const t = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
    let i = 0;
    while (i + 1 < points.length && points[i + 1].ms <= t) i++;
    setHover(i);
  };
  const hp = hover !== null ? points[hover] : null;

  return (
    <div>
      <div
        ref={box}
        className="relative h-[480px] overflow-hidden rounded-xl border border-zinc-800"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {bands.map((b) => {
          const top = (y(Math.min(b.to, yMax)) / H) * 100;
          const bottom = (y(Math.max(b.from, yMin)) / H) * 100;
          const t = TONES[b.tone];
          return (
            <div
              key={b.label}
              className="absolute inset-x-0 flex items-center justify-center text-[11px] font-medium uppercase tracking-[0.18em]"
              style={{
                top: `${top}%`,
                height: `${bottom - top}%`,
                background: t.bg,
                color: t.text,
                borderBottom: b.from > yMin ? `1px dashed ${t.line}80` : undefined,
              }}
            >
              {b.label}
            </div>
          );
        })}
        <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {paths.map((p) => (
            <path key={p.key} d={p.d} fill="none" stroke={p.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {hp ? (
          <>
            <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/50" style={{ left: `${x(hp.ms)}%` }} />
            <div className="pointer-events-none absolute right-2 top-2 rounded-lg border border-zinc-700 bg-zinc-950/90 px-3 py-2 text-xs">
              <div className="mb-1 text-zinc-400">{fmtTime.format(hp.ms)}</div>
              {WHEELS.map((w) => (
                <div key={w.key} className="flex justify-between gap-4 tabular-nums">
                  <span style={{ color: w.color }}>{w.label}</span>
                  <span>{hp[w.key]?.toFixed(2) ?? "—"} bar</span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
      <div className="mt-2 flex justify-between text-xs text-zinc-500 tabular-nums">
        <span>{points.length ? fmtTime.format(t0) : ""}</span>
        <span className="flex gap-3">
          {WHEELS.map((w) => (
            <span key={w.key} className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-3" style={{ background: w.color }} />
              {w.label}
            </span>
          ))}
        </span>
        <span>{fmtTime.format(t1)}</span>
      </div>
    </div>
  );
}
