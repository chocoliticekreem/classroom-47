import { WORLD_RADIUS_M } from "@/twin/config";
import type { CamFrame } from "@/twin/live/project";
import { inViewCone } from "@/twin/live/project";
import type { FieldResponse } from "@/twin/field/types";
import { KIND_PERSON, KIND_VEHICLE, MAX_AGENTS, MAX_PEOPLE, MAX_VEHICLES, registry as R } from "./registry";

/**
 * Agent simulation over the field's road graph. All per-frame work runs on preallocated typed
 * arrays; graph (re)builds happen only when a new field arrives (every 30 s).
 */

const WALK_MIN = 1.1;
const WALK_MAX = 1.6;
/** Pavement: people walk 2–4 m off the centreline, on either side. */
const SIDEWALK_MIN = 2;
const SIDEWALK_MAX = 4;
/** UK keeps left: vehicles sit 1.75 m left of the centreline in their direction of travel. */
const LANE_OFFSET = 1.75;
const FADE_S = 1.5;
/** Spawn/despawn decisions run at this cadence; densities ease towards targets with this tau. */
const CONTROL_DT = 0.25;
const TARGET_TAU_S = 4;
const MAX_DEGREE = 16;
const EDGE_M = WORLD_RADIUS_M - 5;

const SEG_MAJOR = 0;
const SEG_MINOR = 1;
const SEG_PATH = 2;

interface Graph {
  n: number;
  ax: Float32Array;
  az: Float32Array;
  bx: Float32Array;
  bz: Float32Array;
  len: Float32Array;
  kind: Uint8Array;
  speed: Float32Array;
  nodeA: Int32Array;
  nodeB: Int32Array;
  nodeStart: Int32Array;
  nodeSegs: Int32Array;
  nodePull: Float32Array;
  targetPeds: Float32Array;
  targetVeh: Float32Array;
  curPeds: Float32Array;
  curVeh: Float32Array;
  covered: Uint8Array;
  countP: Int16Array;
  countV: Int16Array;
  killP: Int16Array;
  killV: Int16Array;
  midx: Float32Array;
  midz: Float32Array;
}

let G: Graph | null = null;
let crowdMult = 1;
let controlAcc = 0;
let coveredFrames: CamFrame[] = [];

const freePeople = new Int32Array(MAX_PEOPLE);
const freeVehicles = new Int32Array(MAX_VEHICLES);
let freePeopleN = 0;
let freeVehiclesN = 0;
const weights = new Float32Array(MAX_DEGREE);
const candidates = new Int32Array(MAX_DEGREE);

function resetAgents() {
  R.alive.fill(0);
  freePeopleN = 0;
  for (let i = MAX_PEOPLE - 1; i >= 0; i--) freePeople[freePeopleN++] = i;
  freeVehiclesN = 0;
  for (let i = MAX_VEHICLES - 1; i >= 0; i--) freeVehicles[freeVehiclesN++] = MAX_PEOPLE + i;
  R.livePeople = 0;
  R.liveVehicles = 0;
}
resetAgents();

export function setCrowdMultiplier(m: number) {
  crowdMult = m;
}

/** Cam cones that already have YOLO-tracked agents; field agents stay out of them. */
export function setCoveredCams(frames: CamFrame[]) {
  coveredFrames = frames;
  if (G) markCovered(G);
}


function markCovered(g: Graph) {
  for (let i = 0; i < g.n; i++) {
    let c = 0;
    for (const f of coveredFrames) if (inViewCone(f, g.midx[i], g.midz[i])) c = 1;
    g.covered[i] = c;
  }
}

export function setField(field: FieldResponse) {
  const segs = field.segments;
  const n = segs.length;
  const sameGraph = G !== null && G.n === n;
  const g: Graph = sameGraph
    ? G!
    : {
        n,
        ax: new Float32Array(n),
        az: new Float32Array(n),
        bx: new Float32Array(n),
        bz: new Float32Array(n),
        len: new Float32Array(n),
        kind: new Uint8Array(n),
        speed: new Float32Array(n),
        nodeA: new Int32Array(n),
        nodeB: new Int32Array(n),
        nodeStart: new Int32Array(0),
        nodeSegs: new Int32Array(0),
        nodePull: new Float32Array(0),
        targetPeds: new Float32Array(n),
        targetVeh: new Float32Array(n),
        curPeds: new Float32Array(n),
        curVeh: new Float32Array(n),
        covered: new Uint8Array(n),
        countP: new Int16Array(n),
        countV: new Int16Array(n),
        killP: new Int16Array(n),
        killV: new Int16Array(n),
        midx: new Float32Array(n),
        midz: new Float32Array(n),
      };

  for (let i = 0; i < n; i++) {
    const s = segs[i];
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    g.targetPeds[i] = (s.peds * len) / 100;
    g.targetVeh[i] = (s.vehicles * len) / 100;
    g.speed[i] = (s.speedKph ?? 0) / 3.6;
    if (sameGraph) continue;
    g.ax[i] = s.a[0];
    g.az[i] = s.a[1];
    g.bx[i] = s.b[0];
    g.bz[i] = s.b[1];
    g.len[i] = Math.max(0.5, len);
    g.kind[i] = s.kind === "major" ? SEG_MAJOR : s.kind === "minor" ? SEG_MINOR : SEG_PATH;
    g.midx[i] = (s.a[0] + s.b[0]) / 2;
    g.midz[i] = (s.a[1] + s.b[1]) / 2;
  }

  if (!sameGraph) {
    const nodeIds = new Map<string, number>();
    const nodeOf = (x: number, z: number) => {
      const key = `${Math.round(x * 2)},${Math.round(z * 2)}`;
      let id = nodeIds.get(key);
      if (id === undefined) {
        id = nodeIds.size;
        nodeIds.set(key, id);
      }
      return id;
    };
    const degree: number[] = [];
    for (let i = 0; i < n; i++) {
      g.nodeA[i] = nodeOf(g.ax[i], g.az[i]);
      g.nodeB[i] = nodeOf(g.bx[i], g.bz[i]);
      degree[g.nodeA[i]] = (degree[g.nodeA[i]] ?? 0) + 1;
      degree[g.nodeB[i]] = (degree[g.nodeB[i]] ?? 0) + 1;
    }
    const nodes = nodeIds.size;
    g.nodeStart = new Int32Array(nodes + 1);
    for (let k = 0; k < nodes; k++) g.nodeStart[k + 1] = g.nodeStart[k] + (degree[k] ?? 0);
    g.nodeSegs = new Int32Array(g.nodeStart[nodes]);
    const fill = new Int32Array(nodes);
    for (let i = 0; i < n; i++) {
      g.nodeSegs[g.nodeStart[g.nodeA[i]] + fill[g.nodeA[i]]++] = i;
      g.nodeSegs[g.nodeStart[g.nodeB[i]] + fill[g.nodeB[i]]++] = i;
    }
    g.nodePull = new Float32Array(nodes);
    const sigma2 = 2 * 120 * 120;
    for (let i = 0; i < n; i++) {
      for (const node of [g.nodeA[i], g.nodeB[i]]) {
        if (g.nodePull[node] !== 0) continue;
        const px = node === g.nodeA[i] ? g.ax[i] : g.bx[i];
        const pz = node === g.nodeA[i] ? g.az[i] : g.bz[i];
        let pull = 0;
        for (const a of field.anchors) {
          const dx = a.x - px;
          const dz = a.z - pz;
          pull += a.weight * Math.exp(-(dx * dx + dz * dz) / sigma2);
        }
        g.nodePull[node] = Math.min(3, pull) + 1e-4;
      }
    }
    g.curPeds.set(g.targetPeds);
    g.curVeh.set(g.targetVeh);
    resetAgents();
    G = g;
    markCovered(g);
  }
}

function spawn(g: Graph, seg: number, kind: number) {
  let slot: number;
  if (kind === KIND_PERSON) {
    if (freePeopleN === 0) return;
    slot = freePeople[--freePeopleN];
  } else {
    if (freeVehiclesN === 0) return;
    slot = freeVehicles[--freeVehiclesN];
  }
  const seed = Math.random();
  R.alive[slot] = 1;
  R.dying[slot] = 0;
  R.fade[slot] = 0;
  R.kind[slot] = kind;
  R.seed[slot] = seed;
  R.segment[slot] = seg;
  R.along[slot] = Math.random() * g.len[seg];
  R.dir[slot] = Math.random() < 0.5 ? 1 : -1;
  if (kind === KIND_PERSON) {
    R.speed[slot] = WALK_MIN + (WALK_MAX - WALK_MIN) * seed;
    const side = SIDEWALK_MIN + (SIDEWALK_MAX - SIDEWALK_MIN) * Math.random();
    R.offset[slot] = Math.random() < 0.5 ? side : -side;
  } else {
    R.speed[slot] = Math.max(1, g.speed[seg]) * (0.85 + 0.3 * seed);
    R.offset[slot] = LANE_OFFSET;
  }
  place(g, slot);
}

function kill(slot: number) {
  R.alive[slot] = 0;
  if (R.kind[slot] === KIND_PERSON) freePeople[freePeopleN++] = slot;
  else freeVehicles[freeVehiclesN++] = slot;
}

function place(g: Graph, i: number) {
  const s = R.segment[i];
  const len = g.len[s];
  const t = R.along[i] / len;
  const dir = R.dir[i];
  let dx = (g.bx[s] - g.ax[s]) / len;
  let dz = (g.bz[s] - g.az[s]) / len;
  let x: number;
  let z: number;
  if (dir > 0) {
    x = g.ax[s] + (g.bx[s] - g.ax[s]) * t;
    z = g.az[s] + (g.bz[s] - g.az[s]) * t;
  } else {
    x = g.bx[s] + (g.ax[s] - g.bx[s]) * t;
    z = g.bz[s] + (g.az[s] - g.bz[s]) * t;
    dx = -dx;
    dz = -dz;
  }
  const off = R.offset[i];
  R.x[i] = x + dz * off;
  R.z[i] = z - dx * off;
  R.heading[i] = Math.atan2(dx, -dz);
}

/** Picks the next segment at `node`; returns -1 at a dead end for the agent's kind. */
function chooseNext(g: Graph, node: number, current: number, kind: number, hx: number, hz: number) {
  const start = g.nodeStart[node];
  const end = g.nodeStart[node + 1];
  let k = 0;
  let total = 0;
  for (let j = start; j < end && k < MAX_DEGREE; j++) {
    const s = g.nodeSegs[j];
    if (s === current) continue;
    if (kind === KIND_VEHICLE && g.kind[s] === SEG_PATH) continue;
    const other = g.nodeA[s] === node ? g.nodeB[s] : g.nodeA[s];
    const ox = g.nodeA[s] === node ? g.bx[s] - g.ax[s] : g.ax[s] - g.bx[s];
    const oz = g.nodeA[s] === node ? g.bz[s] - g.az[s] : g.az[s] - g.bz[s];
    const straight = (ox * hx + oz * hz) / g.len[s];
    let w = 0.35 + 0.65 * Math.max(0, straight);
    if (kind === KIND_PERSON) w *= 0.5 + g.nodePull[other];
    else w *= g.kind[s] === SEG_MAJOR ? 1.5 : 1;
    candidates[k] = s;
    weights[k] = w;
    total += w;
    k++;
  }
  if (k === 0) return -1;
  let r = Math.random() * total;
  for (let j = 0; j < k; j++) {
    r -= weights[j];
    if (r <= 0) return candidates[j];
  }
  return candidates[k - 1];
}

function advance(g: Graph, i: number, dt: number) {
  const kind = R.kind[i];
  R.along[i] += R.speed[i] * dt;
  let guard = 0;
  while (R.along[i] >= g.len[R.segment[i]] && guard++ < 4) {
    const cur = R.segment[i];
    const over = R.along[i] - g.len[cur];
    const node = R.dir[i] > 0 ? g.nodeB[cur] : g.nodeA[cur];
    const hx = R.dir[i] * (g.bx[cur] - g.ax[cur]);
    const hz = R.dir[i] * (g.bz[cur] - g.az[cur]);
    const next = chooseNext(g, node, cur, kind, hx / g.len[cur], hz / g.len[cur]);
    if (next < 0) {
      if (kind === KIND_VEHICLE) {
        R.dying[i] = -1;
        return;
      }
      R.dir[i] = -R.dir[i] as 1 | -1;
      R.along[i] = over;
      continue;
    }
    R.segment[i] = next;
    R.dir[i] = g.nodeA[next] === node ? 1 : -1;
    R.along[i] = over;
    if (kind === KIND_VEHICLE) R.speed[i] = Math.max(1, g.speed[next]) * (0.85 + 0.3 * R.seed[i]);
  }
  place(g, i);
  if (Math.abs(R.x[i]) > EDGE_M || Math.abs(R.z[i]) > EDGE_M) R.dying[i] = -1;
}

function control(g: Graph) {
  const k = 1 - Math.exp(-CONTROL_DT / TARGET_TAU_S);
  let wantP = 0;
  let wantV = 0;
  for (let s = 0; s < g.n; s++) {
    g.curPeds[s] += (g.targetPeds[s] - g.curPeds[s]) * k;
    g.curVeh[s] += (g.targetVeh[s] - g.curVeh[s]) * k;
    if (g.covered[s]) continue;
    wantP += g.curPeds[s] * crowdMult;
    wantV += g.curVeh[s] * crowdMult;
  }
  const scaleP = wantP > MAX_PEOPLE ? MAX_PEOPLE / wantP : 1;
  const scaleV = wantV > MAX_VEHICLES ? MAX_VEHICLES / wantV : 1;
  for (let s = 0; s < g.n; s++) {
    const covered = g.covered[s] === 1;
    const wp = covered ? 0 : g.curPeds[s] * crowdMult * scaleP;
    const wv = covered || g.kind[s] === SEG_PATH ? 0 : g.curVeh[s] * crowdMult * scaleV;
    const dp = wp - g.countP[s];
    const dv = wv - g.countV[s];
    if (dp > 0 && Math.random() < Math.min(1, dp)) spawn(g, s, KIND_PERSON);
    else if (dp < -1) g.killP[s] = 1;
    if (dv > 0 && Math.random() < Math.min(1, dv)) spawn(g, s, KIND_VEHICLE);
    else if (dv < -1) g.killV[s] = 1;
  }
}

/** One simulation tick. Call once per rendered frame with the frame delta in seconds. */
export function step(dt: number) {
  const g = G;
  if (!g) return;
  if (dt > 0.1) dt = 0.1;
  g.countP.fill(0);
  g.countV.fill(0);
  let live = 0;
  let liveV = 0;
  for (let i = 0; i < MAX_AGENTS; i++) {
    if (!R.alive[i]) continue;
    const kind = R.kind[i];
    if (R.dying[i] < 0) {
      R.fade[i] -= dt / FADE_S;
      if (R.fade[i] <= 0) {
        kill(i);
        continue;
      }
    } else {
      if (R.fade[i] < 1) R.fade[i] = Math.min(1, R.fade[i] + dt / FADE_S);
      const s = R.segment[i];
      if (kind === KIND_PERSON ? g.killP[s] > 0 : g.killV[s] > 0) {
        if (kind === KIND_PERSON) g.killP[s]--;
        else g.killV[s]--;
        R.dying[i] = -1;
      }
    }
    advance(g, i, dt);
    if (R.dying[i] >= 0) {
      const s = R.segment[i];
      if (kind === KIND_PERSON) {
        g.countP[s]++;
        live++;
      } else {
        g.countV[s]++;
        liveV++;
      }
    }
  }
  g.killP.fill(0);
  g.killV.fill(0);
  R.livePeople = live;
  R.liveVehicles = liveV;
  controlAcc += dt;
  if (controlAcc >= CONTROL_DT) {
    controlAcc = 0;
    control(g);
  }
  R.version++;
}

/** Read-only view for debug overlays and the HUD. */
export function graphStats() {
  if (!G) return null;
  let targetPeople = 0;
  let targetVehicles = 0;
  for (let s = 0; s < G.n; s++) {
    targetPeople += G.targetPeds[s];
    targetVehicles += G.targetVeh[s];
  }
  return { targetPeople: targetPeople * crowdMult, targetVehicles: targetVehicles * crowdMult };
}
