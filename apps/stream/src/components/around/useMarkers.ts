"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import type { AroundBusStop, AroundCam, CamReading } from "@/platform/around/types";
import { busStopHtml, camPinClass, camPinHtml } from "./markers";
import { liveSeconds } from "./cards";

type MapLib = typeof import("maplibre-gl");

interface Refs {
  mapRef: RefObject<MapLibreMap | null>;
  libRef: RefObject<MapLib | null>;
  ready: boolean;
}

interface CamMarkerInput {
  cams: AroundCam[];
  readings: Map<string, CamReading>;
  activeCamId: string | null;
  selectedCamId: string | null;
  onSelect: (id: string) => void;
}

/** One DOM marker per camera; rebuilt when cams, counts or selection change. */
export function useCamMarkers({ mapRef, libRef, ready }: Refs, input: CamMarkerInput) {
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const { cams, readings, activeCamId, selectedCamId, onSelect } = input;

  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib) return;
    const markers = markersRef.current;
    for (const cam of cams) {
      const active = cam.id === activeCamId;
      const el = document.createElement("button");
      el.type = "button";
      el.className = camPinClass(active, selectedCamId === cam.id);
      el.innerHTML = camPinHtml(cam, active, readings.get(cam.id));
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelect(cam.id);
      });
      markers.set(cam.id, new lib.Marker({ element: el }).setLngLat([cam.lon, cam.lat]).addTo(map));
    }
    return () => {
      markers.forEach((m) => m.remove());
      markers.clear();
    };
  }, [mapRef, libRef, ready, cams, readings, activeCamId, selectedCamId, onSelect]);
}

interface StopMarkerInput {
  stops: AroundBusStop[];
  fetchedAt: number | null;
  now: number;
  selectedStopId: string | null;
  onSelect: (id: string) => void;
}

/** Bus-stop flags; the countdown label is updated in place each tick instead of rebuilding. */
export function useStopMarkers({ mapRef, libRef, ready }: Refs, input: StopMarkerInput) {
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const { stops, fetchedAt, now, selectedStopId, onSelect } = input;

  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib) return;
    const markers = markersRef.current;
    for (const stop of stops) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "cursor-pointer transition-transform hover:scale-110";
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelect(stop.id);
      });
      markers.set(stop.id, new lib.Marker({ element: el }).setLngLat([stop.lon, stop.lat]).addTo(map));
    }
    return () => {
      markers.forEach((m) => m.remove());
      markers.clear();
    };
  }, [mapRef, libRef, ready, stops, onSelect]);

  useEffect(() => {
    for (const stop of stops) {
      const el = markersRef.current.get(stop.id)?.getElement();
      if (!el) continue;
      const next = fetchedAt
        ? stop.arrivals
            .map((a) => liveSeconds(a.seconds, fetchedAt, now))
            .filter((s) => s > -60)
            .sort((a, b) => a - b)[0]
        : undefined;
      el.innerHTML = busStopHtml(stop, next ?? null, selectedStopId === stop.id);
    }
  }, [stops, fetchedAt, now, selectedStopId]);
}
