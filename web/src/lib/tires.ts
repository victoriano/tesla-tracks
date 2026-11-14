/** Shared by the tires page (server) and the tire chart (client). */
export type TirePoint = { ms: number; fl: number | null; fr: number | null; rl: number | null; rr: number | null };
export type Band = { from: number; to: number; label: string; tone: "red" | "lime" | "green" | "amber" };

export const WHEELS = [
  { key: "fl", label: "Front left", color: "#4ade80" },
  { key: "fr", label: "Front right", color: "#86efac" },
  { key: "rl", label: "Rear left", color: "#22c55e" },
  { key: "rr", label: "Rear right", color: "#bef264" },
] as const;
