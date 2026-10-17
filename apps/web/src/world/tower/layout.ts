// Tower Bridge patch. Metres, x east, z south, y up. Origin is the bascule centre.
import patch from "./patch.json";

type XZ = [number, number];

export const PATCH = patch.bounds;

export const RIVER = {
  halfWidth: patch.river.halfWidth,
  centerline: patch.river.centerline as XZ[],
};

const bridgePoints = patch.bridge as XZ[];

export const BRIDGE = {
  points: bridgePoints,
  northEnd: bridgePoints[0] as XZ,
  southEnd: bridgePoints[bridgePoints.length - 1] as XZ,
  towers: {
    north: patch.towers.north as XZ,
    south: patch.towers.south as XZ,
    height: patch.towers.height,
  },
};

export const ROADS = {
  towerBridgeApproach: {
    name: "Tower Bridge Approach",
    a100: "north" as const,
    points: patch.roads.towerBridgeApproach as XZ[],
  },
  towerBridgeRoad: {
    name: "Tower Bridge Road",
    a100: "south" as const,
    points: patch.roads.towerBridgeRoad as XZ[],
  },
  tooleyStreet: {
    name: "Tooley Street",
    points: patch.roads.tooleyStreet as XZ[],
  },
  druidStreet: {
    name: "Druid Street",
    points: patch.roads.druidStreet as XZ[],
  },
};

export const CAMERAS = patch.cameras;
export const STREAMER = patch.streamer;
export const ACCIDENT = patch.accident;
export const DESTINATION = patch.destination;
export const DETOUR_POINT = patch.detourPoint as XZ;
export const JUNCTION = patch.junction as XZ;
export const CROSSWALK = patch.crosswalk;

export const ACTIVE_ZONES = [
  "thames",
  "tower-bridge",
  "tower-bridge-approach",
  "tower-bridge-road",
  "tooley-street",
  "druid-street",
] as const;

const { lat: originLat, lon: originLon } = patch.origin;
const metersPerDegLat = patch.metersPerDegLat;
const metersPerDegLon = patch.metersPerDegLon;

export function project(lat: number, lon: number): { x: number; z: number } {
  return {
    x: (lon - originLon) * metersPerDegLon,
    z: (originLat - lat) * metersPerDegLat,
  };
}

export function insidePatch(x: number, z: number): boolean {
  return x >= PATCH.minX && x <= PATCH.maxX && z >= PATCH.minZ && z <= PATCH.maxZ;
}

function rawSigned(x: number, z: number): number {
  const line = RIVER.centerline;
  let best = 0;
  let bestAbs = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i]!;
    const [bx, bz] = line[i + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    const qx = ax + t * dx;
    const qz = az + t * dz;
    const cross = dx * (z - az) - dz * (x - ax);
    const dist = Math.hypot(x - qx, z - qz) * (cross >= 0 ? 1 : -1);
    const abs = Math.abs(dist);
    if (abs < bestAbs) {
      bestAbs = abs;
      best = dist;
    }
  }
  return best;
}

/** Negative on the same side of the Thames as the north abutment. */
const NORTH_FLIP = rawSigned(BRIDGE.northEnd[0], BRIDGE.northEnd[1]) >= 0 ? -1 : 1;

export function signedRiverDistance(x: number, z: number): number {
  return rawSigned(x, z) * NORTH_FLIP;
}

export function bankOf(x: number, z: number): "north" | "south" | "water" {
  const signed = signedRiverDistance(x, z);
  if (Math.abs(signed) < RIVER.halfWidth) return "water";
  return signed < 0 ? "north" : "south";
}

export function onCrosswalk(x: number, z: number): boolean {
  return Math.hypot(x - CROSSWALK.x, z - CROSSWALK.z) <= CROSSWALK.halfLength + 2;
}

export function distanceToPolyline(x: number, z: number, route: readonly XZ[]): number {
  if (route.length === 0) return Infinity;
  if (route.length === 1) return Math.hypot(x - route[0]![0], z - route[0]![1]);
  let best = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const [ax, az] = route[i]!;
    const [bx, bz] = route[i + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    if (d < best) best = d;
  }
  return best;
}

export function planRoutes(): { primary: XZ[]; detour: XZ[]; blocked: true } {
  const south = BRIDGE.southEnd;
  const start: XZ = [STREAMER.x, STREAMER.z];
  return {
    blocked: true,
    primary: [start, south, JUNCTION, [ACCIDENT.x, ACCIDENT.z], [DESTINATION.x, DESTINATION.z]],
    detour: [start, south, JUNCTION, DETOUR_POINT],
  };
}
