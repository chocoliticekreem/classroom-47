import type { NextRequest } from "next/server";
import { cached, TTL } from "@/lib/server/cache";
import { cacheShort, json } from "@/lib/server/json";
import { distanceM, parsePoint } from "@/platform/around/geo";
import type { AroundCam } from "@/platform/around/types";

interface TflPlace {
  id: string;
  commonName: string;
  lat: number;
  lon: number;
  additionalProperties: { key: string; value: string }[];
}

const COMPASS: Record<string, number> = { N: 0, NORTH: 0, E: 90, EAST: 90, S: 180, SOUTH: 180, W: 270, WEST: 270 };

// TfL's "view" field often starts with the direction the camera faces, e.g. "WEST-twds Blackfriars".
function headingFromView(view: string | undefined): number | null {
  const word = view?.trim().toUpperCase().match(/^(NORTH|SOUTH|EAST|WEST|[NSEW])\b/)?.[1];
  return word ? COMPASS[word] : null;
}

async function fetchCams(): Promise<Omit<AroundCam, "distanceM">[]> {
  const res = await fetch("https://api.tfl.gov.uk/Place/Type/JamCam");
  if (!res.ok) throw new Error(`TfL JamCam list failed: HTTP ${res.status}`);
  const places = (await res.json()) as TflPlace[];
  const prop = (p: TflPlace, key: string) => p.additionalProperties.find((a) => a.key === key)?.value;
  return places
    .filter((p) => prop(p, "available") !== "false" && prop(p, "videoUrl"))
    .map((p) => ({
      id: p.id,
      name: p.commonName,
      lat: p.lat,
      lon: p.lon,
      videoUrl: prop(p, "videoUrl")!,
      imageUrl: prop(p, "imageUrl") ?? "",
      view: prop(p, "view") ?? "",
      heading: headingFromView(prop(p, "view")),
    }));
}

// Cameras are added or retired over weeks; an hour-old list is as good as a live one.
const allCams = () => cached("tfl-jamcams", { ttlMs: TTL.hour }, fetchCams);

export async function GET(request: NextRequest) {
  const point = parsePoint(request.nextUrl.searchParams, 800);
  if (!point) return Response.json({ error: "lat and lon query params are required" }, { status: 400 });
  try {
    const cams: AroundCam[] = (await allCams())
      .map((c) => ({ ...c, distanceM: distanceM(point.lat, point.lon, c.lat, c.lon) }))
      .filter((c) => c.distanceM <= point.radius)
      .sort((a, b) => a.distanceM - b.distanceM);
    return json({ cams }, request, cacheShort(300));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
