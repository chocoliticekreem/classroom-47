import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { cached, TTL } from "@/lib/server/cache";
import { cacheShort, json } from "@/lib/server/json";
import { distanceM, parsePoint } from "@/platform/around/geo";
import type { AroundLiveCam } from "@/platform/around/types";

interface CatalogueCam {
  id: string;
  name: string;
  area: string;
  lat: number;
  lon: number;
  location_precision: "exact" | "approx";
  subjects: string[];
  page: string;
  resolve: { video_id: string };
}

/** Chris's catalogue lives with the vision service; we only ever embed the YouTube player (ToS). */
const CATALOGUE = join(process.cwd(), "..", "..", "services", "vision", "cameras", "london_live.json");

const catalogue = () =>
  cached("london-live-cams", { ttlMs: TTL.hour, persist: false }, async () => {
    const text = await readFile(CATALOGUE, "utf8");
    return (JSON.parse(text) as { cameras: CatalogueCam[] }).cameras;
  });

export async function GET(request: NextRequest) {
  const point = parsePoint(request.nextUrl.searchParams, 5000);
  if (!point) return Response.json({ error: "lat and lon query params are required" }, { status: 400 });
  try {
    const cams: AroundLiveCam[] = (await catalogue())
      .map((c) => ({
        id: c.id,
        name: c.name,
        area: c.area,
        lat: c.lat,
        lon: c.lon,
        precision: c.location_precision,
        subjects: c.subjects,
        embedUrl: `https://www.youtube.com/embed/${c.resolve.video_id}?autoplay=1&mute=1&playsinline=1`,
        page: c.page,
        distanceM: distanceM(point.lat, point.lon, c.lat, c.lon),
      }))
      .filter((c) => c.distanceM <= point.radius)
      .sort((a, b) => a.distanceM - b.distanceM);
    return json({ cams }, request, cacheShort(600));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
