/** Tiny dependency-free SVG charts. */

type Point = { x: number; y: number | null };

export function Bars({ data, unit = "", height = 140 }: { data: { label: string; value: number }[]; unit?: string; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / Math.max(1, data.length);
  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-36 w-full">
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 4);
          return (
            <rect key={d.label} x={i * w + w * 0.15} y={height - h} width={w * 0.7} height={h} rx={0.6} className="fill-red-500/80">
              <title>{`${d.label}: ${d.value.toFixed(1)} ${unit}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
        <span>{data[0]?.label}</span>
        <span>
          max {max.toFixed(0)} {unit}
        </span>
        <span>{data.at(-1)?.label}</span>
      </div>
    </div>
  );
}

export function Line({
  points,
  color = "stroke-sky-400",
  height = 120,
  label,
  unit = "",
}: {
  points: Point[];
  color?: string;
  height?: number;
  label: string;
  unit?: string;
}) {
  const valid = points.filter((p): p is { x: number; y: number } => p.y !== null && Number.isFinite(p.y));
  if (valid.length < 2) return null;
  const xs = valid.map((p) => p.x);
  const ys = valid.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (x: number) => ((x - x0) / Math.max(1, x1 - x0)) * 100;
  const sy = (y: number) => height - 2 - ((y - y0) / Math.max(1e-9, y1 - y0)) * (height - 4);
  const d = valid.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(" ");
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-zinc-500">
        <span>{label}</span>
        <span>
          {y0.toFixed(0)}–{y1.toFixed(0)} {unit}
        </span>
      </div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-28 w-full">
        <path d={d} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={1.5} className={color} />
      </svg>
    </div>
  );
}
