// Pure planning helpers for the Hamyway fleet: stop selection, depot bays, ids, road names, victim picking.
import { DELIVERY_STOPS, PLACES, ROAD_EDGES, getNode } from "../../roads";
import type { Pose } from "./route";

/** Pick `count` distinct stops from `pool` and order them as a greedy nearest-neighbour tour from `start`. */
export function planStops(
  count: number,
  rand: () => number = Math.random,
  pool: readonly string[] = DELIVERY_STOPS,
  start: string = PLACES.depot,
): string[] {
  const avail = [...new Set(pool)];
  const picked: string[] = [];
  while (picked.length < count && avail.length) picked.push(avail.splice(Math.floor(rand() * avail.length), 1)[0]);
  const out: string[] = [];
  let cur = getNode(start);
  while (picked.length) {
    let best = 0;
    let bestD = Infinity;
    picked.forEach((id, i) => {
      const n = getNode(id);
      const d = Math.hypot(n.x - cur.x, n.z - cur.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const [id] = picked.splice(best, 1);
    out.push(id);
    cur = getNode(id);
  }
  return out;
}

/** Sequential id generator: makeIdGen("DL-", 1001)() -> "DL-1001", "DL-1002", ... */
export function makeIdGen(prefix: string, start: number, pad = 0) {
  let n = start;
  return () => `${prefix}${String(n++).padStart(pad, "0")}`;
}

// --- Depot bays ----------------------------------------------------------------
// Vehicles park off the yard road (depot_yard_w <-> depot_yard_e at z = 300), pulled 5 m to the left
// of their lane: a north row facing east (entered from depot_yard_w) and a south row facing west.

export interface Bay {
  index: number;
  row: "north" | "south";
  entry: string; // node the lane starts at
  exit: string; // node the lane runs to
  along: number; // metres along entry->exit level with the bay
  pose: Pose;
}

const [BAY_W, BAY_E] = PLACES.depotBays;

function makeBays(): Bay[] {
  const w = getNode(BAY_W);
  const e = getNode(BAY_E);
  const zc = (w.z + e.z) / 2;
  const bays: Bay[] = [];
  // north row (lane west->east sits 2 m north of the centre line; bay 5 m further north)
  for (const x of [-25, -15, -5, 5, 15, 25])
    bays.push({ index: bays.length, row: "north", entry: BAY_W, exit: BAY_E, along: x - w.x, pose: { x, z: zc - 7, heading: Math.PI / 2 } });
  // south row (lane east->west, 2 m south of centre; bay 5 m further south)
  for (const x of [35, 25, 15, 5, -5, -15, -25, -35])
    bays.push({ index: bays.length, row: "south", entry: BAY_E, exit: BAY_W, along: e.x - x, pose: { x, z: zc + 7, heading: -Math.PI / 2 } });
  return bays;
}

export const BAYS: readonly Bay[] = makeBays();

// --- Road names (for incident notes) ---------------------------------------------

const ROWS = ["Euston Rd", "Oxford St", "Holborn", "the Strand", "King St", "Fleet St", "Cheapside", "Cannon St", "Borough High St"];
const COLS = ["Edgware Rd", "Baker St", "Regent St", "Charing Cross Rd", "Kingsway", "Chancery Ln", "Farringdon Rd", "Bishopsgate", "Tower Bridge Rd"];
const SUBURB = ["Acacia Ave", "Elm Grove", "Laburnum Way", "Rosebery Rd", "Mulberry Close", "Hawthorn Rise", "Cedar Walk"];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** A London-ish name for a road, stable per edge. */
export function roadName(edgeKey: string): string {
  const e = ROAD_EDGES.get(edgeKey);
  if (!e) return "an unnamed road";
  const a = getNode(e.a);
  const b = getNode(e.b);
  if (e.kind === "highway") return "the North Circular";
  if (e.kind === "ramp") return "the North Circular slip road";
  if (a.zone === "downtown" && b.zone === "downtown") {
    if (a.z === b.z) return ROWS[Math.round(a.z / 40) + 4] ?? "King St";
    return COLS[Math.round(a.x / 40) + 4] ?? "Baker St";
  }
  const zone = a.zone !== "highway" ? a.zone : b.zone;
  if (zone === "docks") return "Quay Rd";
  if (zone === "countryside") return "Mill Lane";
  if (zone === "depot") return "Depot Rd";
  if (zone === "suburbs") return SUBURB[hash(edgeKey) % SUBURB.length];
  return "the high street";
}

// --- Breakdown victim ------------------------------------------------------------

export interface VictimCandidate {
  id: string;
  parcels: number;
  eligible: boolean; // en route, on a straight bit of lane
}

/** Pick an eligible van, preferring ones with >= 3 parcels on board. */
export function pickBreakdownVictim<T extends VictimCandidate>(cands: readonly T[], rand: () => number = Math.random): T | null {
  const ok = cands.filter((c) => c.eligible && c.parcels > 0);
  const rich = ok.filter((c) => c.parcels >= 3);
  const pool = rich.length ? rich : ok;
  return pool.length ? pool[Math.floor(rand() * pool.length)] : null;
}

/** Rough ETA in seconds: metres to go at a typical urban speed plus dwell time per earlier stop. */
export function etaSeconds(metres: number, stopsBefore: number, speed = 8, dwellS = 3) {
  return Math.round(metres / speed + stopsBefore * dwellS);
}
