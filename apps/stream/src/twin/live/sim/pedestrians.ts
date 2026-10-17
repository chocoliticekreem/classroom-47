import type { RoadNetwork, XZ } from "../../network/types";
import { mulberry32, pickCumulative, wrapAngle } from "./rng";

const NEAR_M = 150;
const FAR_STRIDE_MASK = 3;
const END_TOUCH_M = 10;
const STAND_GROUP_SHARE = 0.12;
const PAUSE_CHANCE = 0.04;
const FAR_RESPAWN_CHANCE = 0.3;
const YAW_RATE = 8;
const CADENCE = 8;
const STREAMER_SIGMA_M = 150;
const STATION_SIGMA_M = 80;

export class Pedestrian {
  /** Walk key: footway index * 2, plus 1 when walking from the footway's end to its start. */
  w = 0;
  s = 0;
  speed: number;
  lat: number;
  phase: number;
  stand = 0;
  acc = 0;
  x = 0;
  z = 0;
  yaw = 0;
  bob = 0;
  scale: number;
  fresh = true;
  dirty = true;

  constructor(rng: () => number) {
    this.speed = 1 + rng() * 0.6;
    this.lat = (rng() - 0.5) * 0.9 + 0.2;
    this.phase = rng() * 6.28;
    this.scale = 0.93 + rng() * 0.14;
  }
}

/** Pedestrians that walk along the network's footways, linger in small groups, and are denser near hotspots. */
export class PedSim {
  readonly peds: Pedestrian[] = [];
  private readonly rng: () => number;
  private readonly out: XZ = [0, 0];
  private readonly fwLen: Float32Array;
  private readonly yawStart: Float32Array;
  private readonly yawEnd: Float32Array;
  private readonly exits: Int32Array[];
  private readonly exitCum: Float64Array[];
  private readonly mids: Float32Array;
  private spawnCum: Float64Array = new Float64Array(0);
  private usable = 0;

  constructor(
    private readonly net: RoadNetwork,
    count: number,
    seed: number,
    streamer: XZ | null,
    stations: XZ[],
  ) {
    this.rng = mulberry32(seed);
    const fws = net.footways;
    const keys = fws.length * 2;
    this.fwLen = new Float32Array(fws.length);
    this.yawStart = new Float32Array(keys);
    this.yawEnd = new Float32Array(keys);
    this.exits = new Array<Int32Array>(keys);
    this.exitCum = new Array<Float64Array>(keys);
    this.mids = new Float32Array(fws.length * 2);
    const idIndex = new Map(fws.map((f, i) => [f.id, i] as const));
    const out = this.out;

    for (let i = 0; i < fws.length; i++) {
      const f = fws[i];
      this.fwLen[i] = f.length;
      if (f.length < 1) continue;
      const eps = Math.min(0.05, f.length * 0.4);
      const h0 = net.sampleFootway(f.id, eps, out);
      const h1 = net.sampleFootway(f.id, Math.max(f.length - eps, eps), out);
      this.yawStart[i * 2] = h0;
      this.yawEnd[i * 2] = h1;
      this.yawStart[i * 2 + 1] = wrapAngle(h1 + Math.PI);
      this.yawEnd[i * 2 + 1] = wrapAngle(h0 + Math.PI);
      net.sampleFootway(f.id, f.length * 0.5, out);
      this.mids[i * 2] = out[0];
      this.mids[i * 2 + 1] = out[1];
    }

    const empty = new Int32Array(0);
    for (let w = 0; w < keys; w++) {
      this.exits[w] = empty;
      this.exitCum[w] = new Float64Array(0);
      const i = w >> 1;
      const f = fws[i];
      if (f.length < 1) continue;
      const forward = (w & 1) === 0;
      const far = forward ? f.pts[f.pts.length - 1] : f.pts[0];
      const cands: number[] = [];
      for (const nid of f.neighbours) {
        const j = idIndex.get(nid);
        if (j === undefined || j === i || fws[j].length < 1) continue;
        const g = fws[j];
        const a = g.pts[0];
        const b = g.pts[g.pts.length - 1];
        const ds = Math.hypot(a[0] - far[0], a[1] - far[1]);
        const de = Math.hypot(b[0] - far[0], b[1] - far[1]);
        if (Math.min(ds, de) > END_TOUCH_M) continue;
        cands.push(ds <= de ? j * 2 : j * 2 + 1);
      }
      if (!cands.length) cands.push(w ^ 1);
      const cum = new Float64Array(cands.length);
      let total = 0;
      for (let k = 0; k < cands.length; k++) {
        const turn = Math.abs(wrapAngle(this.yawStart[cands[k]] - this.yawEnd[w]));
        total += Math.exp(-((turn / 1.2) ** 2)) + 0.15;
        cum[k] = total;
      }
      this.exits[w] = Int32Array.from(cands);
      this.exitCum[w] = cum;
    }

    this.setHotspots(streamer, stations);
    for (let i = 0; i < count && this.usable > 0; i++) this.peds.push(new Pedestrian(this.rng));
    this.seedPeds();
  }

  /** Reweights where people spawn: denser around the streamer and stations (local metres). */
  setHotspots(streamer: XZ | null, stations: XZ[]) {
    const fws = this.net.footways;
    const cum = new Float64Array(fws.length);
    let total = 0;
    let usable = 0;
    for (let i = 0; i < fws.length; i++) {
      if (fws[i].length >= 1) {
        const x = this.mids[i * 2];
        const z = this.mids[i * 2 + 1];
        let density = 0.3;
        if (streamer) {
          const d2 = (x - streamer[0]) ** 2 + (z - streamer[1]) ** 2;
          density += 3 * Math.exp(-d2 / (2 * STREAMER_SIGMA_M ** 2));
        }
        for (const st of stations) {
          const d2 = (x - st[0]) ** 2 + (z - st[1]) ** 2;
          density += 1.5 * Math.exp(-d2 / (2 * STATION_SIGMA_M ** 2));
        }
        total += fws[i].length * density;
        usable++;
      }
      cum[i] = total;
    }
    this.spawnCum = cum;
    this.usable = usable;
  }

  private seedPeds() {
    const rng = this.rng;
    const peds = this.peds;
    const standers = Math.floor(peds.length * STAND_GROUP_SHARE);
    let i = 0;
    while (i < peds.length) {
      const group = i < standers ? Math.min(peds.length - i, 2 + Math.floor(rng() * 3)) : 1;
      const w = this.randomWalk();
      const s = rng() * this.fwLen[w >> 1];
      const stand = group > 1 ? 8 + rng() * 40 : 0;
      for (let k = 0; k < group; k++) {
        const p = peds[i + k];
        p.w = w;
        p.s = Math.min(this.fwLen[w >> 1], Math.max(0, s + (k - (group - 1) / 2) * 0.7));
        p.stand = stand;
        if (group > 1) p.lat = (rng() - 0.5) * 1.2;
        this.pose(p, 0, true);
      }
      if (group > 1) {
        let cx = 0;
        let cz = 0;
        for (let k = 0; k < group; k++) {
          cx += peds[i + k].x / group;
          cz += peds[i + k].z / group;
        }
        for (let k = 0; k < group; k++) {
          const p = peds[i + k];
          p.yaw = Math.atan2(cx - p.x, cz - p.z) + (rng() - 0.5) * 0.8;
        }
      }
      i += group;
    }
  }

  private randomWalk(): number {
    const i = pickCumulative(this.spawnCum, this.rng());
    return i * 2 + (this.rng() < 0.5 ? 0 : 1);
  }

  private pose(p: Pedestrian, step: number, snap: boolean) {
    const len = this.fwLen[p.w >> 1];
    const forward = (p.w & 1) === 0;
    const out = this.out;
    const h = this.net.sampleFootway(this.net.footways[p.w >> 1].id, forward ? p.s : len - p.s, out);
    const travel = forward ? h : h + Math.PI;
    const off = p.lat + 0.12 * Math.sin(p.phase * 0.15);
    p.x = out[0] + Math.cos(travel) * off;
    p.z = out[1] - Math.sin(travel) * off;
    if (snap || p.fresh) {
      p.yaw = travel;
      p.fresh = false;
    } else {
      p.yaw += wrapAngle(travel - p.yaw) * (1 - Math.exp(-YAW_RATE * step));
    }
  }

  /** `frame` staggers far agents; they step every fourth frame with the time they missed. */
  update(dt: number, camX: number, camZ: number, frame: number) {
    const peds = this.peds;
    const rng = this.rng;
    const near2 = NEAR_M * NEAR_M;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      p.acc += Math.min(dt, 0.1);
      if (p.stand > 0) {
        p.stand -= p.acc;
        p.acc = 0;
        p.dirty = false;
        if (p.stand <= 0) p.fresh = false;
        continue;
      }
      const far = (p.x - camX) ** 2 + (p.z - camZ) ** 2 > near2;
      if (far && ((frame + i) & FAR_STRIDE_MASK) !== 0) {
        p.dirty = false;
        continue;
      }
      const step = p.acc;
      p.acc = 0;
      p.s += p.speed * step;
      p.phase += CADENCE * p.speed * step;
      p.bob = Math.abs(Math.sin(p.phase)) * 0.04;
      for (let guard = 0; guard < 3 && p.s >= this.fwLen[p.w >> 1]; guard++) {
        const carry = p.s - this.fwLen[p.w >> 1];
        const exits = this.exits[p.w];
        if (far && rng() < FAR_RESPAWN_CHANCE) {
          p.w = this.randomWalk();
          p.s = rng() * this.fwLen[p.w >> 1];
          p.fresh = true;
          break;
        }
        p.w = exits.length > 1 ? exits[pickCumulative(this.exitCum[p.w], rng())] : exits[0];
        p.s = carry;
        if (rng() < PAUSE_CHANCE) {
          p.stand = 4 + rng() * 12;
          p.bob = 0;
        }
      }
      this.pose(p, step, false);
      p.dirty = true;
    }
  }
}
