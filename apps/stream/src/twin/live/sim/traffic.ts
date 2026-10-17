import type { RoadNetwork, XZ } from "../../network/types";
import { mulberry32, pickCumulative, wrapAngle } from "./rng";

export const KIND_CAR = 0;
export const KIND_VAN = 1;
export const KIND_CAB = 2;
const KIND_LENGTH = [4.3, 5.3, 4.6];

const BRAKE = 2.8;
const HARD_BRAKE = 7;
const ACCEL = 2.2;
const REACTION_S = 0.9;
const MIN_GAP = 1.6;
const BLEND_M = 7;
const LOOKAHEAD_M = 45;
const MIN_SPAWN_LANE_M = 12;
const SPAWN_CLEARANCE_M = 10;
const JUNCTION_SPEED = 6.5;
const STOP_CHANCE = 0.12;
const STOP_LINE_M = 1.6;
const MAJOR_SPEED = 10.5;
const MINOR_SPEED = 7;
const YAW_RATE = 9;
const LANE_KEY = 1e5;
const FOCUS_SIGMA_M = 260;
const RECYCLE_FOCUS_M = 380;
const RECYCLE_CAMERA_M = 150;
const SPAWN_CAMERA_M = 60;
const RECYCLE_CHANCE = 0.35;

export class Vehicle {
  slot = 0;
  len: number;
  pace: number;
  lane = 0;
  s = 0;
  v = 0;
  next = -1;
  turnIn = 0;
  turnOut = 0;
  stopAtEnd = false;
  wait = 0;
  x = 0;
  z = 0;
  yaw = 0;
  fresh = true;

  constructor(
    readonly kind: number,
    pace: number,
  ) {
    this.len = KIND_LENGTH[kind];
    this.pace = pace;
  }
}

/**
 * Ambient traffic that lives on the road graph. A lane is one direction of one edge (`edge * 2` is
 * from→to, `edge * 2 + 1` is to→from); each vehicle holds (lane, s) where s is metres travelled along
 * the lane. Vehicles follow the car ahead in their lane (or the next lane), slow for turns and
 * junctions, and occasionally stop at a stop line.
 */
export class TrafficSim {
  readonly vehicles: Vehicle[] = [];
  private readonly rng: () => number;
  private readonly out: XZ = [0, 0];
  private readonly edgeId: Int32Array;
  private readonly laneLen: Float32Array;
  private readonly laneLat: Float32Array;
  private readonly laneFree: Float32Array;
  private readonly laneYawStart: Float32Array;
  private readonly laneYawEnd: Float32Array;
  private readonly laneJunction: Uint8Array;
  private readonly laneHead: Int32Array;
  private readonly laneExits: Int32Array[];
  private readonly laneExitCum: Float64Array[];
  private readonly laneMid: Float32Array;
  private focus: XZ | null;
  private spawnLanes: Int32Array = new Int32Array(0);
  private spawnCum: Float64Array = new Float64Array(0);
  private order: Int32Array;
  private key: Float64Array;

  constructor(
    private readonly net: RoadNetwork,
    counts: number[],
    seed: number,
    focus: XZ | null,
  ) {
    this.rng = mulberry32(seed);
    this.focus = focus;
    const edges = net.edges;
    const lanes = edges.length * 2;
    this.edgeId = new Int32Array(lanes);
    this.laneLen = new Float32Array(lanes);
    this.laneLat = new Float32Array(lanes);
    this.laneFree = new Float32Array(lanes);
    this.laneYawStart = new Float32Array(lanes);
    this.laneYawEnd = new Float32Array(lanes);
    this.laneJunction = new Uint8Array(lanes);
    this.laneMid = new Float32Array(lanes * 2);
    this.laneHead = new Int32Array(lanes).fill(-1);
    this.laneExits = new Array<Int32Array>(lanes);
    this.laneExitCum = new Array<Float64Array>(lanes);
    const valid = new Uint8Array(lanes);
    const nodeById = new Map(net.nodes.map((n, i) => [n.id, i] as const));
    const departing = new Map<number, number[]>();
    const arrival = new Int32Array(lanes);
    const out = this.out;

    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const fwd = i * 2;
      const rev = fwd + 1;
      this.edgeId[fwd] = this.edgeId[rev] = e.id;
      this.laneLen[fwd] = this.laneLen[rev] = e.length;
      this.laneLat[fwd] = Math.min(2, Math.max(1.1, e.width * 0.25));
      this.laneLat[rev] = -this.laneLat[fwd];
      this.laneFree[fwd] = this.laneFree[rev] = e.kind === "major" ? MAJOR_SPEED : MINOR_SPEED;
      const eps = Math.min(0.05, e.length * 0.4);
      const h0 = net.sample(e.id, eps, 0, out);
      const h1 = net.sample(e.id, Math.max(e.length - eps, eps), 0, out);
      net.sample(e.id, e.length * 0.5, 0, out);
      this.laneMid[fwd * 2] = this.laneMid[rev * 2] = out[0];
      this.laneMid[fwd * 2 + 1] = this.laneMid[rev * 2 + 1] = out[1];
      this.laneYawStart[fwd] = h0;
      this.laneYawEnd[fwd] = h1;
      this.laneYawStart[rev] = wrapAngle(h1 + Math.PI);
      this.laneYawEnd[rev] = wrapAngle(h0 + Math.PI);
      const from = nodeById.get(e.from);
      const to = nodeById.get(e.to);
      if (from === undefined || to === undefined || e.length < 1) continue;
      valid[fwd] = 1;
      valid[rev] = e.oneway ? 0 : 1;
      arrival[fwd] = to;
      arrival[rev] = from;
      const toNode = net.nodes[to];
      const fromNode = net.nodes[from];
      this.laneJunction[fwd] = toNode.junction || toNode.edges.length < 2 ? 1 : 0;
      this.laneJunction[rev] = fromNode.junction || fromNode.edges.length < 2 ? 1 : 0;
      for (const [lane, node] of [
        [fwd, from],
        [rev, to],
      ] as const) {
        if (!valid[lane]) continue;
        const list = departing.get(node);
        if (list) list.push(lane);
        else departing.set(node, [lane]);
      }
    }

    const empty = new Int32Array(0);
    for (let L = 0; L < lanes; L++) {
      this.laneExits[L] = empty;
      this.laneExitCum[L] = new Float64Array(0);
      if (!valid[L]) continue;
      const cands = (departing.get(arrival[L]) ?? []).filter((c) => c !== (L ^ 1));
      if (!cands.length && valid[L ^ 1]) cands.push(L ^ 1);
      const cum = new Float64Array(cands.length);
      let total = 0;
      for (let k = 0; k < cands.length; k++) {
        const c = cands[k];
        const turn = Math.abs(wrapAngle(this.laneYawStart[c] - this.laneYawEnd[L]));
        const major = edges[c >> 1].kind === "major" ? 1.5 : 1;
        total += (Math.exp(-((turn / 0.9) ** 2)) + 0.04) * major;
        cum[k] = total;
      }
      this.laneExits[L] = Int32Array.from(cands);
      this.laneExitCum[L] = cum;
    }

    this.buildSpawnTable(valid, nodeById);

    if (this.spawnLanes.length) {
      for (let kind = 0; kind < counts.length; kind++) {
        for (let i = 0; i < counts[kind]; i++) {
          const v = new Vehicle(kind, 0.82 + this.rng() * 0.33);
          v.slot = i;
          this.vehicles.push(v);
          this.place(v);
          v.v = this.laneFree[v.lane] * v.pace * 0.6;
        }
      }
    }
    this.order = new Int32Array(this.vehicles.length);
    for (let i = 0; i < this.order.length; i++) this.order[i] = i;
    this.key = new Float64Array(this.vehicles.length);
  }

  /** Only lanes in the largest connected piece of the network are used for spawning, so cars never get stuck in tiny islands. */
  private buildSpawnTable(valid: Uint8Array, nodeById: Map<number, number>) {
    const edges = this.net.edges;
    const parent = new Int32Array(this.net.nodes.length);
    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = (a: number) => {
      while (parent[a] !== a) a = parent[a] = parent[parent[a]];
      return a;
    };
    for (const e of edges) {
      const a = nodeById.get(e.from);
      const b = nodeById.get(e.to);
      if (a !== undefined && b !== undefined) parent[find(a)] = find(b);
    }
    const compLen = new Float64Array(parent.length);
    for (const e of edges) {
      const a = nodeById.get(e.from);
      if (a !== undefined) compLen[find(a)] += e.length;
    }
    let best = 0;
    for (let i = 1; i < compLen.length; i++) if (compLen[i] > compLen[best]) best = i;
    const lanes: number[] = [];
    for (let L = 0; L < valid.length; L++) {
      if (!valid[L] || this.laneLen[L] < MIN_SPAWN_LANE_M || !this.laneExits[L].length) continue;
      const a = nodeById.get(edges[L >> 1].from);
      if (a !== undefined && find(a) === best) lanes.push(L);
    }
    this.spawnLanes = Int32Array.from(lanes);
    this.setFocus(this.focus);
  }

  /** Biases where vehicles (re)spawn towards a point of interest (local metres), e.g. the streamer. */
  setFocus(focus: XZ | null) {
    this.focus = focus;
    const cum = new Float64Array(this.spawnLanes.length);
    let total = 0;
    for (let i = 0; i < cum.length; i++) {
      const L = this.spawnLanes[i];
      let density = 1;
      if (focus) {
        const d2 = (this.laneMid[L * 2] - focus[0]) ** 2 + (this.laneMid[L * 2 + 1] - focus[1]) ** 2;
        density = 0.15 + 2 * Math.exp(-d2 / (2 * FOCUS_SIGMA_M ** 2));
      }
      total += this.laneLen[L] * density;
      cum[i] = total;
    }
    this.spawnCum = cum;
  }

  private pickNext(lane: number): number {
    const exits = this.laneExits[lane];
    if (!exits.length) return -1;
    if (exits.length === 1) return exits[0];
    return exits[pickCumulative(this.laneExitCum[lane], this.rng())];
  }

  private enter(v: Vehicle, lane: number, s: number) {
    v.turnIn = v.turnOut;
    v.lane = lane;
    v.s = s;
    v.next = this.pickNext(lane);
    v.turnOut =
      v.next < 0
        ? 0
        : Math.min(1, Math.abs(wrapAngle(this.laneYawStart[v.next] - this.laneYawEnd[lane])) / 0.7);
    v.stopAtEnd = v.next >= 0 && this.laneJunction[lane] === 1 && this.rng() < STOP_CHANCE;
  }

  private place(v: Vehicle, camX = NaN, camZ = NaN) {
    const rng = this.rng;
    let lane = 0;
    let s = 0;
    for (let attempt = 0; attempt < 24; attempt++) {
      lane = this.spawnLanes[pickCumulative(this.spawnCum, rng())];
      s = rng() * this.laneLen[lane];
      let clear = !((this.laneMid[lane * 2] - camX) ** 2 + (this.laneMid[lane * 2 + 1] - camZ) ** 2 < SPAWN_CAMERA_M ** 2);
      for (const o of this.vehicles) {
        if (o !== v && o.lane === lane && Math.abs(o.s - s) < SPAWN_CLEARANCE_M) {
          clear = false;
          break;
        }
      }
      if (clear) break;
    }
    v.turnOut = 0;
    this.enter(v, lane, s);
    v.turnIn = 0;
    v.v = 0;
    v.wait = 0;
    v.fresh = true;
  }

  update(dtRaw: number, camX: number, camZ: number) {
    const vs = this.vehicles;
    const n = vs.length;
    if (!n) return;
    const dt = Math.min(dtRaw, 0.05);
    const { order, key, laneHead, laneLen, laneFree } = this;
    for (let i = 0; i < n; i++) {
      const v = vs[i];
      key[i] = v.lane * LANE_KEY + v.s;
      laneHead[v.lane] = -1;
    }
    for (let i = 1; i < n; i++) {
      const o = order[i];
      const k = key[o];
      let j = i - 1;
      while (j >= 0 && key[order[j]] > k) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = o;
    }
    for (let k = n - 1; k >= 0; k--) laneHead[vs[order[k]].lane] = k;

    const yawBlend = 1 - Math.exp(-YAW_RATE * dt);
    const out = this.out;
    for (let k = 0; k < n; k++) {
      const v = vs[order[k]];
      const L = v.lane;
      const len = laneLen[L];
      const remaining = len - v.s;
      const free = laneFree[L] * v.pace;
      let target = free;

      if (v.wait > 0) {
        v.wait -= dt;
        target = 0;
      } else {
        let vEnd = free;
        let stopLine = 0;
        if (v.next >= 0) {
          if (this.laneJunction[L]) vEnd = Math.min(vEnd, JUNCTION_SPEED);
          vEnd = Math.min(vEnd, Math.max(2.2, free * (1 - 0.75 * v.turnOut)));
          if (v.stopAtEnd) {
            vEnd = 0;
            stopLine = STOP_LINE_M;
          }
        }
        target = Math.min(free, Math.sqrt(vEnd * vEnd + 2 * BRAKE * Math.max(0, remaining - stopLine)));

        let lead: Vehicle | null = null;
        let gap = 0;
        if (k + 1 < n) {
          const o = vs[order[k + 1]];
          if (o.lane === L) {
            lead = o;
            gap = o.s - v.s;
          }
        }
        if (!lead && v.next >= 0 && remaining < LOOKAHEAD_M) {
          const h = laneHead[v.next];
          if (h >= 0) {
            const o = vs[order[h]];
            if (o !== v && o.lane === v.next) {
              lead = o;
              gap = remaining + o.s;
            }
          }
        }
        if (lead) {
          gap -= 0.5 * (v.len + lead.len);
          const bt = BRAKE * REACTION_S;
          const safe = -bt + Math.sqrt(bt * bt + lead.v * lead.v + 2 * BRAKE * Math.max(0, gap - MIN_GAP));
          if (safe < target) target = safe;
        }
        if (v.stopAtEnd && remaining < STOP_LINE_M + 0.8 && v.v < 0.25) {
          v.wait = 2 + this.rng() * 5;
          v.stopAtEnd = false;
        }
      }

      const dv = target - v.v;
      v.v = Math.max(0, dv > 0 ? v.v + Math.min(dv, ACCEL * dt) : v.v + Math.max(dv, -HARD_BRAKE * dt));
      v.s += v.v * dt;
      for (let guard = 0; guard < 3 && v.s >= laneLen[v.lane]; guard++) {
        const carry = v.s - laneLen[v.lane];
        if (v.next < 0) {
          this.place(v, camX, camZ);
          break;
        }
        this.enter(v, v.next, carry);
        const f = this.focus;
        if (
          f &&
          this.rng() < RECYCLE_CHANCE &&
          (v.x - f[0]) ** 2 + (v.z - f[1]) ** 2 > RECYCLE_FOCUS_M ** 2 &&
          (v.x - camX) ** 2 + (v.z - camZ) ** 2 > RECYCLE_CAMERA_M ** 2
        ) {
          this.place(v, camX, camZ);
          break;
        }
      }

      const lane = v.lane;
      const laneLength = laneLen[lane];
      let lateral = this.laneLat[lane];
      const toEnd = laneLength - v.s;
      if (toEnd < BLEND_M && v.turnOut > 0) lateral *= 1 - (1 - toEnd / BLEND_M) * v.turnOut;
      if (v.s < BLEND_M && v.turnIn > 0) lateral *= 1 - (1 - v.s / BLEND_M) * v.turnIn;
      const forward = (lane & 1) === 0;
      const h = this.net.sample(this.edgeId[lane], forward ? v.s : laneLength - v.s, lateral, out);
      const yaw = forward ? h : h + Math.PI;
      v.x = out[0];
      v.z = out[1];
      if (v.fresh) {
        v.yaw = yaw;
        v.fresh = false;
      } else {
        v.yaw += wrapAngle(yaw - v.yaw) * yawBlend;
      }
    }
  }
}
