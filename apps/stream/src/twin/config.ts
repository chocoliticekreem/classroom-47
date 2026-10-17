/**
 * Shared contract for the 3D twin (/twin). Every module imports this; change it rarely.
 * Units are metres, y is up, ground y = 0. +x is east, +z is south (so north is -z).
 */

/** World origin: Tower Hill. Everything is placed relative to this point. */
export const ORIGIN = { lat: 51.5098, lon: -0.0766 } as const;

/** Radius of the core mirrored area around Tower Hill, in metres (live feeds, fog and camera framing are tuned to it). */
export const WORLD_RADIUS_M = 650;

/** Rectangle of real OSM geometry loaded around the origin, in local metres. Reaches south-west past Bankside / Halkin. */
export const GEOMETRY_BOUNDS = { xMin: -1100, xMax: 650, zMin: -650, zMax: 1100 } as const;

export const insideGeometryBounds = (x: number, z: number) =>
  x >= GEOMETRY_BOUNDS.xMin && x <= GEOMETRY_BOUNDS.xMax && z >= GEOMETRY_BOUNDS.zMin && z <= GEOMETRY_BOUNDS.zMax;

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
  buildings: {
    ring: Ring;
    height: number;
    minHeight: number;
    /** OSM/OpenMapTiles building colour, if tagged (CSS colour string). */
    colour?: string;
  }[];
  roads: {
    line: Ring;
    kind: "major" | "minor" | "path" | "rail";
    name?: string;
    bridge?: boolean;
    tunnel?: boolean;
    oneway?: boolean;
  }[];
  water: Ring[];
  parks: Ring[];
  /** Footfall anchors from the OSM poi layer: stations, stops, attractions, shops, food. */
  pois: TwinPoi[];
  /** Rail / tube / DLR / overground stations from the tiles' POI layer, in local metres. */
  stations: { pos: [number, number]; name: string; kind: "rail" | "subway" | "light_rail" }[];
}

export interface TwinPoi {
  name: string;
  x: number;
  z: number;
  kind: "station" | "bus_stop" | "attraction" | "shop" | "food";
}
