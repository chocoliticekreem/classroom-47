"use client";

import { useEffect, useState } from "react";
import type {
  AroundAir,
  AroundBusStop,
  AroundCam,
  AroundCrime,
  AroundDisruption,
  AroundLiveCam,
  AroundStation,
  AroundTide,
} from "@/platform/around/types";
import type { Point } from "./mapLayers";

const CAM_RADIUS_M = 900;
const DISRUPTION_RADIUS_M = 1500;
const BUS_RADIUS_M = 400;
const STATION_RADIUS_M = 900;
const CRIME_RADIUS_M = 600;
const LIVECAM_RADIUS_M = 3000;
const REFRESH_MS = 60_000;
const BUS_REFRESH_MS = 30_000;
const SLOW_REFRESH_MS = 5 * 60_000;

async function getJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  const res = await fetch(url, { signal }).catch(() => null);
  return res?.ok ? ((await res.json()) as T) : null;
}

export function useAroundData(point: Point) {
  const [cams, setCams] = useState<AroundCam[]>([]);
  const [disruptions, setDisruptions] = useState<AroundDisruption[]>([]);
  const [stops, setStops] = useState<AroundBusStop[]>([]);
  const [stations, setStations] = useState<AroundStation[]>([]);
  const [crime, setCrime] = useState<AroundCrime | null>(null);
  const [tide, setTide] = useState<AroundTide | null>(null);
  const [air, setAir] = useState<AroundAir | null>(null);
  const [liveCams, setLiveCams] = useState<AroundLiveCam[]>([]);
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
    const q = `lat=${point.lat}&lon=${point.lon}`;
    const load = async () => {
      const [buses, stationsJson] = await Promise.all([
        getJson<{ stops?: AroundBusStop[] }>(`/api/around/buses?${q}&radius=${BUS_RADIUS_M}`, controller.signal),
        getJson<{ stations?: AroundStation[] }>(
          `/api/around/stations?${q}&radius=${STATION_RADIUS_M}`,
          controller.signal,
        ),
      ]);
      if (controller.signal.aborted) return;
      if (buses) {
        setStops(buses.stops ?? []);
        setBusFetchedAt(Date.now());
      }
      if (stationsJson) setStations(stationsJson.stations ?? []);
    };
    load();
    const id = setInterval(load, BUS_REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [point.lat, point.lon]);

  useEffect(() => {
    const controller = new AbortController();
    const q = `lat=${point.lat}&lon=${point.lon}`;
    const load = async () => {
      const [crimeJson, tideJson, airJson, liveJson] = await Promise.all([
        getJson<AroundCrime>(`/api/around/crime?${q}&radius=${CRIME_RADIUS_M}`, controller.signal),
        getJson<AroundTide>(`/api/around/tide?${q}`, controller.signal),
        getJson<AroundAir>(`/api/around/air?${q}`, controller.signal),
        getJson<{ cams?: AroundLiveCam[] }>(`/api/around/livecams?${q}&radius=${LIVECAM_RADIUS_M}`, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      if (crimeJson) setCrime(crimeJson);
      if (tideJson) setTide(tideJson);
      if (airJson) setAir(airJson);
      if (liveJson) setLiveCams(liveJson.cams ?? []);
    };
    load();
    const id = setInterval(load, SLOW_REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [point.lat, point.lon]);

  return { cams, disruptions, stops, stations, crime, tide, air, liveCams, busFetchedAt, updatedAt, failed };
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
