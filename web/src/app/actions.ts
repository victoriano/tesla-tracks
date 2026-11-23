"use server";

import { revalidatePath } from "next/cache";
import { UNKNOWN, driverOptions, isDemo, writeDriver } from "@/lib/drivers";

/**
 * Set who drove a drive. Only the signed-in dashboard reaches this container (the reverse proxy sends
 * everyone else to the demo); the demo never persists anything.
 */
export async function setDriver(driveId: string, driver: string): Promise<{ ok: boolean; error?: string }> {
  if (isDemo()) return { ok: true }; // demo: change is kept in the browser only
  if (!/^[A-Za-z0-9-]{1,64}$/.test(driveId)) return { ok: false, error: "bad drive id" };
  if (driver !== UNKNOWN && !driverOptions().includes(driver)) return { ok: false, error: "unknown driver" };
  try {
    writeDriver(driveId, driver);
  } catch (e) {
    return { ok: false, error: String(e) };
  }
  revalidatePath("/drives");
  revalidatePath(`/drives/${driveId}`);
  return { ok: true };
}
