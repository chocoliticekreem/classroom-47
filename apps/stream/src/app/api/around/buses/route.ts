import type { NextRequest } from "next/server";
import { distanceM, parsePoint } from "@/platform/around/geo";
import type { AroundBusStop } from "@/platform/around/types";

interface TflStop {
  naptanId: string;
  commonName: string;
  indicator?: string;
  stopLetter?: string;
  lat: number;
  lon: number;
}

interface TflArrival {
  lineName: string;
  destinationName: string;
  timeToStation: number;
}

const MAX_STOPS = 6;
const ARRIVALS_TTL_MS = 25_000;
// Stop search takes 7–14s on TfL and stops never move, so keep the list much longer than arrivals.
const STOPS_TTL_MS = 30 * 60_000;
const stopsCache = new Map<string, { at: number; stops: TflStop[] }>();
const cache = new Map<string, { at: number; stops: AroundBusStop[] }>();

async function tfl<T>(path: string, timeoutMs = 8000): Promise<T> {
  const res = await fetch(`https://api.tfl.gov.uk${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`TfL ${path} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function GET(request: NextRequest) {
  const point = parsePoint(request.nextUrl.searchParams, 400);
  if (!point) return Response.json({ error: "lat and lon query params are required" }, { status: 400 });
  // ~100m grid key so nearby requests share TfL's 50 req/min anonymous budget.
  const key = `${point.lat.toFixed(3)},${point.lon.toFixed(3)},${point.radius}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ARRIVALS_TTL_MS) return Response.json({ stops: hit.stops });
  try {
    let stopPoints = stopsCache.get(key)?.stops;
    if (!stopPoints || Date.now() - stopsCache.get(key)!.at > STOPS_TTL_MS) {
      ({ stopPoints } = await tfl<{ stopPoints: TflStop[] }>(
        `/StopPoint?lat=${point.lat}&lon=${point.lon}&stopTypes=NaptanPublicBusCoachTram&radius=${point.radius}&modes=bus&returnLines=false`,
        25_000,
      ));
      stopsCache.set(key, { at: Date.now(), stops: stopPoints });
    }
    const nearest = stopPoints
      .map((s) => ({ s, d: distanceM(point.lat, point.lon, s.lat, s.lon) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_STOPS);
    const at = Date.now();
    const stops: AroundBusStop[] = await Promise.all(
      nearest.map(async ({ s, d }) => {
        const arrivals = await tfl<TflArrival[]>(`/StopPoint/${s.naptanId}/Arrivals`).catch(() => []);
        return {
          id: s.naptanId,
          name: s.commonName,
          indicator: s.stopLetter ?? s.indicator ?? "",
          lat: s.lat,
          lon: s.lon,
          distanceM: d,
          at,
          arrivals: arrivals
            .sort((a, b) => a.timeToStation - b.timeToStation)
            .slice(0, 4)
            .map((a) => ({ line: a.lineName, destination: a.destinationName, seconds: a.timeToStation })),
        };
      }),
    );
    cache.set(key, { at, stops });
    return Response.json({ stops });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
