"""Turn fleet-telemetry JSON records (transmit_decoded_records=true) into flat rows.

fleet-telemetry publishes on ZMQ as a two-frame message: topic ("<namespace>_<type>") and payload.
With transmit_decoded_records the payload is protojson, e.g. for type V:

    {"data": [{"key": "VehicleSpeed", "value": {"doubleValue": 31.2}}, ...],
     "createdAt": "2026-11-13T19:00:00.123Z", "vin": "...", "isResend": false}
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

TELEMETRY_COLUMNS = ["ts", "received_at", "vin", "field", "value_num", "value_str", "is_resend"]
CONNECTIVITY_COLUMNS = ["ts", "received_at", "vin", "status", "connection_id", "network_interface"]
EVENT_COLUMNS = ["ts", "received_at", "vin", "kind", "name", "body"]

# protojson emits enum values with their type prefix; strip it for readability.
_ENUM_PREFIXES = (
    "ShiftState",
    "DetailedChargeState",
    "FastCharger",
    "ChargeState",
    "CableType",
    "SentryModeState",
)


def parse_ts(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, UTC)
    text = str(value).replace("Z", "+00:00")
    # Python accepts up to microseconds; protojson may emit nanoseconds.
    if "." in text:
        head, _, rest = text.partition(".")
        digits = len(rest) - len(rest.lstrip("0123456789"))
        frac, tz = rest[:digits], rest[digits:]
        text = f"{head}.{frac[:6]}{tz}"
    return datetime.fromisoformat(text).astimezone(UTC)


def _strip_enum(text: str) -> str:
    for prefix in _ENUM_PREFIXES:
        if text.startswith(prefix) and len(text) > len(prefix):
            return text[len(prefix) :]
    return text


def _to_float(text: str) -> float | None:
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def decode_value(field: str, value: dict[str, Any]) -> list[tuple[str, float | None, str | None]]:
    """Return one or more (field, value_num, value_str) tuples for a protojson Value."""
    if not value:
        return [(field, None, None)]
    (kind, raw), *_ = value.items()
    if kind == "invalid":
        return [(field, None, "invalid")]
    if kind == "locationValue":
        return [
            (f"{field}.latitude", float(raw.get("latitude", 0.0)), None),
            (f"{field}.longitude", float(raw.get("longitude", 0.0)), None),
        ]
    if kind == "booleanValue":
        return [(field, 1.0 if raw else 0.0, "true" if raw else "false")]
    if kind in ("doubleValue", "floatValue", "intValue", "longValue"):
        # int64 values arrive as JSON strings in protojson.
        return [(field, _to_float(raw), None)]
    if kind == "stringValue":
        return [(field, _to_float(raw), raw)]
    if isinstance(raw, str):  # enum values
        return [(field, None, _strip_enum(raw))]
    return [(field, None, json.dumps(raw, separators=(",", ":")))]


def decode_message(topic: str, payload: bytes | str, received_at: datetime) -> tuple[str, list[dict]]:
    """Decode one ZMQ message. Returns (table, rows) where table is telemetry|connectivity|events."""
    record_type = topic.rsplit("_", 1)[-1]
    doc = json.loads(payload)
    vin = doc.get("vin", "")
    ts = parse_ts(doc.get("createdAt")) or received_at

    if record_type == "V":
        rows = []
        for datum in doc.get("data", []):
            for field, num, text in decode_value(datum.get("key", "?"), datum.get("value") or {}):
                rows.append(
                    {
                        "ts": ts,
                        "received_at": received_at,
                        "vin": vin,
                        "field": field,
                        "value_num": num,
                        "value_str": text,
                        "is_resend": bool(doc.get("isResend", False)),
                    }
                )
        return "telemetry", rows

    if record_type == "connectivity":
        return "connectivity", [
            {
                "ts": ts,
                "received_at": received_at,
                "vin": vin,
                "status": str(doc.get("status", "")),
                "connection_id": doc.get("connectionId", ""),
                "network_interface": doc.get("networkInterface", ""),
            }
        ]

    # alerts / errors: keep them, they are small and useful for debugging.
    items = doc.get("alerts") or doc.get("errors") or [doc]
    rows = []
    for item in items:
        rows.append(
            {
                "ts": parse_ts(item.get("startedAt") or item.get("createdAt")) or ts,
                "received_at": received_at,
                "vin": vin,
                "kind": record_type,
                "name": str(item.get("name", "")),
                "body": json.dumps(item, separators=(",", ":")),
            }
        )
    return "events", rows
