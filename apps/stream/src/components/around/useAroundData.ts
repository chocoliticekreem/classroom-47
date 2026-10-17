"use client";

import { useEffect, useState } from "react";
import type { AroundBusStop, AroundCam, AroundDisruption } from "@/platform/around/types";
import type { Point } from "./mapLayers";

const CAM_RADIUS_M = 900;
const DISRUPTION_RADIUS_M = 1500;
const BUS_RADIUS_M = 400;
const REFRESH_MS = 60_000;
const BUS_REFRESH_MS = 30_000;

export function useAroundData(point: Point) {
  const [cams, setCams] = useState<AroundCam[]>([]);
  const [disruptions, setDisruptions] = useState<AroundDisruption[]>([]);
  const [stops, setStops] = useState<AroundBusStop[]>([]);
  const [busFetchedAt, setBusFetchedAt] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const q = `lat=${point.lat}&lon=${point.lon}`;
    const load = async () => {
      try {
        const [camsRes, disRes] = await Promise.all([
          fetch(`/api/around/cams?${q}&radius=${CAM_RADIUS_M}`, { signal: controller.signal }),
          fetch(`/api/around/disruptions?${q}&radius=${DISRUPTION_RADIUS_M}`, {
            signal: controller.signal,
          }),
        ]);
        const [camsJson, disJson] = (await Promise.all([camsRes.json(), disRes.json()])) as [
          { cams?: AroundCam[] },
          { items?: AroundDisruption[] },
        ];
        if (controller.signal.aborted) return;
        setCams(camsJson.cams ?? []);
        setDisruptions(disJson.items ?? []);
        setUpdatedAt(new Date());
        setFailed(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("[around] fetch failed", err);
        setFailed(true);
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [point.lat, point.lon]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(
          `/api/around/buses?lat=${point.lat}&lon=${point.lon}&radius=${BUS_RADIUS_M}`,
          { signal: controller.signal },
        );
        if (!res.ok) return;
        const json = (await res.json()) as { stops?: AroundBusStop[] };
        if (controller.signal.aborted) return;
        setStops(json.stops ?? []);
        setBusFetchedAt(Date.now());
      } catch (err) {
        if (!controller.signal.aborted) console.error("[around] buses failed", err);
      }
    };
    load();
    const id = setInterval(load, BUS_REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [point.lat, point.lon]);

  return { cams, disruptions, stops, busFetchedAt, updatedAt, failed };
}

/** Re-renders every `ms` so client-side countdowns tick. */
export function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
