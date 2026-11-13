"""Append-only raw storage: a JSONL spool for crash safety, flushed to day-partitioned Parquet.

Layout:
    data/raw/<table>/date=YYYY-MM-DD/part-<epoch_ms>-<n>.parquet
    data/state/spool.jsonl      (rows not yet in Parquet; replayed on start)
"""

from __future__ import annotations

import json
import os
import threading
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from .decode import parse_ts

TS = pa.timestamp("us", tz="UTC")
SCHEMAS: dict[str, pa.Schema] = {
    "telemetry": pa.schema(
        [
            ("ts", TS),
            ("received_at", TS),
            ("vin", pa.string()),
            ("field", pa.string()),
            ("value_num", pa.float64()),
            ("value_str", pa.string()),
            ("is_resend", pa.bool_()),
        ]
    ),
    "connectivity": pa.schema(
        [
            ("ts", TS),
            ("received_at", TS),
            ("vin", pa.string()),
            ("status", pa.string()),
            ("connection_id", pa.string()),
            ("network_interface", pa.string()),
        ]
    ),
    "events": pa.schema(
        [
            ("ts", TS),
            ("received_at", TS),
            ("vin", pa.string()),
            ("kind", pa.string()),
            ("name", pa.string()),
            ("body", pa.string()),
        ]
    ),
}


def _json_default(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(type(obj))


def write_parquet_atomic(table: pa.Table, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    pq.write_table(table, tmp, compression="zstd")
    os.replace(tmp, path)


class RawWriter:
    """Thread-safe buffer of decoded rows."""

    def __init__(self, raw_dir: Path, state_dir: Path):
        self.raw_dir = raw_dir
        self.state_dir = state_dir
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.spool_path = state_dir / "spool.jsonl"
        self._lock = threading.Lock()
        self._rows: dict[str, list[dict]] = defaultdict(list)
        self._spool = None
        self._seq = 0
        self.replay_spool()
        self._spool = open(self.spool_path, "a", encoding="utf-8")

    def replay_spool(self) -> int:
        if not self.spool_path.exists() or self.spool_path.stat().st_size == 0:
            return 0
        count = 0
        with open(self.spool_path, encoding="utf-8") as fh:
            for line in fh:
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue  # torn last line after a crash
                row = item["row"]
                for key in ("ts", "received_at"):
                    row[key] = parse_ts(row[key])
                self._rows[item["table"]].append(row)
                count += 1
        self.flush()
        return count

    def add(self, table: str, rows: list[dict]) -> None:
        if not rows:
            return
        with self._lock:
            self._rows[table].extend(rows)
            if self._spool:
                for row in rows:
                    self._spool.write(json.dumps({"table": table, "row": row}, default=_json_default) + "\n")
                self._spool.flush()

    def pending(self) -> int:
        with self._lock:
            return sum(len(v) for v in self._rows.values())

    def flush(self) -> int:
        with self._lock:
            batches, self._rows = self._rows, defaultdict(list)
            written = 0
            for table, rows in batches.items():
                if not rows:
                    continue
                by_day: dict[str, list[dict]] = defaultdict(list)
                for row in rows:
                    by_day[row["ts"].strftime("%Y-%m-%d")].append(row)
                for day, day_rows in by_day.items():
                    self._seq += 1
                    arrow = pa.Table.from_pylist(day_rows, schema=SCHEMAS[table])
                    name = f"part-{int(time.time() * 1000)}-{self._seq}.parquet"
                    write_parquet_atomic(arrow, self.raw_dir / table / f"date={day}" / name)
                    written += len(day_rows)
            # Everything buffered is now durable in Parquet: reset the spool.
            if self._spool:
                self._spool.truncate(0)
                self._spool.seek(0)
            elif self.spool_path.exists():
                self.spool_path.write_text("")
            return written

    def close(self) -> None:
        self.flush()
        if self._spool:
            self._spool.close()
            self._spool = None


def compact(raw_dir: Path, keep_today: str | None = None) -> int:
    """Merge the small part files of each finished day into a single file. Returns days compacted."""
    compacted = 0
    for table in SCHEMAS:
        for day_dir in sorted((raw_dir / table).glob("date=*")):
            if keep_today and day_dir.name == f"date={keep_today}":
                continue
            parts = sorted(day_dir.glob("*.parquet"))
            if len(parts) <= 1 or not any(p.name.startswith("part-") for p in parts):
                continue
            files = ", ".join(f"'{p}'" for p in parts)
            con = duckdb.connect()
            merged = con.sql(
                f"SELECT * FROM read_parquet([{files}], union_by_name=true, hive_partitioning=false) ORDER BY ts"
            ).to_arrow_table()
            con.close()
            target = day_dir / f"data-{int(time.time() * 1000)}.parquet"
            write_parquet_atomic(merged.cast(SCHEMAS[table]), target)
            for p in parts:
                if p != target:
                    p.unlink()
            compacted += 1
    return compacted
