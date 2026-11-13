from datetime import UTC, datetime, timedelta

from tesla_tracks.process import Tracker

T0 = datetime(2026, 11, 13, 8, 0, tzinfo=UTC)
VIN = "LRWTEST000000001"


def at(seconds: float) -> datetime:
    return T0 + timedelta(seconds=seconds)


def parked_car(tr: Tracker, t: float = 0, odo: float = 1000.0, soc: float = 80.0, energy: float = 60.0):
    tr.step(
        at(t),
        {
            "Gear": "P",
            "VehicleSpeed": 0.0,
            "Odometer": odo,
            "BatteryLevel": soc,
            "EnergyRemaining": energy,
            "Location.latitude": 40.4168,
            "Location.longitude": -3.7038,
            "OutsideTemp": 12.0,
        },
    )


def drive(tr: Tracker, t0: float, minutes: int, odo0: float, soc0: float, energy0: float):
    """One update every 10 s at ~60 mph."""
    tr.step(at(t0), {"Gear": "D"})
    steps = minutes * 6
    for i in range(1, steps + 1):
        tr.step(
            at(t0 + i * 10),
            {
                "VehicleSpeed": 60.0,
                "Odometer": odo0 + i * 60 / 360,  # 60 mph for 10 s
                "BatteryLevel": soc0 - i * 0.01,
                "EnergyRemaining": energy0 - i * 0.004,
                "Location.latitude": 40.4168 + i * 0.001,
                "Location.longitude": -3.7038,
            },
        )
    t_end = t0 + steps * 10 + 10
    tr.step(at(t_end), {"VehicleSpeed": 0.0})
    tr.step(at(t_end + 5), {"Gear": "P"})
    return t_end


def test_single_drive_closed_after_park():
    tr = Tracker(VIN)
    parked_car(tr)
    t_end = drive(tr, 60, 10, 1000.0, 80.0, 60.0)
    # Next sign of life much later: drive must close at the moment it stopped moving.
    tr.step(at(t_end + 3600), {"InsideTemp": 20.0})
    tr.finish(at(t_end + 3700))
    assert len(tr.drives) == 1
    d = tr.drives[0]
    assert d["start_ts"] == at(60)
    assert d["end_ts"] == at(t_end + 5)  # when shifted to P
    assert not d["in_progress"]
    assert abs(d["distance_km"] - 10 * 1.609344) < 0.01  # 10 miles
    assert abs(d["energy_kwh"] - 0.24) < 1e-6
    assert d["wh_per_km"] > 0
    assert abs(d["max_speed_kmh"] - 96.6) < 0.1
    assert 60 <= len(tr.positions) <= 63  # start, stop and park samples included


def test_short_stop_does_not_split_drive():
    tr = Tracker(VIN)
    parked_car(tr)
    t1 = drive(tr, 60, 5, 1000.0, 80.0, 60.0)
    # 90 s stop in P, then off again
    drive(tr, t1 + 90, 5, 1005.0, 77.0, 58.8)
    tr.finish(at(t1 + 90 + 4000))
    assert len(tr.drives) == 1


def test_long_stop_splits_drive():
    tr = Tracker(VIN)
    parked_car(tr)
    t1 = drive(tr, 60, 5, 1000.0, 80.0, 60.0)
    t2 = drive(tr, t1 + 600, 5, 1005.0, 77.0, 58.8)
    tr.finish(at(t2 + 4000))
    assert len(tr.drives) == 2
    assert tr.drives[0]["end_ts"] == at(t1 + 5)


def test_red_light_in_drive_is_still_moving():
    tr = Tracker(VIN)
    parked_car(tr)
    tr.step(at(60), {"Gear": "D", "VehicleSpeed": 20.0})
    tr.step(at(70), {"VehicleSpeed": 0.0})  # stopped at a light, still in D
    tr.step(at(70 + 400), {"VehicleSpeed": 25.0})
    tr.step(at(500), {"VehicleSpeed": 0.0, "Gear": "P"})
    tr.finish(at(5000))
    assert len(tr.drives) == 1


def test_in_progress_drive():
    tr = Tracker(VIN)
    parked_car(tr)
    tr.step(at(60), {"Gear": "D", "VehicleSpeed": 30.0})
    tr.step(at(120), {"VehicleSpeed": 35.0})
    tr.finish(at(150))
    assert len(tr.drives) == 1 and tr.drives[0]["in_progress"]


def test_stale_gear_after_silence_does_not_start_drive():
    tr = Tracker(VIN)
    parked_car(tr)
    tr.step(at(60), {"Gear": "D", "VehicleSpeed": 30.0})
    # stream dies while in D (e.g. tunnel then garage), next data hours later while parked
    tr.step(at(10_000), {"BatteryLevel": 70.0})
    tr.finish(at(10_100))
    assert len(tr.drives) == 1
    assert tr.drives[0]["end_ts"] == at(60)


def test_ac_charge_session():
    tr = Tracker(VIN)
    parked_car(tr, soc=40.0, energy=30.0)
    tr.step(at(100), {"DetailedChargeState": "Starting", "ACChargingEnergyIn": 0.0})
    for i in range(1, 31):
        tr.step(
            at(100 + i * 60),
            {
                "DetailedChargeState": "Charging",
                "ACChargingPower": 11.0,
                "ACChargingEnergyIn": i * 0.18,
                "BatteryLevel": 40.0 + i * 0.3,
            },
        )
    tr.step(at(100 + 31 * 60), {"DetailedChargeState": "Complete", "ACChargingPower": 0.0})
    tr.finish(at(10_000))
    assert len(tr.charges) == 1
    c = tr.charges[0]
    assert c["charger"] == "AC"
    assert abs(c["energy_added_kwh"] - 5.4) < 1e-6
    assert c["max_power_kw"] == 11.0
    assert c["end_state"] == "Complete"
    assert c["start_soc"] == 40.0


def test_dc_charge_detected():
    tr = Tracker(VIN)
    parked_car(tr)
    tr.step(at(100), {"DetailedChargeState": "Charging", "FastChargerPresent": 1.0, "DCChargingPower": 150.0})
    tr.step(at(700), {"DCChargingPower": 90.0, "DCChargingEnergyIn": 20.0})
    tr.step(at(800), {"DetailedChargeState": "Stopped"})
    tr.finish(at(5000))
    assert tr.charges[0]["charger"] == "DC"
    assert tr.charges[0]["max_power_kw"] == 150.0
