"""Derive drives, charges and positions from raw telemetry.

Raw Parquet is the source of truth; derived tables are recomputed from scratch on every run.
With one or a few cars this takes seconds even with years of data, and it means any fix to
the detection logic applies retroactively.

Drive detection
    moving  = Gear in {D, R, N} or VehicleSpeed > 0.5
    start   = first moment the car is moving
    end     = the moment it stopped moving, once it has stayed stopped for PARK_END
              (shorter stops, e.g. traffic lights or dropping someone off, stay in the same drive),
              or the last moving moment if the stream goes silent for more than GAP.
Charge detection
    start   = DetailedChargeState becomes Starting/Charging
    end     = it becomes Complete/Stopped/Disconnected/NoPower, or the stream goes silent for CHARGE_GAP.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

import duckdb
import pyarrow as pa

from .storage import write_parquet_atomic

PARK_END = timedelta(minutes=3)

# Driving-style events (m/s²). Accelerations come from speed changes, lateral g from speed × turn rate.
HARSH_ACCEL = 2.5
HARSH_BRAKE = -3.0
SHARP_TURN = 3.0
FAST_KMH = 120.0
GAP = timedelta(minutes=10)
CHARGE_GAP = timedelta(minutes=30)

# Fleet Telemetry reports distances in miles and speeds in mph regardless of the car's display units.
# (Verify against the car's odometer on the first real drive; flip these if it ever changes.)
MILES_TO_KM = 1.609344
SPEED_TO_KMH = MILES_TO_KM
ODOMETER_TO_KM = MILES_TO_KM
RANGE_TO_KM = MILES_TO_KM

FIELDS = [
    "Gear",
    "VehicleSpeed",
    "Location.latitude",
    "Location.longitude",
    "GpsHeading",
    "Odometer",
    "BatteryLevel",
    "Soc",
    "EnergyRemaining",
    "EstBatteryRange",
    "RatedRange",
    "PackVoltage",
    "PackCurrent",
    "OutsideTemp",
    "InsideTemp",
    "DetailedChargeState",
    "ACChargingPower",
    "DCChargingPower",
    "ACChargingEnergyIn",
    "DCChargingEnergyIn",
    "FastChargerPresent",
    "FastChargerType",
    "ChargeLimitSoc",
    "TpmsPressureFl",
    "TpmsPressureFr",
    "TpmsPressureRl",
    "TpmsPressureRr",
]
STRING_FIELDS = {"Gear", "DetailedChargeState", "FastChargerType"}
MOVING_GEARS = {"D", "R", "N"}
CHARGING_STATES = {"Starting", "Charging"}
SESSION_FIELDS = (
    "ACChargingPower",
    "DCChargingPower",
    "ACChargingEnergyIn",
    "DCChargingEnergyIn",
    "FastChargerPresent",
    "FastChargerType",
)
CHARGE_END_STATES = {"Complete", "Stopped", "Disconnected", "NoPower"}

DRIVE_SCHEMA = pa.schema(
    [
        ("drive_id", pa.string()),
        ("vin", pa.string()),
        ("start_ts", pa.timestamp("us", tz="UTC")),
        ("end_ts", pa.timestamp("us", tz="UTC")),
        ("in_progress", pa.bool_()),
        ("duration_min", pa.float64()),
        ("distance_km", pa.float64()),
        ("start_lat", pa.float64()),
        ("start_lon", pa.float64()),
        ("end_lat", pa.float64()),
        ("end_lon", pa.float64()),
        ("start_odometer_km", pa.float64()),
        ("end_odometer_km", pa.float64()),
        ("start_soc", pa.float64()),
        ("end_soc", pa.float64()),
        ("start_range_km", pa.float64()),
        ("end_range_km", pa.float64()),
        ("energy_kwh", pa.float64()),
        ("wh_per_km", pa.float64()),
        ("avg_speed_kmh", pa.float64()),
        ("max_speed_kmh", pa.float64()),
        ("avg_outside_temp_c", pa.float64()),
        ("harsh_accel", pa.int32()),
        ("harsh_brake", pa.int32()),
        ("sharp_turns", pa.int32()),
        ("traction_kwh", pa.float64()),
        ("regen_kwh", pa.float64()),
        ("fast_min", pa.float64()),
        ("moving_min", pa.float64()),
    ]
)
CHARGE_SCHEMA = pa.schema(
    [
        ("charge_id", pa.string()),
        ("vin", pa.string()),
        ("start_ts", pa.timestamp("us", tz="UTC")),
        ("end_ts", pa.timestamp("us", tz="UTC")),
        ("in_progress", pa.bool_()),
        ("duration_min", pa.float64()),
        ("lat", pa.float64()),
        ("lon", pa.float64()),
        ("charger", pa.string()),  # AC | DC
        ("fast_charger_type", pa.string()),
        ("start_soc", pa.float64()),
        ("end_soc", pa.float64()),
        ("energy_added_kwh", pa.float64()),
        ("max_power_kw", pa.float64()),
        ("end_state", pa.string()),
    ]
)
TIRES = {"TpmsPressureFl": "fl", "TpmsPressureFr": "fr", "TpmsPressureRl": "rl", "TpmsPressureRr": "rr"}
TIRE_SCHEMA = pa.schema(
    [
        ("vin", pa.string()),
        ("ts", pa.timestamp("us", tz="UTC")),
        ("fl_bar", pa.float64()),
        ("fr_bar", pa.float64()),
        ("rl_bar", pa.float64()),
        ("rr_bar", pa.float64()),
    ]
)


def to_bar(v):
    """Tire pressure in bar. Tesla does not document the unit, so accept bar, psi or kPa by magnitude."""
    if v is None:
        return None
    if v > 100:  # kPa
        return round(v / 100, 3)
    if v > 10:  # psi
        return round(v * 0.0689476, 3)
    return round(v, 3)


POSITION_SCHEMA = pa.schema(
    [
        ("drive_id", pa.string()),
        ("vin", pa.string()),
        ("ts", pa.timestamp("us", tz="UTC")),
        ("lat", pa.float64()),
        ("lon", pa.float64()),
        ("heading", pa.float64()),
        ("speed_kmh", pa.float64()),
        ("power_kw", pa.float64()),
        ("soc", pa.float64()),
        ("odometer_km", pa.float64()),
        ("outside_temp_c", pa.float64()),
    ]
)


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _num(v):
    return v if isinstance(v, (int, float)) else None


def _soc(s: dict):
    return _num(s.get("BatteryLevel")) if s.get("BatteryLevel") is not None else _num(s.get("Soc"))


def _scaled(v, k):
    return None if v is None else v * k


def _power_kw(s: dict):
    v, i = _num(s.get("PackVoltage")), _num(s.get("PackCurrent"))
    return None if v is None or i is None else v * i / 1000.0


def _is_moving(s: dict) -> bool:
    return s.get("Gear") in MOVING_GEARS or (_num(s.get("VehicleSpeed")) or 0.0) > 0.5


@dataclass
class _Drive:
    start_ts: datetime
    start: dict
    last_moving_ts: datetime
    max_speed: float = 0.0
    temps: list = field(default_factory=list)
    path_km: float = 0.0
    last_latlon: tuple | None = None
    # driving style
    prev_speed: tuple | None = None  # (ts, m/s)
    prev_heading: tuple | None = None  # (ts, degrees, m/s)
    prev_power_ts: datetime | None = None
    harsh_accel: int = 0
    harsh_brake: int = 0
    sharp_turns: int = 0
    in_accel: bool = False
    in_brake: bool = False
    in_turn: bool = False
    drive_kwh: float = 0.0
    regen_kwh: float = 0.0
    fast_s: float = 0.0
    moving_s: float = 0.0


@dataclass
class _Charge:
    start_ts: datetime
    start: dict
    last_ts: datetime
    max_power: float = 0.0
    dc: bool = False
    energy_in_min: float | None = None
    energy_in_max: float | None = None
    baseline_seen: bool = False  # did the session counter's first value arrive when charging started?


class Tracker:
    """Streaming state machine for one vehicle. Feed it time-ordered updates with step()."""

    def __init__(self, vin: str):
        self.vin = vin
        self.state: dict = {}
        self.last_ts: datetime | None = None
        self.prev_state: dict = {}
        self.drive: _Drive | None = None
        self.park_since: datetime | None = None
        self.park_state: dict | None = None
        self.charge: _Charge | None = None
        self.drives: list[dict] = []
        self.charges: list[dict] = []
        self.positions: list[dict] = []
        self.tires: list[dict] = []

    # -- drives -------------------------------------------------------------------------------
    def _open_drive(self, ts: datetime) -> None:
        s = self.state
        self.drive = _Drive(start_ts=ts, start=dict(s), last_moving_ts=ts)
        self.park_since = None

    def _close_drive(self, end_ts: datetime, end: dict, in_progress: bool = False) -> None:
        d, a = self.drive, self.drive.start
        start_odo = _scaled(_num(a.get("Odometer")), ODOMETER_TO_KM)
        end_odo = _scaled(_num(end.get("Odometer")), ODOMETER_TO_KM)
        distance = end_odo - start_odo if start_odo is not None and end_odo is not None else d.path_km
        e0, e1 = _num(a.get("EnergyRemaining")), _num(end.get("EnergyRemaining"))
        energy = e0 - e1 if e0 is not None and e1 is not None else None
        minutes = (end_ts - d.start_ts).total_seconds() / 60.0
        self.drives.append(
            {
                "drive_id": f"{self.vin[-6:]}-{int(d.start_ts.timestamp())}",
                "vin": self.vin,
                "start_ts": d.start_ts,
                "end_ts": end_ts,
                "in_progress": in_progress,
                "duration_min": round(minutes, 2),
                "distance_km": round(distance, 3) if distance is not None else None,
                "start_lat": _num(a.get("Location.latitude")),
                "start_lon": _num(a.get("Location.longitude")),
                "end_lat": _num(end.get("Location.latitude")),
                "end_lon": _num(end.get("Location.longitude")),
                "start_odometer_km": start_odo,
                "end_odometer_km": end_odo,
                "start_soc": _soc(a),
                "end_soc": _soc(end),
                "start_range_km": _scaled(_num(a.get("EstBatteryRange")), RANGE_TO_KM),
                "end_range_km": _scaled(_num(end.get("EstBatteryRange")), RANGE_TO_KM),
                "energy_kwh": round(energy, 3) if energy is not None else None,
                "wh_per_km": round(energy * 1000 / distance, 1) if energy is not None and distance else None,
                "avg_speed_kmh": round(distance / (minutes / 60), 1) if distance and minutes > 0 else None,
                "max_speed_kmh": round(d.max_speed, 1),
                "avg_outside_temp_c": round(sum(d.temps) / len(d.temps), 1) if d.temps else None,
                "harsh_accel": d.harsh_accel,
                "harsh_brake": d.harsh_brake,
                "sharp_turns": d.sharp_turns,
                "traction_kwh": round(d.drive_kwh, 3),
                "regen_kwh": round(d.regen_kwh, 3),
                "fast_min": round(d.fast_s / 60, 2),
                "moving_min": round(d.moving_s / 60, 2),
            }
        )
        if not in_progress:
            self.drive = None
            self.park_since = None
            self.park_state = None

    def _track_style(self, ts: datetime, updates: dict) -> None:
        """Count harsh accelerations/brakes/turns and integrate traction vs regen energy."""
        s, d = self.state, self.drive
        if "VehicleSpeed" in updates and _num(s.get("VehicleSpeed")) is not None:
            v = s["VehicleSpeed"] * SPEED_TO_KMH / 3.6
            if d.prev_speed:
                dt = (ts - d.prev_speed[0]).total_seconds()
                if 0.5 <= dt <= 6:
                    a = (v - d.prev_speed[1]) / dt
                    if a >= HARSH_ACCEL and not d.in_accel:
                        d.harsh_accel += 1
                    if a <= HARSH_BRAKE and not d.in_brake:
                        d.harsh_brake += 1
                    d.in_accel, d.in_brake = a >= HARSH_ACCEL, a <= HARSH_BRAKE
                    if v * 3.6 > FAST_KMH:
                        d.fast_s += dt
                    if v > 0.5:
                        d.moving_s += dt
            d.prev_speed = (ts, v)
        if "GpsHeading" in updates and _num(s.get("GpsHeading")) is not None:
            v = (_num(s.get("VehicleSpeed")) or 0.0) * SPEED_TO_KMH / 3.6
            h = s["GpsHeading"]
            if d.prev_heading:
                dt = (ts - d.prev_heading[0]).total_seconds()
                dh = abs((h - d.prev_heading[1] + 180) % 360 - 180)
                vm = (v + d.prev_heading[2]) / 2
                if 0.5 <= dt <= 7 and vm > 4:
                    lat = vm * math.radians(dh) / dt
                    if lat >= SHARP_TURN and not d.in_turn:
                        d.sharp_turns += 1
                    d.in_turn = lat >= SHARP_TURN
            d.prev_heading = (ts, h, v)
        p = _power_kw(s)
        if p is not None and ("PackCurrent" in updates or "PackVoltage" in updates):
            if d.prev_power_ts is not None:
                dt = min(10.0, (ts - d.prev_power_ts).total_seconds())
                if p >= 0:
                    d.drive_kwh += p * dt / 3600
                else:
                    d.regen_kwh += -p * dt / 3600
            d.prev_power_ts = ts

    def _track_drive_point(self, ts: datetime) -> None:
        s, d = self.state, self.drive
        speed = _scaled(_num(s.get("VehicleSpeed")), SPEED_TO_KMH)
        if speed is not None:
            d.max_speed = max(d.max_speed, speed)
        if _num(s.get("OutsideTemp")) is not None:
            d.temps.append(s["OutsideTemp"])
        lat, lon = _num(s.get("Location.latitude")), _num(s.get("Location.longitude"))
        if lat is None or lon is None:
            return
        if d.last_latlon and d.last_latlon != (lat, lon):
            d.path_km += haversine_km(*d.last_latlon, lat, lon)
        d.last_latlon = (lat, lon)
        self.positions.append(
            {
                "drive_id": f"{self.vin[-6:]}-{int(d.start_ts.timestamp())}",
                "vin": self.vin,
                "ts": ts,
                "lat": lat,
                "lon": lon,
                "heading": _num(s.get("GpsHeading")),
                "speed_kmh": speed,
                "power_kw": _power_kw(s),
                "soc": _soc(s),
                "odometer_km": _scaled(_num(s.get("Odometer")), ODOMETER_TO_KM),
                "outside_temp_c": _num(s.get("OutsideTemp")),
            }
        )

    # -- charges ------------------------------------------------------------------------------
    def _open_charge(self, ts: datetime, updates: dict) -> None:
        # Charging signals are only sent on change, so values left over from the previous session
        # (e.g. the last DC power of a Supercharger stop) must not leak into this one.
        for key in SESSION_FIELDS:
            if key not in updates:
                self.state.pop(key, None)
        self.charge = _Charge(start_ts=ts, start=dict(self.state), last_ts=ts)
        self.charge.baseline_seen = any(k in updates for k in ("ACChargingEnergyIn", "DCChargingEnergyIn"))

    def _close_charge(self, end_ts: datetime, end: dict, in_progress: bool = False) -> None:
        c, a = self.charge, self.charge.start
        if c.energy_in_max is not None and c.energy_in_min is not None:
            # *ChargingEnergyIn counts energy of the current session. Values are sent only on change,
            # so if the session started without one, the counter started from zero.
            added = c.energy_in_max - (c.energy_in_min if c.baseline_seen else 0.0)
        else:
            e0, e1 = _num(a.get("EnergyRemaining")), _num(end.get("EnergyRemaining"))
            added = e1 - e0 if e0 is not None and e1 is not None else None
        self.charges.append(
            {
                "charge_id": f"{self.vin[-6:]}-c{int(c.start_ts.timestamp())}",
                "vin": self.vin,
                "start_ts": c.start_ts,
                "end_ts": end_ts,
                "in_progress": in_progress,
                "duration_min": round((end_ts - c.start_ts).total_seconds() / 60.0, 2),
                "lat": _num(a.get("Location.latitude")),
                "lon": _num(a.get("Location.longitude")),
                "charger": "DC" if c.dc else "AC",
                "fast_charger_type": end.get("FastChargerType") or a.get("FastChargerType"),
                "start_soc": _soc(a),
                "end_soc": _soc(end),
                "energy_added_kwh": round(added, 3) if added is not None else None,
                "max_power_kw": round(c.max_power, 2),
                "end_state": None if in_progress else end.get("DetailedChargeState"),
            }
        )
        if not in_progress:
            self.charge = None

    def _track_charge(self) -> None:
        s, c = self.state, self.charge
        ac, dc = _num(s.get("ACChargingPower")) or 0.0, _num(s.get("DCChargingPower")) or 0.0
        c.max_power = max(c.max_power, ac, dc)
        if dc > 0 or s.get("FastChargerPresent") in (1.0, True):
            c.dc = True
        energy_in = _num(s.get("DCChargingEnergyIn")) if c.dc else _num(s.get("ACChargingEnergyIn"))
        if energy_in is not None:
            c.energy_in_min = energy_in if c.energy_in_min is None else min(c.energy_in_min, energy_in)
            c.energy_in_max = energy_in if c.energy_in_max is None else max(c.energy_in_max, energy_in)

    # -- main loop ----------------------------------------------------------------------------
    def step(self, ts: datetime, updates: dict, disconnected: bool = False) -> None:
        if self.last_ts is not None:
            silent = ts - self.last_ts
            if self.drive and silent > GAP:
                end_ts = self.park_since or self.drive.last_moving_ts
                self._close_drive(end_ts, self.park_state or self.prev_state)
            if self.charge and silent > CHARGE_GAP:
                self._close_charge(self.last_ts, self.prev_state)
            if silent > GAP:
                # Motion fields are only sent on change; after a silence they are stale.
                self.state.pop("Gear", None)
                self.state.pop("VehicleSpeed", None)

        if self.drive and self.park_since and ts - self.park_since >= PARK_END:
            self._close_drive(self.park_since, self.park_state)

        self.state.update(updates)
        moving = _is_moving(self.state)

        if self.drive is None and moving:
            self._open_drive(ts)
        if self.drive:
            self._track_style(ts, updates)
            if moving:
                self.drive.last_moving_ts = ts
                self.park_since = None
                self.park_state = None
            elif self.park_since is None:
                self.park_since = ts
                self.park_state = dict(self.state)
            self._track_drive_point(ts)

        cs = self.state.get("DetailedChargeState")
        if self.charge is None and cs in CHARGING_STATES:
            self._open_charge(ts, updates)
        if self.charge:
            self._track_charge()
            self.charge.last_ts = ts
            if cs in CHARGE_END_STATES:
                self._close_charge(ts, self.state)

        if disconnected and self.drive and not moving:
            self._close_drive(self.park_since or ts, self.park_state or self.state)

        if any(k in updates for k in TIRES):
            row = {"vin": self.vin, "ts": ts}
            for field, wheel in TIRES.items():
                row[f"{wheel}_bar"] = to_bar(_num(self.state.get(field)))
            self.tires.append(row)

        self.prev_state = dict(self.state)
        self.last_ts = ts

    def finish(self, now: datetime) -> None:
        """Close what is clearly over; report the rest as in progress."""
        if self.drive:
            parked_long = self.park_since and now - self.park_since >= PARK_END
            if parked_long or (self.last_ts and now - self.last_ts > GAP):
                end_ts = self.park_since or self.drive.last_moving_ts
                self._close_drive(end_ts, self.park_state or self.prev_state)
            else:
                self._close_drive(self.last_ts, self.state, in_progress=True)
        if self.charge:
            if self.last_ts and now - self.last_ts > CHARGE_GAP:
                self._close_charge(self.last_ts, self.prev_state)
            else:
                self._close_charge(self.last_ts, self.state, in_progress=True)


def _iter_updates(con: duckdb.DuckDBPyConnection, raw_dir: Path):
    """Yield (vin, ts, updates, disconnected) ordered by vin, ts."""
    tel = raw_dir / "telemetry"
    conn = raw_dir / "connectivity"
    if not any(tel.rglob("*.parquet")):
        return
    has_conn = any(conn.rglob("*.parquet"))
    conn_sql = (
        f"""UNION ALL SELECT vin, ts, '_disconnected' AS field, NULL, NULL
            FROM read_parquet('{conn}/**/*.parquet', hive_partitioning=false)
            WHERE status = 'DISCONNECTED'"""
        if has_conn
        else ""
    )
    fields = ", ".join(f"'{f}'" for f in FIELDS)
    rows = con.execute(
        f"""
        WITH t AS (
          SELECT DISTINCT vin, ts, field, value_num, value_str
          FROM read_parquet('{tel}/**/*.parquet', hive_partitioning=false)
          WHERE field IN ({fields})
          {conn_sql}
        )
        SELECT vin, ts, field, value_num, value_str FROM t ORDER BY vin, ts, field
        """
    ).fetchall()
    cur_key, updates, disconnected = None, {}, False
    for vin, ts, fld, num, text in rows:
        key = (vin, ts)
        if key != cur_key and cur_key is not None:
            yield cur_key[0], cur_key[1], updates, disconnected
            updates, disconnected = {}, False
        cur_key = key
        if fld == "_disconnected":
            disconnected = True
        elif text == "invalid":
            updates[fld] = None
        elif fld in STRING_FIELDS:
            updates[fld] = text
        else:
            updates[fld] = num
    if cur_key is not None:
        yield cur_key[0], cur_key[1], updates, disconnected


def run(data_dir: Path, now: datetime | None = None) -> dict:
    now = now or datetime.now(UTC)
    raw_dir, out_dir = data_dir / "raw", data_dir / "derived"
    con = duckdb.connect()
    trackers: dict[str, Tracker] = {}
    for vin, ts, updates, disconnected in _iter_updates(con, raw_dir):
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=UTC)
        trackers.setdefault(vin, Tracker(vin)).step(ts, updates, disconnected)
    con.close()
    drives, charges, positions, tires = [], [], [], []
    for tr in trackers.values():
        tr.finish(now)
        drives += tr.drives
        charges += tr.charges
        positions += tr.positions
        tires += tr.tires
    write_parquet_atomic(pa.Table.from_pylist(drives, schema=DRIVE_SCHEMA), out_dir / "drives.parquet")
    write_parquet_atomic(pa.Table.from_pylist(charges, schema=CHARGE_SCHEMA), out_dir / "charges.parquet")
    write_parquet_atomic(pa.Table.from_pylist(positions, schema=POSITION_SCHEMA), out_dir / "positions.parquet")
    write_parquet_atomic(pa.Table.from_pylist(tires, schema=TIRE_SCHEMA), out_dir / "tires.parquet")
    return {"drives": len(drives), "charges": len(charges), "positions": len(positions), "tires": len(tires)}
