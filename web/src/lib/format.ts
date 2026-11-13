const TZ = process.env.TZ || "UTC";
const LOCALE = process.env.TT_LOCALE || "en-US";

export const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

export function fmt(v: unknown, digits = 1, unit = ""): string {
  const n = num(v);
  if (n === null || Number.isNaN(n)) return "—";
  return `${n.toLocaleString(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: digits })}${unit ? ` ${unit}` : ""}`;
}

export function dateTime(ms: unknown): string {
  const n = num(ms);
  if (n === null) return "—";
  return new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }).format(n);
}

export function time(ms: unknown): string {
  const n = num(ms);
  if (n === null) return "—";
  return new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, timeStyle: "short" }).format(n);
}

export function duration(minutes: unknown): string {
  const m = num(minutes);
  if (m === null) return "—";
  const h = Math.floor(m / 60);
  const rest = Math.round(m % 60);
  return h ? `${h} h ${rest} min` : `${rest} min`;
}

export const TIMEZONE = TZ;
export const LOCALE_CODE = LOCALE;
