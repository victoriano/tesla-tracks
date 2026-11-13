"""Generate synthetic raw telemetry (clearly fake) so the dashboard can be tried without a car."""

from __future__ import annotations

import math
import random
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .storage import RawWriter

VIN = "DEMO0000000000000"
PLACES = [  # San Francisco Bay Area landmarks, purely illustrative
    (37.7749, -122.4194),
    (37.8044, -122.2712),
    (37.4419, -122.1430),
    (37.6879, -122.4702),
    (37.5485, -122.0590),
    (37.8716, -122.2727),
]


def _row(ts, field, num=None, text=None):
    return {"ts": ts, "received_at": ts, "vin": VIN, "field": field, "value_num": num, "value_str": text,
            "is_resend": False}  # fmt: skip


def generate(data_dir: Path, days: int = 30, seed: int = 7) -> int:
    rnd = random.Random(seed)
    writer = RawWriter(data_dir / "raw", data_dir / "state")
    odo_mi, energy, soc = 8000.0, 52.0, 70.0
    lat, lon = PLACES[0]
    start_day = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days)
    total = 0
    for day in range(days + 1):
        base = start_day + timedelta(days=day)
        for hour in sorted(rnd.sample([8, 9, 13, 17, 18, 20], k=rnd.choice([0, 2, 2, 3]))):
            t = base + timedelta(hours=hour, minutes=rnd.randint(0, 50))
            dest = rnd.choice([p for p in PLACES if p != (lat, lon)])
            rows = [_row(t, "Gear", text="D"), _row(t, "OutsideTemp", 8 + rnd.random() * 14)]
            steps = rnd.randint(60, 220)  # 5 s steps
            for i in range(1, steps + 1):
                t += timedelta(seconds=5)
                f = i / steps
                speed_mph = max(0.0, 28 + 20 * math.sin(i / 9) + rnd.uniform(-6, 6))
                odo_mi += speed_mph * 5 / 3600
                use = speed_mph * 5 / 3600 * 0.25 * 1.609 * (1 + rnd.uniform(-0.2, 0.3))
                energy -= use
                soc = energy / 75 * 100
                cur_lat = lat + (dest[0] - lat) * f + 0.004 * math.sin(f * math.pi * 3)
                cur_lon = lon + (dest[1] - lon) * f
                rows += [
                    _row(t, "VehicleSpeed", round(speed_mph, 1)),
                    _row(t, "Odometer", round(odo_mi, 3)),
                    _row(t, "EnergyRemaining", round(energy, 3)),
                    _row(t, "BatteryLevel", round(soc, 1)),
                    _row(t, "Location.latitude", cur_lat),
                    _row(t, "Location.longitude", cur_lon),
                    _row(t, "PackVoltage", 395.0),
                    _row(t, "PackCurrent", round(use * 3600 / 5 / 395 * 1000 * rnd.uniform(0.6, 1.4), 1)),
                ]
            t += timedelta(seconds=10)
            rows += [_row(t, "VehicleSpeed", 0.0), _row(t + timedelta(seconds=4), "Gear", text="P")]
            lat, lon = dest
            writer.add("telemetry", rows)
            total += len(rows)
        if soc < 45 or rnd.random() < 0.15:  # overnight charge
            t = base + timedelta(hours=22)
            dc = rnd.random() < 0.2
            power = rnd.uniform(90, 170) if dc else 7.2
            rows = [
                _row(t, "DetailedChargeState", text="Charging"),
                _row(t, "FastChargerPresent", 1.0 if dc else 0.0),
            ]
            added = 0.0
            while soc < 80:
                t += timedelta(minutes=2 if dc else 10)
                step = power * (2 if dc else 10) / 60
                added += step
                energy += step
                soc = energy / 75 * 100
                rows += [
                    _row(t, "DCChargingPower" if dc else "ACChargingPower", round(power, 1)),
                    _row(t, "DCChargingEnergyIn" if dc else "ACChargingEnergyIn", round(added, 2)),
                    _row(t, "BatteryLevel", round(soc, 1)),
                    _row(t, "EnergyRemaining", round(energy, 2)),
                ]
            rows.append(_row(t + timedelta(minutes=1), "DetailedChargeState", text="Complete"))
            writer.add("telemetry", rows)
            total += len(rows)
    writer.close()
    return total
