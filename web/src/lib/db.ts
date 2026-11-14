import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

const DATA_DIR = path.resolve(process.env.TT_DATA_DIR ?? "../data");

let conn: Promise<DuckDBConnection> | null = null;

function connection(): Promise<DuckDBConnection> {
  if (!conn) {
    conn = DuckDBInstance.create(":memory:").then((db) => db.connect());
  }
  return conn;
}

/** Path to a derived Parquet table, or null if the ingester has not produced it yet. */
export function table(name: "drives" | "charges" | "positions" | "tires"): string | null {
  const file = path.join(DATA_DIR, "derived", `${name}.parquet`);
  return fs.existsSync(file) ? file.replaceAll("'", "''") : null;
}

export type Row = Record<string, string | number | boolean | null>;

export async function query<T = Row>(sql: string, params: Record<string, string | number> = {}): Promise<T[]> {
  const c = await connection();
  const reader = await c.runAndReadAll(sql, params);
  return reader.getRowObjectsJson() as unknown as T[];
}
