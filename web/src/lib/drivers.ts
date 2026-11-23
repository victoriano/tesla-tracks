import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Who drove each drive. Stored as a small JSON file next to (not inside) the telemetry data, so the
 * web container can write it while the Parquet data stays read-only.
 */
export const UNKNOWN = "Unknown";
export const OTHER = "Other";

const FILE = path.join(path.resolve(process.env.TT_ANNOTATIONS_DIR ?? "../annotations"), "drivers.json");

/** Names offered in the dropdown, from TT_DRIVERS (comma separated), plus Other. */
export function driverOptions(): string[] {
  const names = (process.env.TT_DRIVERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...names, OTHER];
}

export function isDemo(): boolean {
  return process.env.TT_DEMO === "1";
}

export function readDrivers(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

export function writeDriver(driveId: string, driver: string): void {
  const all = readDrivers();
  if (driver === UNKNOWN) delete all[driveId];
  else all[driveId] = driver;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, FILE);
}
