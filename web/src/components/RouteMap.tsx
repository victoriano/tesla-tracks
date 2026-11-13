"use client";

import { useEffect, useRef } from "react";
import { LngLatBounds, Map as MapLibre, Marker, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Free vector tiles, no API key. Override with NEXT_PUBLIC_MAP_STYLE.
const STYLE = process.env.NEXT_PUBLIC_MAP_STYLE || "https://tiles.openfreemap.org/styles/dark";

// Served from /public (copied from node_modules on install) so bundlers do not have to resolve the worker.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export type Route = { id: string; coords: [number, number][] };

export default function RouteMap({ routes, height = 420 }: { routes: Route[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const all = routes.flatMap((r) => r.coords);
    if (!all.length) return;
    const map = new MapLibre({ container: ref.current, style: STYLE, attributionControl: { compact: true } });
    const bounds = all.reduce((b, c) => b.extend(c), new LngLatBounds(all[0], all[0]));
    map.fitBounds(bounds, { padding: 40, duration: 0, maxZoom: 15 });
    map.on("load", () => {
      map.addSource("routes", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: routes.map((r) => ({
            type: "Feature",
            properties: { id: r.id },
            geometry: { type: "LineString", coordinates: r.coords },
          })),
        },
      });
      map.addLayer({
        id: "routes",
        type: "line",
        source: "routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ef4444", "line-width": 3.5, "line-opacity": routes.length > 1 ? 0.55 : 0.95 },
      });
      if (routes.length === 1) {
        const c = routes[0].coords;
        new Marker({ color: "#22c55e", scale: 0.7 }).setLngLat(c[0]).addTo(map);
        new Marker({ color: "#ef4444", scale: 0.7 }).setLngLat(c[c.length - 1]).addTo(map);
      }
    });
    return () => map.remove();
  }, [routes]);

  return <div ref={ref} style={{ height }} className="w-full overflow-hidden rounded-xl border border-zinc-800" />;
}
