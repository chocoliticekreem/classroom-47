import type { NextRequest } from "next/server";
import type { AroundDisruption } from "@/platform/around/types";
import { buildGraph, planRoutes } from "@/platform/route/plan";
import { DESTINATIONS } from "@/platform/route/types";
import { ORIGIN, toLatLon, toLocal } from "@/twin/config";
import type { FieldResponse } from "@/twin/field/types";

async function getJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

function parseLatLon(s: string | null): { lat: number; lon: number } | null {
  const [lat, lon] = (s ?? "").split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0) ? { lat, lon } : null;
}

function resolveTo(raw: string | null, anchors: FieldResponse["anchors"]) {
  const point = parseLatLon(raw);
  if (point) return { name: `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`, ...point, xz: toLocal(point.lat, point.lon) };
  const q = (raw ?? "").trim().toLowerCase();
  if (!q) return null;
  const known = DESTINATIONS.find((d) => d.name.toLowerCase() === q || d.name.toLowerCase().startsWith(q));
  if (known) return { ...known, xz: toLocal(known.lat, known.lon) };
  const anchor = anchors.find((a) => a.name.toLowerCase() === q) ?? anchors.find((a) => a.name.toLowerCase().includes(q));
  if (!anchor) return null;
  return { name: anchor.name, ...toLatLon(anchor.x, anchor.z), xz: [anchor.x, anchor.z] as [number, number] };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const from = parseLatLon(params.get("from"));
  if (!from) return Response.json({ error: "from=lat,lon is required" }, { status: 400 });
  const origin = request.nextUrl.origin;
  const [field, disruptions] = await Promise.all([
    getJson<FieldResponse | null>(`${origin}/api/twin/field`, null),
    getJson<{ items: AroundDisruption[] }>(
      `${origin}/api/around/disruptions?lat=${ORIGIN.lat}&lon=${ORIGIN.lon}&radius=900`,
      { items: [] },
    ),
  ]);
  if (!field) return Response.json({ error: "Crowd field unavailable" }, { status: 502 });
  const to = resolveTo(params.get("to"), field.anchors);
  if (!to) return Response.json({ error: "to must be a known place or lat,lon" }, { status: 400 });
  const closedLines = (disruptions.items ?? [])
    .filter((d) => /closed/i.test(d.closure))
    .map((d) => d.line.map(([lon, lat]) => toLocal(lat, lon)));
  const graph = buildGraph(field.segments, closedLines);
  const result = planRoutes({
    graph,
    anchors: field.anchors,
    from: { ...from, xz: toLocal(from.lat, from.lon) },
    to,
    at: field.at,
  });
  if ("error" in result) return Response.json(result, { status: 400 });
  const mode = params.get("mode") === "fast" ? "fast" : "calm";
  return Response.json({ ...result, mode });
}

