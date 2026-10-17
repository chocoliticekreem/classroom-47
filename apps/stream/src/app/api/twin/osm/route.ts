import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { ORIGIN, toLocal, WORLD_RADIUS_M, type Ring, type TwinGeometry } from "@/twin/config";

const TILEJSON = "https://tiles.openfreemap.org/planet";
const ZOOM = 14;

let cache: TwinGeometry | null = null;

function tileXY(lat: number, lon: number, z: number) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x, y };
}

function tilesAround(radiusM: number) {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180));
  const a = tileXY(ORIGIN.lat + dLat, ORIGIN.lon - dLon, ZOOM);
  const b = tileXY(ORIGIN.lat - dLat, ORIGIN.lon + dLon, ZOOM);
  const out: { x: number; y: number }[] = [];
  for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) out.push({ x, y });
  return out;
}

const inRange = (ring: Ring) =>
  ring.some(([x, z]) => Math.abs(x) <= WORLD_RADIUS_M && Math.abs(z) <= WORLD_RADIUS_M);

function roadKind(cls: string): TwinGeometry["roads"][number]["kind"] | null {
  if (["motorway", "trunk", "primary", "secondary"].includes(cls)) return "major";
  if (["tertiary", "minor", "service", "street"].includes(cls)) return "minor";
  if (["path", "track", "pedestrian"].includes(cls)) return "path";
  if (cls === "rail" || cls === "transit") return "rail";
  return null;
}

async function loadTile(template: string, x: number, y: number, out: TwinGeometry) {
  const res = await fetch(template.replace("{z}", String(ZOOM)).replace("{x}", String(x)).replace("{y}", String(y)));
  if (!res.ok) throw new Error(`tile ${x}/${y} failed: HTTP ${res.status}`);
  const tile = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())));
  const rings = (layer: string, i: number) =>
    tile.layers[layer]
      .feature(i)
      .toGeoJSON(x, y, ZOOM)
      .geometry;
  const toRings = (g: GeoJSON.Geometry): Ring[] => {
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    // Outer rings only: courtyards are rare at this scale and holes cost a triangulation pass.
    return polys.map((p) => p[0].map(([lon, lat]) => toLocal(lat, lon)));
  };
  const toLines = (g: GeoJSON.Geometry): Ring[] => {
    const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
    return lines.map((l) => l.map(([lon, lat]) => toLocal(lat, lon)));
  };

  const b = tile.layers.building;
  for (let i = 0; b && i < b.length; i++) {
    const props = b.feature(i).properties;
    const height = Number(props.render_height ?? 10);
    const minHeight = Number(props.render_min_height ?? 0);
    for (const ring of toRings(rings("building", i))) if (inRange(ring)) out.buildings.push({ ring, height, minHeight });
  }
  const t = tile.layers.transportation;
  for (let i = 0; t && i < t.length; i++) {
    const kind = roadKind(String(t.feature(i).properties.class ?? ""));
    if (!kind) continue;
    for (const line of toLines(rings("transportation", i))) if (inRange(line)) out.roads.push({ line, kind });
  }
  const w = tile.layers.water;
  for (let i = 0; w && i < w.length; i++) for (const ring of toRings(rings("water", i))) out.water.push(ring);
  const p = tile.layers.park;
  for (let i = 0; p && i < p.length; i++) for (const ring of toRings(rings("park", i))) if (inRange(ring)) out.parks.push(ring);
}

export async function GET() {
  if (cache) return Response.json(cache);
  try {
    const { tiles } = (await (await fetch(TILEJSON)).json()) as { tiles: string[] };
    const out: TwinGeometry = { buildings: [], roads: [], water: [], parks: [] };
    await Promise.all(tilesAround(WORLD_RADIUS_M).map(({ x, y }) => loadTile(tiles[0], x, y, out)));
    cache = out;
    return Response.json(out);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
