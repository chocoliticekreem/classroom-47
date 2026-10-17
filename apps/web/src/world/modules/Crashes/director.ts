// Pure crash-director logic: picking victims, picking scripted spots, naming roads, writing notes.
import { BLOCK } from "../../config";
import { edgeKey, getNode, neighbours, ROAD_EDGES } from "../../roads";
import { signalFor } from "../../signals";
import type { VehicleKind } from "../../registry";

export type CrashKind = "car_crash" | "truck_crash" | "pileup";
export type Scenario = "rear_end" | "solo" | "junction" | "shunt" | "sideswipe" | "rollover" | "jackknife" | "pileup";

export interface Candidate {
  id: string;
  kind: VehicleKind;
  edgeKey: string | null;
  from: string | null;
  to: string | null;
  t: number;
  speed: number;
  stopped: boolean;
}

const CIVIL: ReadonlySet<VehicleKind> = new Set<VehicleKind>(["car", "taxi", "truck", "van"]);
const MAX_GAP_M = 14;
const MIN_SPEED = 1.5;

interface Opts {
  blocked: ReadonlySet<string>;
  kind?: CrashKind; // undefined: anything goes
}

function eligible(c: Candidate, o: Opts) {
  if (!CIVIL.has(c.kind) || c.stopped || c.speed < MIN_SPEED) return false;
  if (!c.from || !c.to || !c.edgeKey || o.blocked.has(c.edgeKey)) return false;
  if (o.kind === "car_crash" && c.kind === "truck") return false;
  return true;
}

function edgeLen(key: string) {
  return ROAD_EDGES.get(key)?.length ?? BLOCK;
}

/** Two moving vehicles on the same directed lane within MAX_GAP_M: returns [rear, front] or null. */
export function findRearEnd<T extends Candidate>(list: Iterable<T>, o: Opts): [T, T] | null {
  const ok: T[] = [];
  for (const c of list) if (eligible(c, o)) ok.push(c);
  let best: [T, T] | null = null;
  let bestGap = Infinity;
  for (let i = 0; i < ok.length; i++)
    for (let j = 0; j < ok.length; j++) {
      const a = ok[i];
      const b = ok[j];
      if (i === j || a.from !== b.from || a.to !== b.to || b.t <= a.t) continue;
      if (o.kind === "truck_crash" && a.kind !== "truck" && b.kind !== "truck") continue;
      const gap = (b.t - a.t) * edgeLen(a.edgeKey!);
      if (gap <= MAX_GAP_M && gap < bestGap) {
        bestGap = gap;
        best = [a, b];
      }
    }
  return best;
}

/** One moving eligible vehicle (a truck for truck_crash), random among the candidates. */
export function findSolo<T extends Candidate>(list: Iterable<T>, o: Opts, rand: () => number = Math.random): T | null {
  const ok: T[] = [];
  for (const c of list) if (eligible(c, o) && (o.kind !== "truck_crash" || c.kind === "truck")) ok.push(c);
  return ok.length ? ok[Math.floor(rand() * ok.length)] : null;
}

/** A random downtown street or highway edge for a scripted wreck. */
export function pickScriptedEdge(rand: () => number, blocked: ReadonlySet<string>, exclude: ReadonlySet<string>): string | null {
  const pool: string[] = [];
  for (const e of ROAD_EDGES.values())
    if ((e.kind === "street" || e.kind === "highway") && !blocked.has(e.key) && !exclude.has(e.key)) {
      if (e.kind === "street" && getNode(e.a).zone !== "downtown") continue;
      pool.push(e.key);
    }
  return pool.length ? pool[Math.floor(rand() * pool.length)] : null;
}

// --- Naming -----------------------------------------------------------------

// Columns (roads running north-south at x = i*40) and rows (east-west at z = j*40), i/j in -4..4.
const COLUMNS = ["Edgware Rd", "Baker St", "Gower St", "Kingsway", "Charing Cross Rd", "Bond St", "Regent St", "Bishopsgate", "Tower Bridge Rd"];
const ROWS = ["Euston Rd", "Oxford St", "Holborn", "Fleet St", "the Strand", "Piccadilly", "Pall Mall", "Victoria St", "the Embankment"];

export function roadName(key: string): string {
  const e = ROAD_EDGES.get(key);
  if (!e) return "a side street";
  if (e.kind === "highway") return "the A-Ring";
  if (e.kind === "ramp") return "the A-Ring slip road";
  const a = getNode(e.a);
  const b = getNode(e.b);
  if (a.zone === "downtown" && b.zone === "downtown") {
    if (a.z === b.z) return ROWS[Math.round(a.z / BLOCK) + 4] ?? "the high street";
    return COLUMNS[Math.round(a.x / BLOCK) + 4] ?? "the high street";
  }
  const zone = a.zone === "highway" ? b.zone : a.zone;
  return { docks: "Dock Rd", countryside: "Farm Lane", depot: "Depot Rd", suburbs: "Elm Grove" }[zone as string] ?? "a side street";
}

/** Compass direction of travel from -> to. North is -z. */
export function directionWord(from: string, to: string): string {
  const a = getNode(from);
  const b = getNode(to);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? "eastbound" : "westbound";
  return dz >= 0 ? "southbound" : "northbound";
}

const NOTES: Record<Scenario, string[]> = {
  rear_end: [
    "Rear-end shunt on {road} {dir}, {a} ploughed into {b}, lane blocked",
    "{A} slammed into {b} on {road} {dir}, glass everywhere",
    "Pile-up on {road} {dir}: {a} rear-ended {b}, road closed",
  ],
  solo: [
    "{A} spun out on {road} {dir} and hit the barrier, lane blocked",
    "{A} lost control on {road} {dir}, wreck across the lane",
  ],
  junction: ["Car ran a red on {road} and T-boned {a}, junction blocked", "Red-light runner smashed into {a} on {road}, glass everywhere"],
  shunt: ["{A} shunted {b} metres up {road} {dir}, airbags out, lane blocked", "Rear-end shunt on {road} {dir}, radiator steaming, lane blocked"],
  sideswipe: ["Side-swipe at speed on {road} {dir}, two cars spun out across both lanes", "Overtake gone wrong on {road} {dir}: two cars spun, road closed"],
  rollover: ["Car flipped onto its roof on {road} {dir}, road closed", "Rollover on {road} {dir}: car on its roof, debris everywhere"],
  pileup: ["{n}-vehicle pileup on {road} {dir}, both carriageways closed", "Chain-reaction pileup, {n} vehicles on {road} {dir}, HGV jackknifed, both carriageways closed"],
  jackknife: [
    "HGV jackknifed on {road} {dir}, 2 lanes blocked, cargo spilled",
    "Lorry jackknifed and on fire on {road} {dir}, road closed",
  ],
};

const NOUN: Partial<Record<VehicleKind, string>> = { car: "car", taxi: "black cab", truck: "HGV", van: "van" };

export function crashNote(
  kind: CrashKind,
  scenario: Scenario,
  from: string,
  to: string,
  rand: () => number = Math.random,
  a: VehicleKind = kind === "truck_crash" ? "truck" : "car",
  b: VehicleKind = "car",
  count = 0,
): string {
  const key = from < to ? `${from}|${to}` : `${to}|${from}`;
  const list = NOTES[scenario];
  const tpl = list[Math.floor(rand() * list.length)] ?? list[0];
  const art = (k: VehicleKind) => {
    const n = NOUN[k] ?? "car";
    return /^[aeiouH]/.test(n) ? `an ${n}` : `a ${n}`;
  };
  const an = art(a);
  return tpl
    .replace("{road}", roadName(key))
    .replace("{dir}", directionWord(from, to))
    .replace("{A}", an[0].toUpperCase() + an.slice(1))
    .replace("{a}", an)
    .replace("{b}", art(b))
    .replace("{n}", String(count))
    .replace(/^the /, "The ");
}

// --- Spots for the bigger set pieces ------------------------------------------

export interface Run {
  a: string;
  b: string;
  c: string;
  l1: number;
  l2: number;
  highway: boolean;
}

/** Two collinear consecutive edges a->b->c (a straight run of road) on the A-Ring or a downtown avenue. */
export function pickPileupRun(rand: () => number, blocked: ReadonlySet<string>, preferHighway = 0.65): Run | null {
  const runs: Run[] = [];
  const seen = new Set<string>();
  for (const e of ROAD_EDGES.values()) {
    for (const [a, b] of [
      [e.a, e.b],
      [e.b, e.a],
    ]) {
      if (seen.has(`${a}>${b}`)) continue;
      seen.add(`${a}>${b}`);
      const hw = e.kind === "highway";
      if (!hw && !(e.kind === "street" && getNode(a).zone === "downtown" && getNode(b).zone === "downtown")) continue;
      if (blocked.has(e.key)) continue;
      const na = getNode(a);
      const nb = getNode(b);
      for (const c of neighbours(b)) {
        if (c === a) continue;
        const e2 = ROAD_EDGES.get(edgeKey(b, c))!;
        if (e2.kind !== e.kind || blocked.has(e2.key)) continue;
        const nc = getNode(c);
        if (!hw && nc.zone !== "downtown") continue;
        const cross = (nb.x - na.x) * (nc.z - nb.z) - (nb.z - na.z) * (nc.x - nb.x);
        const dot = (nb.x - na.x) * (nc.x - nb.x) + (nb.z - na.z) * (nc.z - nb.z);
        if (Math.abs(cross) > 1e-6 || dot <= 0) continue;
        runs.push({ a, b, c, l1: e.length, l2: e2.length, highway: hw });
      }
    }
  }
  if (!runs.length) return null;
  const want = rand() < preferHighway;
  const pool = runs.filter((r) => r.highway === want);
  const from = pool.length ? pool : runs;
  return from[Math.floor(rand() * from.length)];
}

export interface Junction {
  node: string;
  aFrom: string; // victim crosses on green: aFrom -> node -> aTo
  aTo: string;
  bFrom: string; // runner comes in on red: bFrom -> node
}

/** A downtown junction where one approach has green right now and a perpendicular one has red. */
export function pickJunction(rand: () => number, blocked: ReadonlySet<string>, nowMs: number): Junction | null {
  const out: Junction[] = [];
  for (let i = -3; i <= 3; i++)
    for (let j = -3; j <= 3; j++) {
      const node = `g_${i}_${j}`;
      const n = getNode(node);
      for (const aFrom of neighbours(node)) {
        if (signalFor(node, aFrom, nowMs) !== "green") continue;
        const f = getNode(aFrom);
        const aTo = neighbours(node).find((x) => {
          const t = getNode(x);
          return Math.abs(t.x - n.x - (n.x - f.x)) < 1e-6 && Math.abs(t.z - n.z - (n.z - f.z)) < 1e-6;
        });
        if (!aTo || blocked.has(edgeKey(node, aTo)) || blocked.has(edgeKey(aFrom, node))) continue;
        for (const bFrom of neighbours(node)) {
          if (bFrom === aFrom || bFrom === aTo || signalFor(node, bFrom, nowMs) !== "red") continue;
          if (blocked.has(edgeKey(bFrom, node))) continue;
          out.push({ node, aFrom, aTo, bFrom });
        }
      }
    }
  return out.length ? out[Math.floor(rand() * out.length)] : null;
}
