// The road network: a graph of intersections (nodes) and two-way roads (edges).
// Every vehicle drives on this graph. Blocked edges (crashes, roadworks) are avoided by findPath.
import { BLOCK, GRID_HALF, HIGHWAY_RING, LANE_OFFSET, type ZoneName } from "./config";
import { DISTRICTS } from "./districts";
import { GOV_DELIVERY_NODES } from "./districts/government";

export type RoadKind = "street" | "highway" | "ramp" | "country";

export interface RoadNode {
  id: string;
  x: number;
  z: number;
  zone: ZoneName | "highway";
}

export interface RoadEdge {
  key: string; // undirected key, see edgeKey()
  a: string;
  b: string;
  kind: RoadKind;
  length: number;
  speedLimit: number; // m/s
}

const nodes = new Map<string, RoadNode>();
const edges = new Map<string, RoadEdge>();
const adjacency = new Map<string, string[]>();

export function edgeKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function addNode(id: string, x: number, z: number, zone: RoadNode["zone"]) {
  nodes.set(id, { id, x, z, zone });
  adjacency.set(id, []);
}

const SPEED: Record<RoadKind, number> = { street: 11, highway: 22, ramp: 14, country: 15 };

function addEdge(a: string, b: string, kind: RoadKind) {
  const na = nodes.get(a)!;
  const nb = nodes.get(b)!;
  const key = edgeKey(a, b);
  if (edges.has(key)) return;
  edges.set(key, { key, a, b, kind, length: Math.hypot(na.x - nb.x, na.z - nb.z), speedLimit: SPEED[kind] });
  adjacency.get(a)!.push(b);
  adjacency.get(b)!.push(a);
}

// --- Downtown grid: g_<i>_<j>, i = column (x), j = row (z), both in -GRID_HALF..GRID_HALF
const g = (i: number, j: number) => `g_${i}_${j}`;
for (let i = -GRID_HALF; i <= GRID_HALF; i++)
  for (let j = -GRID_HALF; j <= GRID_HALF; j++) addNode(g(i, j), i * BLOCK, j * BLOCK, "downtown");
for (let i = -GRID_HALF; i <= GRID_HALF; i++)
  for (let j = -GRID_HALF; j <= GRID_HALF; j++) {
    if (i < GRID_HALF) addEdge(g(i, j), g(i + 1, j), "street");
    if (j < GRID_HALF) addEdge(g(i, j), g(i, j + 1), "street");
  }

// --- Highway ring: h_<n>, a square at +-HIGHWAY_RING with a node every 110 m on each side
const R = HIGHWAY_RING;
const ringPts: [number, number][] = [];
for (const x of [-R, -110, 0, 110]) ringPts.push([x, -R]); // north side, west -> east
for (const z of [-R, -110, 0, 110]) ringPts.push([R, z]); // east side, north -> south
for (const x of [R, 110, 0, -110]) ringPts.push([x, R]); // south side, east -> west
for (const z of [R, 110, 0, -110]) ringPts.push([-R, z]); // west side, south -> north
ringPts.forEach(([x, z], n) => addNode(`h_${n}`, x, z, "highway"));
ringPts.forEach((_, n) => addEdge(`h_${n}`, `h_${(n + 1) % ringPts.length}`, "highway"));
const ringAt = (x: number, z: number) => `h_${ringPts.findIndex(([px, pz]) => px === x && pz === z)}`;

// Ramps from the edge of the grid to the ring, at ring nodes -110, 0, 110 on each side
for (const k of [-110, 0, 110]) {
  const gk = Math.round(k / BLOCK); // nearest grid column/row: -3, 0, 3
  addEdge(g(gk, -GRID_HALF), ringAt(k, -R), "ramp"); // north
  addEdge(g(gk, GRID_HALF), ringAt(k, R), "ramp"); // south
  addEdge(g(GRID_HALF, gk), ringAt(R, k), "ramp"); // east
  addEdge(g(-GRID_HALF, gk), ringAt(-R, k), "ramp"); // west
}

// --- Zone roads
// Docks (east): quay road loop
addNode("dock_gate", 260, 0, "docks");
addNode("dock_n", 300, -60, "docks");
addNode("dock_s", 300, 60, "docks");
addNode("dock_quay", 320, 0, "docks");
addEdge(ringAt(R, 0), "dock_gate", "street");
addEdge("dock_gate", "dock_n", "street");
addEdge("dock_gate", "dock_s", "street");
addEdge("dock_n", "dock_quay", "street");
addEdge("dock_s", "dock_quay", "street");

// Countryside (west): winding lanes to farms
addNode("farm_gate", -260, 0, "countryside");
addNode("farm_n", -300, -90, "countryside");
addNode("farm_s", -310, 80, "countryside");
addNode("farm_w", -345, 0, "countryside");
addEdge(ringAt(-R, 0), "farm_gate", "country");
addEdge("farm_gate", "farm_n", "country");
addEdge("farm_gate", "farm_s", "country");
addEdge("farm_n", "farm_w", "country");
addEdge("farm_s", "farm_w", "country");
addEdge(ringAt(-R, -110), "farm_n", "country");

// Depot (south): access road and yard
addNode("depot_gate", 0, 255, "depot");
addNode("depot_yard_w", -40, 300, "depot");
addNode("depot_yard_e", 40, 300, "depot");
addEdge(ringAt(0, R), "depot_gate", "street");
addEdge("depot_gate", "depot_yard_w", "street");
addEdge("depot_gate", "depot_yard_e", "street");
addEdge("depot_yard_w", "depot_yard_e", "street");

// Suburbs (north): a small 3x2 grid of streets
const s = (i: number, j: number) => `sub_${i}_${j}`;
for (let i = -1; i <= 1; i++) for (let j = 0; j <= 1; j++) addNode(s(i, j), i * 60, -260 - j * 60, "suburbs");
for (let i = -1; i <= 1; i++) {
  addEdge(s(i, 0), s(i, 1), "street");
  if (i < 1) {
    addEdge(s(i, 0), s(i + 1, 0), "street");
    addEdge(s(i, 1), s(i + 1, 1), "street");
  }
}
addEdge(ringAt(0, -R), s(0, 0), "street");
addEdge(ringAt(-110, -R), s(-1, 0), "street");
addEdge(ringAt(110, -R), s(1, 0), "street");

// Airport (north-west): access road from the ring's NW corner to the terminal and the cargo sheds
addNode("airport_gate", -260, -260, "airport");
addNode("airport_terminal", -300, -290, "airport");
addNode("airport_cargo", -260, -330, "airport");
addEdge(ringAt(-R, -R), "airport_gate", "street");
addEdge("airport_gate", "airport_terminal", "street");
addEdge("airport_gate", "airport_cargo", "street");
addEdge("airport_terminal", "airport_cargo", "street");

// --- Layer 2 districts (districts/*.ts), merged in order. Bad data is reported, never crashes the city.
for (const [name, d] of Object.entries(DISTRICTS)) {
  for (const n of d.nodes) if (!nodes.has(n.id)) addNode(n.id, n.x, n.z, n.zone);
  for (const e of d.edges) {
    if (!nodes.has(e.a) || !nodes.has(e.b)) {
      console.warn(`[roads] district ${name}: edge ${e.a} -> ${e.b} references an unknown node, skipped`);
      continue;
    }
    addEdge(e.a, e.b, e.kind);
  }
}

// --- Public API -------------------------------------------------------------

export const ROAD_NODES: ReadonlyMap<string, RoadNode> = nodes;
export const ROAD_EDGES: ReadonlyMap<string, RoadEdge> = edges;

export function getNode(id: string) {
  const n = nodes.get(id);
  if (!n) throw new Error(`unknown road node ${id}`);
  return n;
}

export function getEdge(a: string, b: string) {
  return edges.get(edgeKey(a, b));
}

export function neighbours(id: string): readonly string[] {
  return adjacency.get(id) ?? [];
}

/** Named places other modules drive to. */
export const PLACES = {
  depot: "depot_yard_w",
  depotBays: ["depot_yard_w", "depot_yard_e"],
  docks: "dock_quay",
  farm: "farm_w",
  policeStation: g(-3, 3),
  hospital: g(3, -3),
  maintenanceYard: g(-4, -4),
  downtownCentre: g(0, 0),
  airport: "airport_terminal",
  airCargo: "airport_cargo",
} as const;

/** Delivery stops: every suburb node plus a spread of downtown intersections. */
export const DELIVERY_STOPS: readonly string[] = [
  ...[...nodes.values()].filter((n) => n.zone === "suburbs").map((n) => n.id),
  g(-2, -2), g(2, -1), g(1, 2), g(-3, 1), g(3, 3), g(0, -3), "farm_n", "farm_s", "dock_n", "airport_cargo",
  // Government quarter mailrooms (secure deliveries; where tricky cases happen).
  ...GOV_DELIVERY_NODES.filter((id) => nodes.has(id)),
];

/**
 * A* shortest path by travel time, avoiding blocked edge keys.
 * Returns the list of node ids from `from` to `to` (inclusive), or null if unreachable.
 */
export function findPath(from: string, to: string, blocked: ReadonlySet<string> = new Set()): string[] | null {
  if (from === to) return [from];
  const target = getNode(to);
  const h = (id: string) => {
    const n = nodes.get(id)!;
    return Math.hypot(n.x - target.x, n.z - target.z) / SPEED.highway;
  };
  const open = new Set([from]);
  const came = new Map<string, string>();
  const gScore = new Map<string, number>([[from, 0]]);
  const fScore = new Map<string, number>([[from, h(from)]]);
  while (open.size) {
    let cur = "";
    let best = Infinity;
    for (const id of open) {
      const f = fScore.get(id) ?? Infinity;
      if (f < best) {
        best = f;
        cur = id;
      }
    }
    if (cur === to) {
      const path = [cur];
      while (came.has(cur)) {
        cur = came.get(cur)!;
        path.unshift(cur);
      }
      return path;
    }
    open.delete(cur);
    for (const nb of neighbours(cur)) {
      const e = getEdge(cur, nb)!;
      if (blocked.has(e.key)) continue;
      const tentative = (gScore.get(cur) ?? Infinity) + e.length / e.speedLimit;
      if (tentative < (gScore.get(nb) ?? Infinity)) {
        came.set(nb, cur);
        gScore.set(nb, tentative);
        fScore.set(nb, tentative + h(nb));
        open.add(nb);
      }
    }
  }
  return null;
}

/** Random node id, optionally limited to one zone. `rand` defaults to Math.random. */
export function randomNode(zone?: RoadNode["zone"], rand: () => number = Math.random) {
  const pool = [...nodes.values()].filter((n) => !zone || n.zone === zone);
  return pool[Math.floor(rand() * pool.length)].id;
}

/**
 * World position of a vehicle travelling from node a to node b, `t` in 0..1 along the edge,
 * shifted onto the LEFT-hand lane (we're in London: drive on the left). Returns [x, z, headingRadians] (heading: rotation about y,
 * 0 = facing +z, use it as mesh.rotation.y).
 */
export function lanePosition(a: string, b: string, t: number): [number, number, number] {
  const na = getNode(a);
  const nb = getNode(b);
  const dx = nb.x - na.x;
  const dz = nb.z - na.z;
  const len = Math.hypot(dx, dz) || 1;
  // right-hand vector of the direction of travel in three.js (y up) is (-dz, dx); subtract it to keep left
  const rx = -dz / len;
  const rz = dx / len;
  const x = na.x + dx * t - rx * LANE_OFFSET;
  const z = na.z + dz * t - rz * LANE_OFFSET;
  return [x, z, Math.atan2(dx, dz)];
}

/** Midpoint of an edge (on the centre line), handy for placing incidents. */
export function edgeMidpoint(key: string): [number, number] {
  const e = edges.get(key)!;
  const a = getNode(e.a);
  const b = getNode(e.b);
  return [(a.x + b.x) / 2, (a.z + b.z) / 2];
}
