# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx"]
# ///
"""Build src/tesla_tracks/demo_routes.json: real road routes for the demo car.

Routes come from the public OSRM demo server (OpenStreetMap data, ODbL: © OpenStreetMap contributors).
Run once by hand; the demo generator then works offline.

    uv run scripts/build_demo_routes.py
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import httpx

OSRM = "https://router.project-osrm.org/route/v1/driving"
OUT = Path(__file__).resolve().parents[1] / "src" / "tesla_tracks" / "demo_routes.json"

# A fictional San Francisco driver: home in Noe Valley, office in Palo Alto.
PLACES = {
    "home": (37.7510, -122.4330),
    "office": (37.4443, -122.1598),
    "marina": (37.8030, -122.4370),
    "berkeley": (37.8700, -122.2680),
    "oakland": (37.8044, -122.2590),
    "sfo": (37.6160, -122.3860),
    "sausalito": (37.8590, -122.4850),
    "san_mateo": (37.5630, -122.3255),
    "supercharger": (37.6575, -122.4040),  # South San Francisco
    "half_moon_bay": (37.4636, -122.4286),
}
TRIPS = [
    ("home", "office"),
    ("office", "home"),
    ("home", "marina"),
    ("marina", "home"),
    ("home", "berkeley"),
    ("berkeley", "home"),
    ("home", "oakland"),
    ("oakland", "home"),
    ("home", "sfo"),
    ("sfo", "home"),
    ("home", "sausalito"),
    ("sausalito", "home"),
    ("home", "san_mateo"),
    ("san_mateo", "office"),
    ("office", "supercharger"),
    ("supercharger", "home"),
    ("home", "half_moon_bay"),
    ("half_moon_bay", "home"),
]
MIN_STEP_M = 20  # merge shorter segments to keep the file small


def fetch(a: tuple[float, float], b: tuple[float, float]) -> dict:
    url = f"{OSRM}/{a[1]},{a[0]};{b[1]},{b[0]}"
    params = {"overview": "full", "geometries": "geojson", "annotations": "speed,distance"}
    resp = httpx.get(url, params=params, timeout=30, headers={"User-Agent": "tesla-tracks-demo-builder"})
    resp.raise_for_status()
    route = resp.json()["routes"][0]
    coords = route["geometry"]["coordinates"]
    ann = route["legs"][0]["annotation"]
    # points: [lon, lat, speed of the segment that starts here (m/s)]
    points = [[round(coords[0][0], 5), round(coords[0][1], 5), ann["speed"][0]]]
    acc = 0.0
    for i, dist in enumerate(ann["distance"]):
        acc += dist
        last = i == len(ann["distance"]) - 1
        if acc >= MIN_STEP_M or last:
            nxt = ann["speed"][i + 1] if not last else 0.0
            points.append([round(coords[i + 1][0], 5), round(coords[i + 1][1], 5), round(nxt, 1)])
            acc = 0.0
    return {"distance_m": round(route["distance"]), "duration_s": round(route["duration"]), "points": points}


def main() -> None:
    routes = []
    for src, dst in TRIPS:
        r = fetch(PLACES[src], PLACES[dst])
        routes.append({"from": src, "to": dst, **r})
        km, minutes = r["distance_m"] / 1000, r["duration_s"] / 60
        print(f"{src:>14} -> {dst:<14} {km:6.1f} km {minutes:5.0f} min {len(r['points'])} pts")
        time.sleep(1.1)  # be gentle with the public demo server
    doc = {
        "attribution": "Routes from OSRM (project-osrm.org), map data © OpenStreetMap contributors, ODbL",
        "places": {k: list(v) for k, v in PLACES.items()},
        "routes": routes,
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
