"""Generate synthetic raw telemetry (clearly fake) so the dashboard can be tried without a car.

The fictional driver lives in San Francisco and commutes to Palo Alto. Drives follow real roads
(precomputed with OSRM from OpenStreetMap, see scripts/build_demo_routes.py): speed follows the road
type with acceleration limits, traffic-light stops in town and day-to-day traffic. Energy comes from a
simple physical model of a Model 3 (mass, drag, rolling resistance, regen), so consumption, battery
and charging behave plausibly. Charging: at home overnight (AC) and now and then at a Supercharger.
"""

from __future__ import annotations

import bisect
import json
import math
import random
from datetime import UTC, datetime, timedelta
from importlib import resources
from pathlib import Path

from .storage import RawWriter

VIN = "DEMO0000000000000"
MPH = 1 / 1.609344  # km/h -> mph (telemetry uses imperial units)
KM_TO_MI = 1 / 1.609344

# Model 3 RWD (approximate)
MASS_KG = 1850
CDA = 0.23 * 2.22
CRR = 0.011
RHO = 1.2
DRIVE_EFF = 0.85
REGEN_EFF = 0.6
AUX_KW = 0.9  # HVAC, computers, 12 V
CAPACITY_KWH = 57.5
PACK_V = 355.0

STEP_S = 3.0  # telemetry sample period in the simulation
MAX_ACCEL = 1.8  # m/s²
MAX_DECEL = 2.5


def _row(ts, field, num=None, text=None):
    return {"ts": ts, "received_at": ts, "vin": VIN, "field": field, "value_num": num, "value_str": text,
            "is_resend": False}  # fmt: skip


def load_routes() -> dict:
    with resources.files("tesla_tracks").joinpath("demo_routes.json").open() as fh:
        doc = json.load(fh)
    return {(r["from"], r["to"]): r for r in doc["routes"]} | {"_places": doc["places"]}


def _haversine_m(a, b) -> float:
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp, dl = p2 - p1, math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


def _bearing(a, b) -> float:
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dl = math.radians(b[0] - a[0])
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


class Car:
    def __init__(self, rnd: random.Random, home: tuple[float, float]):
        self.rnd = rnd
        self.energy = CAPACITY_KWH * 0.72
        self.odo_mi = 8000.0
        self.lat, self.lon = home
        self.rows: list[dict] = []
        # cold tire pressures at 20 °C (bar); the rear right one has a slow leak
        self.tires = {"Fl": 2.9, "Fr": 2.9, "Rl": 2.88, "Rr": 2.9}

    @property
    def soc(self) -> float:
        return self.energy / CAPACITY_KWH * 100

    def emit(self, t, **fields):
        for k, v in fields.items():
            if isinstance(v, str):
                self.rows.append(_row(t, k, text=v))
            else:
                self.rows.append(_row(t, k, v))

    # -- driving ------------------------------------------------------------------------------
    def emit_tires(self, t: datetime, outside_c: float, warm: float = 0.0) -> None:
        """Gay-Lussac: about 0.01 bar per °C; driving warms the tires up by `warm` bar."""
        for wheel, cold in self.tires.items():
            p = cold + (outside_c - 20) * 0.01 + warm + self.rnd.uniform(-0.01, 0.01)
            self.emit(t, **{f"TpmsPressure{wheel}": round(p, 2)})

    def age_tires(self, days: float = 1.0) -> None:
        self.tires["Rr"] -= 0.006 * days
        for w in self.tires:
            self.tires[w] -= 0.0008 * days  # normal permeation
        if self.tires["Rr"] < 2.55 or (min(self.tires.values()) < 2.75 and self.rnd.random() < 0.05):
            self.tires = {"Fl": 2.9, "Fr": 2.9, "Rl": 2.9, "Rr": 2.9}  # topped up at a gas station

    def drive(self, route: dict, t: datetime, outside_c: float) -> datetime:
        pts = route["points"]
        cum = [0.0]
        for i in range(1, len(pts)):
            cum.append(cum[-1] + _haversine_m(pts[i - 1], pts[i]))
        total = cum[-1]
        traffic = self.rnd.uniform(0.88, 1.15)  # how free-flowing the roads are today
        wave = traffic
        cruise = 0.0
        self.emit(t, Gear="D", SentryMode="Off", Locked=1.0, OutsideTemp=round(outside_c, 1), InsideTemp=21.0)
        self.emit_tires(t, outside_c)
        tire_marks = {300.0: 0.06, 900.0: 0.12, 1800.0: 0.16}
        s = v = 0.0
        stop_until = 0.0
        next_light = self.rnd.uniform(250, 700)
        elapsed = 0.0
        while s < total - 1:
            i = max(0, bisect.bisect_right(cum, s) - 1)
            seg_speed = pts[i][2] or 8.0
            # slow "traffic waves": a smooth random factor around today's traffic level
            wave += (traffic - wave) * 0.02 + self.rnd.gauss(0, 0.004)
            wave = min(1.22, max(0.35, wave))
            target = seg_speed * wave
            urban = seg_speed < 15
            # traffic lights / stop signs in town
            if urban and s >= next_light and stop_until <= elapsed:
                stop_until = elapsed + self.rnd.uniform(8, 45)
                next_light = s + self.rnd.uniform(250, 700)
            elif not urban:
                next_light = max(next_light, s + 300)
            # drivers do not jump to every new speed limit: low-pass the cruise target
            cruise += (target - cruise) * 0.15
            target = cruise
            if stop_until > elapsed:
                target = 0.0
            # brake for the end of the route
            target = min(target, math.sqrt(max(0.0, 2 * MAX_DECEL * 0.8 * (total - s))))
            max_up = MAX_ACCEL if v < 15 else 0.6  # gentle on the highway
            dv = max(-MAX_DECEL * STEP_S, min(max_up * STEP_S, target - v))
            v_new = max(0.0, v + dv)
            accel = (v_new - v) / STEP_S
            v_avg = (v + v_new) / 2
            ds = v_avg * STEP_S
            # power at the wheels -> battery
            p_wheels = MASS_KG * accel * v_avg + 0.5 * RHO * CDA * v_avg**3 + CRR * MASS_KG * 9.81 * v_avg
            p_batt = (p_wheels / DRIVE_EFF if p_wheels >= 0 else p_wheels * REGEN_EFF) / 1000 + AUX_KW
            self.energy -= p_batt * STEP_S / 3600
            self.odo_mi += ds / 1000 * KM_TO_MI
            s = min(total, s + ds)
            v = v_new
            elapsed += STEP_S
            if elapsed in tire_marks:
                self.emit_tires(t, outside_c, warm=tire_marks[elapsed])
            t += timedelta(seconds=STEP_S)
            j = max(0, bisect.bisect_right(cum, s) - 1)
            k = min(j + 1, len(pts) - 1)
            f = 0.0 if k == j else (s - cum[j]) / max(1e-6, cum[k] - cum[j])
            lon = pts[j][0] + (pts[k][0] - pts[j][0]) * f
            lat = pts[j][1] + (pts[k][1] - pts[j][1]) * f
            self.lat, self.lon = lat, lon
            self.emit(
                t,
                VehicleSpeed=round(v * 3.6 * MPH, 1),
                Odometer=round(self.odo_mi, 3),
                EnergyRemaining=round(self.energy, 3),
                BatteryLevel=round(self.soc, 1),
                PackVoltage=round(PACK_V - p_batt * 0.15, 1),
                PackCurrent=round(p_batt * 1000 / PACK_V, 1),
                GpsHeading=round(_bearing(pts[j], pts[k]), 0),
                **{"Location.latitude": round(lat, 6), "Location.longitude": round(lon, 6)},
            )
        t += timedelta(seconds=4)
        self.emit(t, VehicleSpeed=0.0, Gear="P")
        # parked away from home: lock and arm Sentry Mode
        away = route.get("to") != "home"
        self.emit(t + timedelta(seconds=40), Locked=1.0, SentryMode="Armed" if away else "Off")
        return t

    # -- charging -----------------------------------------------------------------------------
    def charge(self, t: datetime, dc: bool, target_soc: float) -> datetime:
        self.emit(t, DetailedChargeState="Charging", FastChargerPresent=1.0 if dc else 0.0,
                  **{"Location.latitude": round(self.lat, 6), "Location.longitude": round(self.lon, 6)})  # fmt: skip
        if dc:
            self.emit(t, FastChargerType="Supercharger")
        added = 0.0
        step = timedelta(minutes=1 if dc else 5)
        while self.soc < target_soc:
            if dc:  # LFP-ish taper: ~170 kW at low SoC, ~45 kW near 80 %
                power = max(40.0, min(170.0, 170 - max(0.0, self.soc - 25) * 2.4)) * self.rnd.uniform(0.94, 1.0)
            else:
                power = 11.0 * self.rnd.uniform(0.97, 1.0)
            kwh = power * step.total_seconds() / 3600
            added += kwh
            self.energy += kwh * (0.97 if dc else 0.92)
            t += step
            fields = {
                "DCChargingPower" if dc else "ACChargingPower": round(power, 1),
                "DCChargingEnergyIn" if dc else "ACChargingEnergyIn": round(added, 2),
                "BatteryLevel": round(self.soc, 1),
                "EnergyRemaining": round(self.energy, 2),
            }
            self.emit(t, **fields)
        t += timedelta(minutes=1)
        self.emit(t, DetailedChargeState="Complete", **{"DCChargingPower" if dc else "ACChargingPower": 0.0})
        return t


def _plan_day(rnd: random.Random, day: datetime) -> list[tuple[str, str, int]]:
    """Return (from, to, start minute of day) trips for one day."""
    weekday = day.weekday() < 5
    if weekday:
        trips = [("home", "office", rnd.randint(7 * 60 + 15, 8 * 60 + 40))]
        if rnd.random() < 0.15:  # stop at the Supercharger on the way back
            trips += [("office", "supercharger", rnd.randint(17 * 60, 18 * 60 + 30)), ("supercharger", "home", -1)]
        else:
            trips.append(("office", "home", rnd.randint(17 * 60 + 15, 19 * 60)))
        if rnd.random() < 0.35:
            dest = rnd.choice(["marina", "oakland", "berkeley"])
            start = rnd.randint(19 * 60 + 45, 20 * 60 + 45)
            trips += [("home", dest, start), (dest, "home", start + rnd.randint(90, 180))]
        return trips
    if rnd.random() < 0.2:
        return []
    dest = rnd.choice(["sausalito", "half_moon_bay", "berkeley", "marina", "sfo", "san_mateo"])
    start = rnd.randint(10 * 60, 13 * 60)
    back = ("san_mateo", "office") if dest == "san_mateo" else (dest, "home")
    trips = [("home", dest, start), (back[0], back[1], start + rnd.randint(120, 300))]
    if back[1] == "office":
        trips.append(("office", "home", start + rnd.randint(320, 420)))
    return trips


def generate(data_dir: Path, days: int = 30, seed: int = 7) -> int:
    rnd = random.Random(seed)
    routes = load_routes()
    places = routes.pop("_places")
    writer = RawWriter(data_dir / "raw", data_dir / "state")
    car = Car(rnd, tuple(places["home"]))
    start_day = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days)
    tz_offset = timedelta(hours=8)  # trips are planned in local (Pacific) time, stored in UTC
    car.emit(start_day, Gear="P", BatteryLevel=round(car.soc, 1), EnergyRemaining=round(car.energy, 3),
             Odometer=car.odo_mi, ChargeLimitSoc=80.0)  # fmt: skip
    now = datetime.now(UTC)
    t_free = start_day
    total = 0
    for d in range(days + 1):
        day = start_day + timedelta(days=d)
        outside = 14 + 4 * math.sin(d / 9) + rnd.uniform(-2, 2)
        car.age_tires()
        morning = day + tz_offset + timedelta(hours=6)
        if morning < now:
            car.emit_tires(morning, outside - 4)  # cold morning reading while parked
        for src, dst, minute in _plan_day(rnd, day):
            t = day + tz_offset + timedelta(minutes=minute) if minute >= 0 else t_free + timedelta(minutes=2)
            t = max(t, t_free + timedelta(minutes=5))
            if t > now:
                break
            route = routes.get((src, dst))
            if not route:
                continue
            t_free = car.drive(route, t, outside + (3 if 11 <= minute // 60 <= 17 else 0))
            if dst == "supercharger":
                t_free = car.charge(t_free + timedelta(minutes=1), dc=True, target_soc=rnd.uniform(75, 82))
        # overnight home charging when the battery is getting low
        night = day + tz_offset + timedelta(hours=23, minutes=30)
        if car.soc < 55 and night < now and night > t_free:
            t_free = car.charge(night, dc=False, target_soc=80)
        if len(car.rows) > 50_000:
            writer.add("telemetry", car.rows)
            total += len(car.rows)
            car.rows = []
    writer.add("telemetry", car.rows)
    total += len(car.rows)
    writer.close()
    return total
