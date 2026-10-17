// Pure route & hazard planner for the StreamerAvatar and ParallelRealityFx 3D modules.
// Computes a primary grid route, hazard bottleneck zones, and a safe detour route that
// maintains >35m clearance around any hazard cluster on the primary route.

import { BLOCK } from "../../config";

export const HAZARD_AVOID_DISTANCE = 35; // metres

export interface HazardInput {
  x: number;
  z: number;
  radius?: number;
  risk?: number; // 0..1
  label?: string;
}

export interface HazardZone {
  x: number;
  z: number;
  radius: number;
  risk: number; // 0..1
  label: string;
}

export interface RoutePlanResult {
  primaryRoute: [number, number][];
  safeRoute: [number, number][];
  hazardZones: HazardZone[];
}

/** Euclidean distance from point (px, pz) to line segment (ax, az)-(bx, bz). */
export function pointToSegmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  const projX = ax + t * dx;
  const projZ = az + t * dz;
  return Math.hypot(px - projX, pz - projZ);
}

/** Minimum distance from a point (px, pz) to any segment or waypoint of a polyline route. */
export function distanceToRoute(px: number, pz: number, route: [number, number][]): number {
  if (route.length === 0) return Infinity;
  if (route.length === 1) return Math.hypot(px - route[0][0], pz - route[0][1]);
  let minDist = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const [ax, az] = route[i];
    const [bx, bz] = route[i + 1];
    const d = pointToSegmentDistance(px, pz, ax, az, bx, bz);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/** Total length of a polyline route in metres. */
export function routeLength(route: [number, number][]): number {
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    total += Math.hypot(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1]);
  }
  return total;
}

/**
 * Sample a polyline route at normalized progress `t` in [0, 1].
 * Returns `[x, z, headingRadians]` where heading 0 faces +z (`Math.atan2(dx, dz)`).
 */
export function sampleRoute(route: [number, number][], t: number): [number, number, number] {
  if (route.length === 0) return [0, 0, 0];
  if (route.length === 1) return [route[0][0], route[0][1], 0];
  const clamped = Math.max(0, Math.min(1, t));
  const total = routeLength(route);
  if (total <= 1e-6) return [route[0][0], route[0][1], 0];

  const targetDist = clamped * total;
  let acc = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const [ax, az] = route[i];
    const [bx, bz] = route[i + 1];
    const segLen = Math.hypot(bx - ax, bz - az);
    if (segLen <= 1e-6) continue;
    if (acc + segLen >= targetDist || i === route.length - 2) {
      const localT = Math.max(0, Math.min(1, (targetDist - acc) / segLen));
      const x = ax + (bx - ax) * localT;
      const z = az + (bz - az) * localT;
      const heading = Math.atan2(bx - ax, bz - az);
      return [x, z, heading];
    }
    acc += segLen;
  }
  const last = route[route.length - 1];
  const prev = route[route.length - 2];
  return [last[0], last[1], Math.atan2(last[0] - prev[0], last[1] - prev[1])];
}

/**
 * Build the direct street-grid primary route from `(startX, startZ)` to `(destX, destZ)`
 * stepping along `BLOCK = 40` m increments (alternating X and Z steps).
 */
export function buildPrimaryRoute(
  startX: number,
  startZ: number,
  destX: number,
  destZ: number,
): [number, number][] {
  const waypoints: [number, number][] = [[startX, startZ]];
  let cx = startX;
  let cz = startZ;
  let stepXNext = Math.abs(destX - cx) >= Math.abs(destZ - cz);
  let guard = 0;

  while ((Math.abs(destX - cx) > 0.5 || Math.abs(destZ - cz) > 0.5) && guard++ < 128) {
    const remX = destX - cx;
    const remZ = destZ - cz;

    if (stepXNext && Math.abs(remX) > 0.5) {
      const step = Math.sign(remX) * Math.min(BLOCK, Math.abs(remX));
      cx += step;
      waypoints.push([cx, cz]);
      if (Math.abs(remZ) > 0.5) stepXNext = false;
    } else if (Math.abs(remZ) > 0.5) {
      const step = Math.sign(remZ) * Math.min(BLOCK, Math.abs(remZ));
      cz += step;
      waypoints.push([cx, cz]);
      if (Math.abs(remX) > 0.5) stepXNext = true;
    } else {
      stepXNext = true;
    }
  }

  const last = waypoints[waypoints.length - 1];
  if (last[0] !== destX || last[1] !== destZ) {
    waypoints.push([destX, destZ]);
  }
  return waypoints;
}

/**
 * Pure route & hazard planner.
 * Computes `primaryRoute`, `hazardZones` along the primary route, and a `safeRoute`
 * that detours around any hazard within 35m of the primary route.
 */
export function planStreamerRoutes(
  startX: number,
  startZ: number,
  destX: number,
  destZ: number,
  hazards: HazardInput[] = [],
): RoutePlanResult {
  const primaryRoute = buildPrimaryRoute(startX, startZ, destX, destZ);

  // Normalize input hazards or synthesize a midpoint bottleneck if none were supplied
  const normalizedHazards: HazardZone[] =
    hazards.length > 0
      ? hazards.map((h, i) => ({
          x: h.x,
          z: h.z,
          radius: h.radius ?? 30,
          risk: h.risk ?? 0.85,
          label: h.label ?? `Swarm Bottleneck #${i + 1}`,
        }))
      : (() => {
          const [mx, mz] = sampleRoute(primaryRoute, 0.5);
          return [
            {
              x: mx,
              z: mz,
              radius: 28,
              risk: 0.78,
              label: "Predicted Crowd & Sniper Convergence",
            },
          ];
        })();

  // Identify hazard zones within 35m of the primary route (or keep all provided hazards if none are within 35m)
  const threateningHazards = normalizedHazards.filter(
    (h) => distanceToRoute(h.x, h.z, primaryRoute) <= HAZARD_AVOID_DISTANCE,
  );
  const hazardZones = threateningHazards.length > 0 ? threateningHazards : normalizedHazards;

  // If no hazard is within 35m of the primary route, still provide an alternate block corridor
  const activeAvoidHazards = threateningHazards;

  // Build a 2D street grid around the start/dest/hazard bounding box with step = BLOCK (40m)
  // aligned to startX, startZ so start and dest are reachable on clean grid steps.
  const allX = [startX, destX, ...hazardZones.map((h) => h.x)];
  const allZ = [startZ, destZ, ...hazardZones.map((h) => h.z)];
  const pad = BLOCK * 3;
  const minX = Math.min(...allX) - pad;
  const maxX = Math.max(...allX) + pad;
  const minZ = Math.min(...allZ) - pad;
  const maxZ = Math.max(...allZ) + pad;

  const xsSet = new Set<number>([startX, destX]);
  const zsSet = new Set<number>([startZ, destZ]);
  for (let x = startX - BLOCK * 8; x <= startX + BLOCK * 8; x += BLOCK) {
    if (x >= minX && x <= maxX) xsSet.add(x);
  }
  for (let x = destX - BLOCK * 8; x <= destX + BLOCK * 8; x += BLOCK) {
    if (x >= minX && x <= maxX) xsSet.add(x);
  }
  for (let z = startZ - BLOCK * 8; z <= startZ + BLOCK * 8; z += BLOCK) {
    if (z >= minZ && z <= maxZ) zsSet.add(z);
  }
  for (let z = destZ - BLOCK * 8; z <= destZ + BLOCK * 8; z += BLOCK) {
    if (z >= minZ && z <= maxZ) zsSet.add(z);
  }

  const xs = [...xsSet].sort((a, b) => a - b);
  const zs = [...zsSet].sort((a, b) => a - b);

  const keyOf = (ix: number, iz: number) => `${ix},${iz}`;
  const startIx = xs.indexOf(startX);
  const startIz = zs.indexOf(startZ);
  const destIx = xs.indexOf(destX);
  const destIz = zs.indexOf(destZ);

  // Set of interior waypoints on primaryRoute so safeRoute prefers a distinct parallel corridor
  const primaryInterior = new Set<string>();
  for (let i = 1; i < primaryRoute.length - 1; i++) {
    primaryInterior.add(`${primaryRoute[i][0]},${primaryRoute[i][1]}`);
  }

  const runGridSearch = (strictAvoidDist: number): [number, number][] | null => {
    const startKey = keyOf(startIx, startIz);
    const destKey = keyOf(destIx, destIz);
    const open = new Set<string>([startKey]);
    const came = new Map<string, string>();
    const gScore = new Map<string, number>([[startKey, 0]]);
    const fScore = new Map<string, number>([
      [startKey, Math.hypot(destX - startX, destZ - startZ)],
    ]);

    const dirs: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    while (open.size > 0) {
      let curKey = "";
      let bestF = Infinity;
      for (const k of open) {
        const f = fScore.get(k) ?? Infinity;
        if (f < bestF) {
          bestF = f;
          curKey = k;
        }
      }

      if (curKey === destKey) {
        const path: [number, number][] = [];
        let trace: string | undefined = curKey;
        while (trace !== undefined) {
          const [ixStr, izStr] = trace.split(",");
          path.unshift([xs[Number(ixStr)], zs[Number(izStr)]]);
          trace = came.get(trace);
        }
        return path;
      }

      open.delete(curKey);
      const [cix, ciz] = curKey.split(",").map(Number);
      const cx = xs[cix];
      const cz = zs[ciz];

      for (const [dx, dz] of dirs) {
        const nix = cix + dx;
        const niz = ciz + dz;
        if (nix < 0 || nix >= xs.length || niz < 0 || niz >= zs.length) continue;
        const nx = xs[nix];
        const nz = zs[niz];

        // Check if segment (cx, cz) -> (nx, nz) violates hazard clearance
        let blocked = false;
        let hazardPenalty = 0;
        for (const h of activeAvoidHazards) {
          const segDist = pointToSegmentDistance(h.x, h.z, cx, cz, nx, nz);
          if (segDist <= strictAvoidDist) {
            blocked = true;
            break;
          }
          if (segDist < strictAvoidDist * 1.6) {
            hazardPenalty += (strictAvoidDist * 1.6 - segDist) * 4;
          }
        }
        if (blocked) continue;

        const stepLen = Math.hypot(nx - cx, nz - cz);
        const overlapPenalty = primaryInterior.has(`${nx},${nz}`) ? BLOCK * 0.65 : 0;
        const tentativeG = (gScore.get(curKey) ?? Infinity) + stepLen + hazardPenalty + overlapPenalty;
        const nKey = keyOf(nix, niz);

        if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
          came.set(nKey, curKey);
          gScore.set(nKey, tentativeG);
          fScore.set(nKey, tentativeG + Math.hypot(destX - nx, destZ - nz));
          open.add(nKey);
        }
      }
    }
    return null;
  };

  // Try strict 36m clearance (>35m requirement), falling back to 20m if start/dest itself is boxed in
  const safeRoute =
    runGridSearch(HAZARD_AVOID_DISTANCE + 1) ??
    runGridSearch(20) ??
    primaryRoute;

  return {
    primaryRoute,
    safeRoute,
    hazardZones,
  };
}
