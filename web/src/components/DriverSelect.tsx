"use client";

import { useState, useTransition } from "react";
import { UserRound } from "lucide-react";
import { setDriver } from "@/app/actions";

const UNKNOWN = "Unknown";

export default function DriverSelect({
  driveId,
  value,
  options,
  size = "sm",
}: {
  driveId: string;
  value: string;
  options: string[];
  size?: "sm" | "md";
}) {
  const [current, setCurrent] = useState(value || UNKNOWN);
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  const unknown = current === UNKNOWN;

  return (
    <label
      className={`relative inline-flex items-center gap-1.5 rounded-lg border ${
        error ? "border-red-500/60" : unknown ? "border-dashed border-zinc-700" : "border-zinc-700 bg-zinc-800/60"
      } ${size === "md" ? "px-3 py-1.5 text-sm" : "px-2 py-1 text-xs"} ${pending ? "opacity-60" : ""}`}
      title="Who was driving?"
      onClick={(e) => e.stopPropagation()}
    >
      <UserRound className={`${size === "md" ? "h-4 w-4" : "h-3.5 w-3.5"} ${unknown ? "text-zinc-500" : "text-red-400"}`} />
      <span className={unknown ? "text-zinc-500" : "text-zinc-100"}>{current}</span>
      <span className="text-zinc-500">▾</span>
      <select
        aria-label="Driver"
        className="absolute inset-0 cursor-pointer opacity-0"
        value={current}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const prev = current;
          setCurrent(next);
          setError(false);
          start(async () => {
            const r = await setDriver(driveId, next);
            if (!r.ok) {
              setCurrent(prev);
              setError(true);
            }
          });
        }}
      >
        <option value={UNKNOWN}>Unknown</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
