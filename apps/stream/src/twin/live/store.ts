"use client";

import { create } from "zustand";
import { useEffect } from "react";
import type { AroundBusStop, AroundCam, AroundDisruption, CamClipTracks } from "@/platform/around/types";
import { subscribe } from "@/platform/bus";
import { ORIGIN, type TwinGeometry } from "../config";

export interface LiveState {
  cams: AroundCam[];
  clips: Record<string, CamClipTracks>;
  stops: AroundBusStop[];
  disruptions: AroundDisruption[];
  roads: TwinGeometry["roads"];
  streamer: { lat: number; lon: number };
  updatedAt: number;
  /** Wall clock, ticked once a second for render-time countdowns; 0 before the feeds start. */
  now: number;
  screenMode: "video" | "frame" | null;
  gps: "off" | "on" | "error";
}

export const useLive = create<LiveState>(() => ({
  cams: [],
  clips: {},
  stops: [],
  disruptions: [],
  roads: [],
  streamer: { ...ORIGIN },
  updatedAt: 0,
  now: 0,
  screenMode: null,
  gps: "off",
}));

let gpsWatch: number | null = null;

/** Browser geolocation drives the streamer position until stopped. */
export function toggleGps() {
  if (gpsWatch !== null) {
    navigator.geolocation.clearWatch(gpsWatch);
    gpsWatch = null;
    useLive.setState({ gps: "off" });
    return;
  }
  if (!("geolocation" in navigator)) {
    useLive.setState({ gps: "error" });
    return;
  }
  gpsWatch = navigator.geolocation.watchPosition(
    (pos) => useLive.setState({ streamer: { lat: pos.coords.latitude, lon: pos.coords.longitude }, gps: "on" }),
    () => {
      if (gpsWatch !== null) navigator.geolocation.clearWatch(gpsWatch);
      gpsWatch = null;
      useLive.setState({ gps: "error" });
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15_000 },
  );
  useLive.setState({ gps: "on" });
}

const CAMS_MS = 60_000;
const DISRUPTIONS_MS = 60_000;
const BUSES_MS = 30_000;
const TRACKS_MS = 15_000;

function poll<T>(url: () => string | null, everyMs: number, apply: (data: T) => void) {
  let controller: AbortController | null = null;
  let stopped = false;
  const tick = async () => {
    const u = url();
    if (!u) return;
    controller?.abort();
    controller = new AbortController();
    try {
      const res = await fetch(u, { signal: controller.signal, cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as T;
      if (!stopped) {
        apply(data);
        useLive.setState({ updatedAt: Date.now() });
      }
    } catch {
      // aborted or network error; the next tick retries
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), everyMs);
  return () => {
    stopped = true;
    controller?.abort();
    clearInterval(timer);
  };
}

const q = (radius: number) => `lat=${ORIGIN.lat}&lon=${ORIGIN.lon}&radius=${radius}`;

let refs = 0;
let stopAll: (() => void) | null = null;

function start() {
  const stops: (() => void)[] = [
    poll<{ cams: AroundCam[] }>(() => `/api/around/cams?${q(700)}`, CAMS_MS, (d) =>
      useLive.setState({ cams: d.cams ?? [] }),
    ),
    poll<{ items: AroundDisruption[] }>(() => `/api/around/disruptions?${q(700)}`, DISRUPTIONS_MS, (d) =>
      useLive.setState({ disruptions: d.items ?? [] }),
    ),
    poll<{ stops: AroundBusStop[] }>(() => `/api/around/buses?${q(400)}`, BUSES_MS, (d) =>
      useLive.setState({ stops: d.stops ?? [] }),
    ),
    poll<{ clips: CamClipTracks[] }>(
      () => {
        const ids = useLive.getState().cams.map((c) => c.id);
        return ids.length ? `/api/around/tracks?ids=${ids.join(",")}` : null;
      },
      TRACKS_MS,
      (d) => {
        const clips: Record<string, CamClipTracks> = { ...useLive.getState().clips };
        for (const clip of d.clips ?? []) if (clip.tracks?.length) clips[clip.camId] = clip;
        useLive.setState({ clips });
      },
    ),
    poll<TwinGeometry>(() => "/api/twin/osm", 10 * 60_000, (d) =>
      useLive.setState({ roads: (d.roads ?? []).filter((r) => r.kind === "major" || r.kind === "minor") }),
    ),
    subscribe((e) => {
      if (e.type === "stream.location") {
        useLive.setState({ streamer: { lat: e.location.lat, lon: e.location.lon } });
      }
    }),
  ];
  useLive.setState({ now: Date.now() });
  const clock = setInterval(() => useLive.setState({ now: Date.now() }), 1000);
  stops.push(() => clearInterval(clock));
  const params = new URLSearchParams(window.location.search);
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (params.has("lat") && params.has("lon") && Number.isFinite(lat) && Number.isFinite(lon)) {
    useLive.setState({ streamer: { lat, lon } });
  }
  return () => stops.forEach((s) => s());
}

/** Starts the polling loops once, shared by every component that mounts it. */
export function useLiveFeeds() {
  useEffect(() => {
    if (refs++ === 0) stopAll = start();
    return () => {
      if (--refs === 0) {
        stopAll?.();
        stopAll = null;
      }
    };
  }, []);
}

export function useNow() {
  return useLive((s) => s.now);
}
