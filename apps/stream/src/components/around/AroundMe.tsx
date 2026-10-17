"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { Car, LocateFixed, User } from "lucide-react";
import type { StreamLocation } from "@/lib/types";
import { useFlowLayer } from "@/platform/around/useFlowLayer";
import { CamCard, DisruptionCard, LiveCamCard, StationCard } from "./cards";
import { RoutePicker } from "./RoutePicker";
import {
  circlePolygon,
  crimeCollection,
  disruptionCollection,
  PITCH,
  setData,
  WALK_RADIUS_M,
  ZOOM,
} from "./mapLayers";
import { useAroundData } from "./useAroundData";
import { useAroundMap, type DisruptionEvents } from "./useAroundMap";
import { useCamCounts } from "./useCamCounts";
import { useGeolocation } from "./useGeolocation";
import { useCamMarkers, useLiveCamMarkers, useStationMarkers } from "./useMarkers";

const AIR_TONE = {
  good: "text-ok",
  fair: "text-ok",
  moderate: "text-warn",
  poor: "text-live",
  "very poor": "text-live",
} as const;

function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return y && m ? new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : ym;
}

interface AroundMeProps {
  location: StreamLocation;
  activeCamUrl: string | null;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function AroundMe({ location, activeCamUrl }: AroundMeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [disruptionId, setDisruptionId] = useState<string | null>(null);
  const [disruptionPinned, setDisruptionPinned] = useState(false);

  const eventsRef = useRef<DisruptionEvents>({ hover: () => {}, click: () => {} });
  useEffect(() => {
    eventsRef.current = {
      hover: (id) => {
        if (!disruptionPinned) setDisruptionId(id);
      },
      click: (id) => {
        setDisruptionId(id);
        setDisruptionPinned(true);
      },
    };
  }, [disruptionPinned]);

  const geo = useGeolocation();
  const geoPoint = geo.active ? geo.queryPoint : null;
  const point = useMemo(
    () => geoPoint ?? { lat: location.lat, lon: location.lon },
    [geoPoint, location.lat, location.lon],
  );
  const dot = geo.active && geo.fix ? geo.fix : point;

  const { mapRef, libRef, streamerRef, ready } = useAroundMap(containerRef, point, eventsRef);
  const { cams, disruptions, stations, crime, tide, air, liveCams, updatedAt, failed } = useAroundData(point);
  const readings = useCamCounts(cams.map((c) => c.id));
  const flow = useFlowLayer(mapRef, ready, cams, point);
  const [stationId, setStationId] = useState<string | null>(null);
  const [liveCamId, setLiveCamId] = useState<string | null>(null);

  const activeCam = cams.find((c) => c.videoUrl === activeCamUrl) ?? null;
  const selectedCam =
    selectedId === undefined ? activeCam : cams.find((c) => c.id === selectedId) ?? null;
  const disruption = disruptions.find((d) => d.id === disruptionId) ?? null;
  const station = stations.find((s) => s.id === stationId) ?? null;
  const liveCam = liveCams.find((c) => c.id === liveCamId) ?? null;

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.flyTo({ center: [point.lon, point.lat], zoom: ZOOM, pitch: PITCH, duration: 1800, essential: true });
    setData(map, "around-walk", circlePolygon(point, WALK_RADIUS_M));
  }, [mapRef, ready, point]);

  useEffect(() => {
    streamerRef.current?.setLngLat([dot.lon, dot.lat]);
  }, [streamerRef, ready, dot.lon, dot.lat]);

  useEffect(() => {
    const map = mapRef.current;
    if (ready && map) setData(map, "around-disruptions", disruptionCollection(disruptions));
  }, [mapRef, ready, disruptions]);

  useEffect(() => {
    const map = mapRef.current;
    if (ready && map) setData(map, "around-crime", crimeCollection(crime?.points ?? []));
  }, [mapRef, ready, crime]);

  const selectCam = useCallback((id: string) => {
    setSelectedId(id);
    setLiveCamId(null);
  }, []);
  const selectLiveCam = useCallback((id: string) => {
    setLiveCamId(id);
    setSelectedId(null);
  }, []);
  const selectStation = useCallback((id: string) => setStationId(id), []);

  const refs = { mapRef, libRef, ready };
  useCamMarkers(refs, {
    cams,
    readings,
    activeCamId: activeCam?.id ?? null,
    selectedCamId: selectedCam?.id ?? null,
    onSelect: selectCam,
  });
  useStationMarkers(refs, { items: stations, selectedId: stationId, onSelect: selectStation });
  useLiveCamMarkers(refs, { items: liveCams, selectedId: liveCamId, onSelect: selectLiveCam });


  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-text">Around you</h2>
          <span className="truncate text-[13px] text-muted">
            {geo.active && geo.fix ? "Your real position" : `${location.name} · ${location.area}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          <span className="flex items-center gap-1 text-text">
            <User className="size-3.5 text-[#ffd166]" aria-hidden />
            {plural(flow.totals.people, "person").replace("persons", "people")}
          </span>
          <span className="flex items-center gap-1 text-text">
            <Car className="size-3.5 text-[#5ec8ff]" aria-hidden />
            {plural(flow.totals.vehicles, "vehicle")}
          </span>
          <span className="text-dim">from {plural(flow.clips, "live camera")}</span>
          {air && (
            <span className="font-mono text-dim" title={`PM2.5 ${air.pm25} · NO₂ ${air.no2} µg/m³`}>
              Air <span className={AIR_TONE[air.band]}>{air.band}</span> {air.eaqi}
            </span>
          )}
          {tide && (
            <span className="font-mono text-dim" title={`EA gauge at ${tide.station}`}>
              Thames {tide.levelM.toFixed(1)} m {tide.trend}
            </span>
          )}
          {crime && crime.month && (
            <span className="font-mono text-dim" title={crime.streets.map((s) => `${s.name}: ${s.count}`).join("\n")}>
              {crime.total} crimes within 600 m, {monthLabel(crime.month)}
            </span>
          )}
          {updatedAt && (
            <span className="font-mono text-dim">
              Updated {updatedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {geo.active && geo.fix && (
            <span className="rounded-md border border-ok/40 bg-ok/10 px-1.5 py-0.5 font-mono text-[11px] text-ok">
              GPS ±{geo.fix.accuracyM} m
            </span>
          )}
          <button
            type="button"
            onClick={geo.toggle}
            aria-pressed={geo.active}
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-semibold transition-colors ${
              geo.active
                ? "border-ember bg-ember text-bg"
                : "border-line-strong bg-surface-2 text-text hover:border-text/40"
            }`}
          >
            <LocateFixed className={`size-3.5 ${geo.active && !geo.fix ? "animate-pulse" : ""}`} />
            {geo.active ? (geo.fix ? "Using my location" : "Locating…") : "Use my location"}
          </button>
        </div>
      </header>

      {geo.error && (
        <p className="mx-4 mb-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
          {geo.error}
        </p>
      )}

      <div className="relative mx-3 h-[360px] overflow-hidden rounded-lg border border-line bg-bg md:h-[460px]">
        <div
          ref={containerRef}
          className="absolute inset-0 h-full w-full [&_.maplibregl-ctrl-attrib]:!bg-bg/70 [&_.maplibregl-ctrl-attrib]:!text-[10px] [&_.maplibregl-ctrl-attrib_a]:!text-muted"
        />

        {liveCam && <LiveCamCard cam={liveCam} onClose={() => setLiveCamId(null)} />}

        {station && <StationCard station={station} onClose={() => setStationId(null)} />}

        {selectedCam && !liveCam && (
          <CamCard
            cam={selectedCam}
            reading={readings.get(selectedCam.id)}
            isYourFeed={selectedCam.id === activeCam?.id}
            onClose={() => setSelectedId(null)}
          />
        )}


        {disruption && (
          <DisruptionCard
            item={disruption}
            pinned={disruptionPinned}
            onClose={() => {
              setDisruptionPinned(false);
              setDisruptionId(null);
            }}
          />
        )}

        {failed && (
          <p className="absolute right-3 top-3 rounded-md border border-line bg-surface/90 px-2 py-1 text-[11px] text-muted">
            Live data unavailable
          </p>
        )}
      </div>

      <RoutePicker mapRef={mapRef} ready={ready} from={point} />
    </section>
  );
}

