import type { NextRequest } from "next/server";
import type { LiveWeather } from "@/platform/demo";
import type { AroundCam, CamReading } from "@/platform/around/types";
import { ORIGIN } from "@/twin/config";
import { estimate } from "@/twin/field/estimate";
import { buildSegments, type GraphSegment } from "@/twin/field/graph";
import { CAM_RADIUS_M, FIELD_CACHE_MS } from "@/twin/field/model";
import type { FieldResponse } from "@/twin/field/types";
import { loadGeometry } from "@/twin/osm";

let segments: GraphSegment[] | null = null;
let cache: { at: number; body: FieldResponse } | null = null;

async function getJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  const now = Date.now();
  if (cache && now - cache.at < FIELD_CACHE_MS) return Response.json(cache.body);
  try {
    const geometry = await loadGeometry();
    segments ??= buildSegments(geometry.roads);
    const origin = request.nextUrl.origin;
    const q = `lat=${ORIGIN.lat}&lon=${ORIGIN.lon}`;
    const [{ cams }, weather] = await Promise.all([
      getJson<{ cams: AroundCam[] }>(`${origin}/api/around/cams?${q}&radius=${CAM_RADIUS_M}`, { cams: [] }),
      getJson<LiveWeather | null>(`${origin}/api/around/weather?${q}`, null),
    ]);
    const ids = cams.map((c) => c.id).join(",");
    const { readings } = ids
      ? await getJson<{ readings: CamReading[] }>(`${origin}/api/around/counts?ids=${ids}`, { readings: [] })
      : { readings: [] };
    const body = estimate({
      segments,
      pois: geometry.pois,
      cams,
      readings: readings ?? [],
      weather: weather?.kind ?? "clear",
      now,
    });
    cache = { at: now, body };
    return Response.json(body);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
