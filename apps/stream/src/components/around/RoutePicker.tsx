"use client";

import { useEffect, useState, type RefObject } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { Route } from "lucide-react";
import { publish } from "@/platform/bus";
import { DESTINATIONS, type RouteResponse } from "@/platform/route/types";
import { lineFeature, setData, type Point } from "./mapLayers";

interface RoutePickerProps {
  mapRef: RefObject<MapLibreMap | null>;
  ready: boolean;
  from: Point;
}

/** Destination chips in the info drawer; draws the fastest (grey dashed) and calmer (ember) routes. */
export function RoutePicker({ mapRef, ready, from }: RoutePickerProps) {
  const [to, setTo] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function pick(name: string) {
    setTo((cur) => (cur === name ? null : name));
    setRoute(null);
    setError(null);
    setLoading(true);
  }

  useEffect(() => {
    if (!to) return;
    const ctrl = new AbortController();
    fetch(`/api/route?from=${from.lat},${from.lon}&to=${encodeURIComponent(to)}&mode=calm`, { signal: ctrl.signal })
      .then(async (r) => {
        const data = (await r.json()) as RouteResponse | { error: string };
        if (ctrl.signal.aborted) return;
        if (!r.ok || "error" in data) {
          setRoute(null);
          setError("error" in data ? data.error : "Route unavailable");
        } else {
          setRoute(data);
          setError(null);
          publish({
            type: "route.suggested",
            to: data.to.name,
            xz: data.calmest.xz,
            polyline: data.calmest.polyline,
            lengthM: data.calmest.lengthM,
            etaMin: data.calmest.etaMin,
            extraMin: data.extraMin,
            lessCrowd: data.lessCrowd,
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [to, from.lat, from.lon]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    setData(map, "around-route-fast", lineFeature(route?.fastest.polyline ?? []));
    setData(map, "around-route-calm", lineFeature(route?.calmest.polyline ?? []));
    if (route) {
      const pts = [...route.fastest.polyline, ...route.calmest.polyline];
      const lats = pts.map((p) => p[0]);
      const lons = pts.map((p) => p[1]);
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding: 60, duration: 900, maxZoom: 17 },
      );
    }
  }, [mapRef, ready, route]);

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 flex items-center gap-1.5 text-[14px] font-extrabold text-text">
          <Route className="size-4 text-candy-orange" aria-hidden />
          Walk to
        </span>
        {DESTINATIONS.map((d) => {
          const active = to === d.name;
          return (
            <button
              key={d.name}
              type="button"
              onClick={() => pick(d.name)}
              aria-pressed={active}
              className={`pill pill-sm ${active ? "pill-candy" : ""}`}
            >
              {d.name}
            </button>
          );
        })}
      </div>
      {to && loading && !route && <p className="text-[13px] font-semibold text-white/60">Planning on live crowd density…</p>}
      {error && <p className="text-[13px] font-semibold text-warn">{error}</p>}
      {route && (
        <div className="flex flex-col gap-2 rounded-[22px] bg-white/[0.06] px-3.5 py-3 text-[13px] font-semibold shadow-[inset_0_2px_3px_rgb(255_255_255/0.1)]">
          <p className="flex items-center gap-2.5 text-white/60">
            <span className="h-0 w-5 shrink-0 border-t-2 border-dashed border-[#9a99a6]" aria-hidden />
            Fastest: {route.fastest.lengthM} m · {Math.round(route.fastest.etaMin)} min · passes ~{Math.round(route.fastest.exposure)}{" "}
            people
          </p>
          <p className="flex items-center gap-2.5 text-text">
            <span className="h-0 w-5 shrink-0 border-t-[3px] border-ember" aria-hidden />
            Calmer: {route.calmest.lengthM} m · {Math.round(route.calmest.etaMin)} min
            {route.extraMin > 0 ? ` (+${route.extraMin} min)` : ""} ·{" "}
            {route.lessCrowd > 0 ? `${Math.round(route.lessCrowd * 100)}% less crowd` : "same crowd either way"}
          </p>
          {route.avoids.length > 0 && (
            <p className="text-[12px] text-white/45">Steers around {route.avoids.join(", ")}</p>
          )}
        </div>
      )}
    </div>
  );
}
