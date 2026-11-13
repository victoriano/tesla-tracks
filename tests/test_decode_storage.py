import json
from datetime import UTC, datetime

import duckdb

from tesla_tracks import process
from tesla_tracks.decode import decode_message
from tesla_tracks.storage import RawWriter, compact

NOW = datetime(2026, 11, 13, 9, 0, tzinfo=UTC)


def v_record(ts: str, data: dict, resend=False) -> bytes:
    items = []
    for key, value in data.items():
        items.append({"key": key, "value": value})
    return json.dumps({"data": items, "createdAt": ts, "vin": "LRWTEST000000001", "isResend": resend}).encode()


def test_decode_v_record_types():
    payload = v_record(
        "2026-11-13T08:00:00.123456789Z",
        {
            "VehicleSpeed": {"doubleValue": 31.5},
            "Odometer": {"stringValue": "12345.6"},
            "Gear": {"shiftStateValue": "ShiftStateD"},
            "Location": {"locationValue": {"latitude": 40.1, "longitude": -3.2}},
            "DetailedChargeState": {"detailedChargeStateValue": "DetailedChargeStateCharging"},
            "Locked": {"booleanValue": True},
            "LifetimeEnergyUsed": {"longValue": "4242"},
            "ChargeAmps": {"invalid": True},
        },
    )
    table, rows = decode_message("tesla_V", payload, NOW)
    assert table == "telemetry"
    by = {r["field"]: r for r in rows}
    assert by["VehicleSpeed"]["value_num"] == 31.5
    assert by["Odometer"]["value_num"] == 12345.6
    assert by["Gear"]["value_str"] == "D"
    assert by["Location.latitude"]["value_num"] == 40.1
    assert by["DetailedChargeState"]["value_str"] == "Charging"
    assert by["Locked"]["value_num"] == 1.0
    assert by["LifetimeEnergyUsed"]["value_num"] == 4242
    assert by["ChargeAmps"]["value_str"] == "invalid"
    assert rows[0]["ts"] == datetime(2026, 11, 13, 8, 0, 0, 123456, tzinfo=UTC)


def test_decode_connectivity():
    payload = json.dumps(
        {"vin": "X", "connectionId": "abc", "status": "DISCONNECTED", "createdAt": "2026-11-13T08:00:00Z"}
    )
    table, rows = decode_message("tesla_connectivity", payload, NOW)
    assert table == "connectivity" and rows[0]["status"] == "DISCONNECTED"


def test_writer_spool_replay_and_end_to_end(tmp_path):
    raw, state = tmp_path / "raw", tmp_path / "state"
    w = RawWriter(raw, state)
    # parked, then a 2-minute drive, then parked
    seq = [
        (
            "2026-11-13T08:00:00Z",
            {
                "Gear": {"shiftStateValue": "ShiftStateP"},
                "Odometer": {"doubleValue": 100.0},
                "EnergyRemaining": {"doubleValue": 50.0},
            },
        )
    ]
    seq.append(("2026-11-13T08:01:00Z", {"Gear": {"shiftStateValue": "ShiftStateD"}}))
    for i in range(1, 13):
        seq.append(
            (
                f"2026-11-13T08:{1 + i * 10 // 60:02d}:{(i * 10) % 60:02d}Z",
                {
                    "VehicleSpeed": {"doubleValue": 30.0},
                    "Odometer": {"doubleValue": 100.0 + i * 30 / 360},
                    "EnergyRemaining": {"doubleValue": 50.0 - i * 0.003},
                    "Location": {"locationValue": {"latitude": 40.0 + i * 0.001, "longitude": -3.0}},
                },
            )
        )
    seq.append(
        (
            "2026-11-13T08:03:10Z",
            {"VehicleSpeed": {"doubleValue": 0.0}, "Gear": {"shiftStateValue": "ShiftStateP"}},
        )
    )
    for ts, data in seq:
        w.add(*decode_message("tesla_V", v_record(ts, data), NOW))
    # simulate crash: new writer replays the spool into Parquet
    w2 = RawWriter(raw, state)
    assert w2.pending() == 0
    assert len(list(raw.rglob("*.parquet"))) >= 1
    # duplicates (vehicle resends) must not double count
    w2.add(*decode_message("tesla_V", v_record(*seq[5], resend=True), NOW))
    w2.flush()
    assert compact(raw) == 1
    assert len(list((raw / "telemetry").rglob("*.parquet"))) == 1

    counts = process.run(tmp_path, now=NOW)
    assert counts["drives"] == 1
    row = duckdb.sql(f"SELECT * FROM '{tmp_path}/derived/drives.parquet'").to_arrow_table().to_pylist()[0]
    assert abs(row["distance_km"] - 1.0 * 1.609344) < 0.01
    assert row["in_progress"] is False


def test_build_ca_adds_chain_intermediates(tmp_path):
    from tesla_tracks.fleet import build_ca

    def pem(n):
        return f"-----BEGIN CERTIFICATE-----\n{n}\n-----END CERTIFICATE-----"

    roots = tmp_path / "ca.pem"
    roots.write_text(pem("ROOT1") + "\n" + pem("ROOT2"))
    chain = tmp_path / "fullchain.pem"
    chain.write_text("\n".join([pem("LEAF"), pem("INTER"), pem("ROOT2")]))
    ca = build_ca(roots, chain)
    assert "LEAF" not in ca and ca.count("BEGIN") == 3 and ca.index("INTER") < ca.index("ROOT1")
    assert build_ca(roots, tmp_path / "missing.pem").count("BEGIN") == 2


def test_extract_jws_skips_log_lines():
    from tesla_tracks.fleet import extract_jws

    out = '{"_l":"ERR","_m":"Could not get working directory"}\neyJhbGciOi.eyJpc3Mi.c2ln\n'
    assert extract_jws(out) == "eyJhbGciOi.eyJpc3Mi.c2ln"
