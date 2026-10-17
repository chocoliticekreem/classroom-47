/**
 * Shared contract for the 3D twin (/twin). Every module imports this; change it rarely.
 * Units are metres, y is up, ground y = 0. +x is east, +z is south (so north is -z).
 */

/** World origin: Tower Hill. Everything is placed relative to this point. */
export const ORIGIN = { lat: 51.5098, lon: -0.0766 } as const;

/** How far from the origin the twin loads real geometry, in metres. */
export const WORLD_RADIUS_M = 650;

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** lat/lon → local [x, z] metres. */
export function toLocal(lat: number, lon: number): [number, number] {
  return [(lon - ORIGIN.lon) * M_PER_DEG_LON, -(lat - ORIGIN.lat) * M_PER_DEG_LAT];
}

/** local [x, z] metres → lat/lon. */
export function toLatLon(x: number, z: number): { lat: number; lon: number } {
  return { lat: ORIGIN.lat - z / M_PER_DEG_LAT, lon: ORIGIN.lon + x / M_PER_DEG_LON };
}

export type Ring = [number, number][];

/** Real OpenStreetMap geometry around the origin, already in local metres (from /api/twin/osm). */
export interface TwinGeometry {
  buildings: { ring: Ring; height: number; minHeight: number }[];
  roads: { line: Ring; kind: "major" | "minor" | "path" | "rail" }[];
  water: Ring[];
  parks: Ring[];
}
