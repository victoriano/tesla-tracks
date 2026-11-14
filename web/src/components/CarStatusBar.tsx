import type { CarStatus } from "@/lib/data";

function ago(ms: number) {
  const m = Math.round(ms / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function Pill({ label, value, tone }: { label: string; value: string; tone: "green" | "amber" | "red" | "zinc" }) {
  const tones = {
    green: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    amber: "bg-amber-500/10 text-amber-300 border-amber-500/20",
    red: "bg-red-500/10 text-red-300 border-red-500/20",
    zinc: "bg-zinc-800/60 text-zinc-300 border-zinc-700/60",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${tones[tone]}`}>
      <span className="text-zinc-500">{label}</span> {value}
    </span>
  );
}

export default function CarStatusBar({ s }: { s: CarStatus }) {
  const sentryOn = s.sentry && !["Off", "Unknown"].includes(s.sentry);
  const sentryTone = s.sentry === null ? "zinc" : s.sentry === "Panic" ? "red" : sentryOn ? "green" : "amber";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pill label="Sentry" value={s.sentry === null ? "—" : sentryOn ? `On · ${s.sentry}` : "Off"} tone={sentryTone} />
      <Pill
        label="Doors"
        value={s.locked === null ? "—" : s.locked ? "Locked" : "Unlocked"}
        tone={s.locked === null ? "zinc" : s.locked ? "green" : "amber"}
      />
      <Pill label="Battery" value={s.soc === null ? "—" : `${Math.round(s.soc)} %`} tone="zinc" />
      {s.charge === "Charging" || s.charge === "Starting" ? <Pill label="Charging" value={s.charge} tone="green" /> : null}
      <span className="ml-1 text-xs text-zinc-500">
        {s.lastSeenMs ? `last data ${ago(s.nowMs - s.lastSeenMs)}` : "no data yet"}
      </span>
    </div>
  );
}
