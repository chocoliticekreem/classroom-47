"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { Car, ChevronDown, LocateFixed, ShieldAlert, User, Waves, Wind } from "lucide-react";
import { PipStage } from "@/components/stream/PipStage";
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
  /** The stream, shown as a swappable picture-in-picture on top of the map. */
  feed: ReactNode | null;
}

interface TileProps {
  icon: ReactNode;
  orb: string;
  value: string | number;
  label: string;
  tone?: string;
  title?: string;
  wide?: boolean;
}

function Tile({ icon, orb, value, label, tone = "text-text", title, wide }: TileProps) {
  return (
    <div className={`tile ${wide ? "col-span-2" : ""}`} title={title}>
      <span className={`grid size-10 shrink-0 place-items-center rounded-full shadow-[inset_0_2px_3px_rgb(255_255_255/0.45)] ${orb}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className={`block text-[28px] font-extrabold leading-none tracking-[-0.03em] ${tone}`}>{value}</span>
        <span className="mt-1 block truncate text-[12px] font-semibold text-white/60">{label}</span>
      </span>
    </div>
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function AroundMe({ location, activeCamUrl, feed }: AroundMeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [disruptionId, setDisruptionId] = useState<string | null>(null);
  const [disruptionPinned, setDisruptionPinned] = useState(false);
  const [infoOpen, setInfoOpen] = useState(() => window.matchMedia("(min-width: 768px)").matches);

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


  const place = geo.active && geo.fix ? "Your real position" : `${location.name} · ${location.area}`;

  return (
    <PipStage
      className="min-h-[560px] flex-1"
      corner="top-right"
      primaryLabel="map"
      secondaryLabel="stream"
      secondary={feed}
      primary={
        <div
          ref={containerRef}
          className="absolute inset-0 h-full w-full [&_.maplibregl-ctrl-attrib]:!bg-bg/70 [&_.maplibregl-ctrl-attrib]:!text-[10px] [&_.maplibregl-ctrl-attrib_a]:!text-muted"
        />
      }
      overlay={({ swapped }) =>
        swapped ? null : (
          <>
            <aside className="glass pointer-events-auto absolute left-3 top-3 flex max-h-[calc(100%-1.5rem)] w-[min(400px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-[28px]">
              <header className="flex items-center gap-3 px-4 pb-3 pt-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[18px] font-extrabold leading-tight tracking-[-0.02em] text-text">Around you</h2>
                    <span className="live-badge">
                      <span className="animate-live size-1.5 rounded-full bg-white" />
                      Live
                    </span>
                  </div>
                  <p className="truncate text-[13px] font-semibold text-white/60">{place}</p>
                </div>
                {!infoOpen && (
                  <span className="flex items-center gap-2 text-[14px] font-extrabold text-text">
                    <User className="size-4 text-[#ffd166]" aria-hidden />
                    {flow.totals.people}
                    <Car className="size-4 text-[#5ec8ff]" aria-hidden />
                    {flow.totals.vehicles}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setInfoOpen((o) => !o)}
                  aria-expanded={infoOpen}
                  aria-label={infoOpen ? "Collapse info" : "Expand info"}
                  className="pill glass !h-9 !w-9 !px-0"
                >
                  <ChevronDown className={`size-4 transition-transform duration-300 ${infoOpen ? "rotate-180" : ""}`} aria-hidden />
                </button>
              </header>

              <div
                inert={!infoOpen}
                className={`grid min-h-0 transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease-out)] ${
                  infoOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="scrollbar-thin min-h-0 overflow-y-auto">
                  <p className="px-4 pb-2 text-[12px] font-semibold text-white/50">
                    from {plural(flow.clips, "live camera")}
                  </p>
                  <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                    <Tile
                      icon={<User className="size-5 text-[#3a2600]" aria-hidden />}
                      orb="bg-[#ffd166]"
                      value={flow.totals.people}
                      label="people"
                    />
                    <Tile
                      icon={<Car className="size-5 text-[#00283d]" aria-hidden />}
                      orb="bg-[#5ec8ff]"
                      value={flow.totals.vehicles}
                      label="vehicles"
                    />
                    {air && (
                      <Tile
                        icon={<Wind className="size-5 text-[#04281a]" aria-hidden />}
                        orb="bg-ok"
                        value={air.eaqi}
                        tone={AIR_TONE[air.band]}
                        label={`Air ${air.band}`}
                        title={`PM2.5 ${air.pm25} · NO₂ ${air.no2} µg/m³`}
                      />
                    )}
                    {tide && (
                      <Tile
                        icon={<Waves className="size-5 text-[#00233d]" aria-hidden />}
                        orb="bg-[#4da3ff]"
                        value={`${tide.levelM.toFixed(1)} m`}
                        label={`Thames ${tide.trend}`}
                        title={`EA gauge at ${tide.station}`}
                      />
                    )}
                    {crime && crime.month && (
                      <Tile
                        wide
                        icon={<ShieldAlert className="size-5 text-[#3d0010]" aria-hidden />}
                        orb="bg-[#ff6b8a]"
                        value={crime.total}
                        label={`crimes within 600 m, ${monthLabel(crime.month)}`}
                        title={crime.streets.map((s) => `${s.name}: ${s.count}`).join("\n")}
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                    <button
                      type="button"
                      onClick={geo.toggle}
                      aria-pressed={geo.active}
                      className={`pill pill-sm ${geo.active ? "pill-candy" : "glass"}`}
                    >
                      <LocateFixed className={`size-3.5 ${geo.active && !geo.fix ? "animate-pulse" : ""}`} aria-hidden />
                      {geo.active ? (geo.fix ? "Using my location" : "Locating…") : "Use my location"}
                    </button>
                    {geo.active && geo.fix && (
                      <span className="rounded-full bg-ok/15 px-2.5 py-1 text-[12px] font-bold text-ok">
                        GPS ±{geo.fix.accuracyM} m
                      </span>
                    )}
                    {updatedAt && (
                      <span className="ml-auto text-[12px] font-semibold text-white/45">
                        Updated {updatedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>

                  {geo.error && (
                    <p className="mx-3 mb-3 rounded-2xl bg-warn/10 px-3 py-2 text-[12px] font-semibold text-warn">{geo.error}</p>
                  )}

                  <RoutePicker mapRef={mapRef} ready={ready} from={point} />
                </div>
              </div>
            </aside>

            <div className="pointer-events-auto absolute bottom-14 right-3 flex w-[min(320px,calc(100%-1.5rem))] flex-col items-end gap-3">
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
            </div>

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
              <p className="glass absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-1.5 text-[12px] font-bold text-white/70">
                Live data unavailable
              </p>
            )}
          </>
        )
      }
    />
  );
}
