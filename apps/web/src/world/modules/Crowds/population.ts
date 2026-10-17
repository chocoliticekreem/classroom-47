// Who walks where: turns the walk paths into per-instance attribute arrays for the GPU.
// Deterministic for a given seed and road graph. Pure: no three.js.
//
// Instance attribute layout (all vec4, Float32, 4 floats per instance):
//   aWalk  = (pathId, start s (m), signed speed (m/s), stride phase)   walkers
//          = (-1, x, z, yaw)                                            loiterers (stand still)
//   aLook  = (lateral (m) | ground y for loiterers, kind, scale, idle phase)
//   aShirt = (r, g, b, skin tone 0..1)        linear colour; umbrella canopy / dog fur on those meshes
//   aPants = (r, g, b, hair tone 0..1)
// Umbrellas and dogs are separate instanced meshes whose aWalk/aLook copy their owner's (dogs walk a
// little ahead and to the side), so they move in lockstep with no extra CPU work.
import {
  commuterPaths, mulberry32, packPaths, parkPaths, sidewalks, streetPaths,
  type Graph, type PackedPaths, type Rand, type StationSite, type WalkPath,
} from "./paths";
import { ROAD_EDGES, ROAD_NODES } from "../../roads";

export const KIND = { walker: 0, jogger: 1, umbrella: 2, dogWalker: 3, commuter: 4, loiterer: 5 } as const;
export const MIN_PEOPLE = 3000;
export const MAX_PEOPLE = 6000;
/** People per weighted metre of sidewalk. */
const DENSITY = 0.2;

export interface Attrs {
  count: number;
  aWalk: Float32Array;
  aLook: Float32Array;
  aShirt: Float32Array;
  aPants: Float32Array;
}

export interface Crowd {
  paths: WalkPath[];
  packed: PackedPaths;
  people: Attrs;
  umbrellas: Attrs;
  dogs: Attrs;
}

// sRGB hex -> linear rgb (three's working colour space), so the arrays can go straight to the shader.
function lin(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}

const CASUAL = ["#e63946", "#1d3557", "#f4a261", "#2a9d8f", "#ffb703", "#8338ec", "#3a86ff", "#ff006e", "#fefae0", "#264653", "#ff6a1a", "#6d6875", "#90be6d", "#f1faee", "#bc4749", "#a8dadc"].map(lin);
const TROUSERS = ["#1d3557", "#2b2d42", "#3d405b", "#22223b", "#4a4e69", "#6b705c", "#c9ada7", "#14213d", "#5e503f", "#283618"].map(lin);
const SUITS = ["#22223b", "#2b2d42", "#1b263b", "#3a3a3a", "#4a4e69", "#0d1b2a"].map(lin);
const SPORT = ["#ff006e", "#06d6a0", "#ffd60a", "#3a86ff", "#ff6a1a", "#f72585"].map(lin);
const UMBRELLAS = ["#111111", "#e63946", "#ffd60a", "#1d3557", "#ff6a1a", "#7209b7", "#2a9d8f"].map(lin);
const DOGS = ["#3b2a1a", "#c68642", "#f1e3c8", "#111111", "#8d6e63", "#e0c097"].map(lin);

const pick = <T,>(a: readonly T[], r: Rand) => a[Math.floor(r() * a.length) % a.length];

class Builder {
  aWalk: number[] = [];
  aLook: number[] = [];
  aShirt: number[] = [];
  aPants: number[] = [];
  get count() {
    return this.aWalk.length / 4;
  }
  push(walk: readonly number[], look: readonly number[], shirt: readonly number[], pants: readonly number[]) {
    this.aWalk.push(...walk);
    this.aLook.push(...look);
    this.aShirt.push(...shirt);
    this.aPants.push(...pants);
  }
  done(): Attrs {
    return {
      count: this.count,
      aWalk: Float32Array.from(this.aWalk),
      aLook: Float32Array.from(this.aLook),
      aShirt: Float32Array.from(this.aShirt),
      aPants: Float32Array.from(this.aPants),
    };
  }
}

/** Weighted metres of sidewalk in the graph: drives the crowd size. */
export function crowdSize(g: Graph): number {
  let w = 0;
  for (const s of sidewalks(g)) w += Math.hypot(s.bx - s.ax, s.bz - s.az) * s.weight;
  return Math.max(MIN_PEOPLE, Math.min(MAX_PEOPLE, Math.round(w * DENSITY)));
}

/** Cumulative-weight picker over paths. */
function weightedPicker(weights: readonly number[], rand: Rand) {
  const cdf: number[] = [];
  let t = 0;
  for (const w of weights) cdf.push((t += Math.max(0, w)));
  return () => {
    const r = rand() * t;
    let lo = 0;
    let hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}

export function buildCrowd(stations: readonly StationSite[], seed = 2026, g: Graph = { nodes: ROAD_NODES, edges: ROAD_EDGES }): Crowd {
  const rand = mulberry32(seed);
  const street = streetPaths(rand, g);
  const commuter = commuterPaths(stations, rand, g);
  const park = parkPaths();
  const paths = [...street, ...commuter, ...park];
  const packed = packPaths(paths);
  const total = crowdSize(g);

  const people = new Builder();
  const umbrellas = new Builder();
  const dogs = new Builder();

  const look = () => {
    const kr = rand();
    const kind = kr < 0.07 ? KIND.jogger : kr < 0.12 ? KIND.umbrella : kr < 0.17 ? KIND.dogWalker : KIND.walker;
    const shirt = kind === KIND.jogger ? pick(SPORT, rand) : rand() < 0.25 ? pick(SUITS, rand) : pick(CASUAL, rand);
    const pants = kind === KIND.jogger ? lin("#222222") : pick(TROUSERS, rand);
    return [[...shirt, rand()], [...pants, rand()], kind] as const;
  };

  const addWalker = (pathId: number, kind: number, shirt: readonly number[], pants: readonly number[], speed: number, lateral: number) => {
    const L = packed.lengths[pathId];
    const s0 = rand() * L;
    const dir = rand() < 0.5 ? 1 : -1;
    const phase = rand() * Math.PI * 2;
    const scale = 1.15 + rand() * 0.2;
    const lat = (rand() * 2 - 1) * lateral;
    people.push([pathId, s0, speed * dir, phase], [lat, kind, scale, rand() * 10], shirt, pants);
    if (kind === KIND.umbrella) umbrellas.push([pathId, s0, speed * dir, phase], [lat, kind, scale, 0], [...pick(UMBRELLAS, rand), 0], [0, 0, 0, 0]);
    if (kind === KIND.dogWalker) {
      const ahead = (1.1 + rand() * 0.4) * dir;
      const dogLat = lat + (lat > 0 ? -0.55 : 0.55);
      dogs.push([pathId, (s0 + ahead + L) % L, speed * dir, phase], [dogLat, 0, 0.8 + rand() * 0.5, 0], [...pick(DOGS, rand), 0], [0, 0, 0, 0]);
    }
  };

  const speedFor = (kind: number) =>
    kind === KIND.jogger ? 2.6 + rand() * 1.0 : kind === KIND.dogWalker ? 0.9 + rand() * 0.3 : kind === KIND.commuter ? 1.45 + rand() * 0.3 : 1.05 + rand() * 0.55;

  // budget: loiterers 7%, commuters 6% (if any stations), park 140, the rest on streets
  const nLoiter = Math.round(total * 0.07);
  const nCommute = commuter.length ? Math.round(total * 0.06) : 0;
  const nPark = 140;
  const nStreet = Math.max(0, total - nLoiter - nCommute - nPark);

  const streetPick = weightedPicker(street.map((p) => p.weight), rand);
  for (let i = 0; i < nStreet && street.length; i++) {
    const id = streetPick();
    const [shirt, pants, kind] = look();
    addWalker(id, kind, shirt, pants, speedFor(kind), street[id].lateral);
  }
  for (let i = 0; i < nCommute; i++) {
    const id = street.length + (i % commuter.length);
    const shirt = [...(rand() < 0.7 ? pick(SUITS, rand) : pick(CASUAL, rand)), rand()];
    const pants = [...pick(SUITS, rand), rand()];
    addWalker(id, KIND.commuter, shirt, pants, speedFor(KIND.commuter), commuter[i % commuter.length].lateral);
  }
  const parkBase = street.length + commuter.length;
  for (let i = 0; i < nPark; i++) {
    const id = parkBase + (i % park.length);
    const [shirt, pants, k] = look();
    const kind = k === KIND.umbrella ? KIND.walker : k; // umbrellas stay on the streets
    addWalker(id, kind, shirt, pants, kind === KIND.jogger ? speedFor(kind) : 0.8 + rand() * 0.5, park[i % park.length].lateral);
  }

  // Loitering groups: chatting circles on sidewalks across every zone, a crowd in the park, a queue at the wheel.
  let standers = 0;
  const addStander = (x: number, z: number, yaw: number, y: number) => {
    const [shirt, pants] = look();
    standers++;
    people.push([-1, x, z, yaw], [y, KIND.loiterer, 1.15 + rand() * 0.2, rand() * 10], shirt, pants);
  };
  const ring = (cx: number, cz: number, y: number, size: number) => {
    const r = 0.45 + size * 0.12;
    const a0 = rand() * Math.PI * 2;
    for (let k = 0; k < size; k++) {
      const a = a0 + (k / size) * Math.PI * 2 + (rand() - 0.5) * 0.4;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      addStander(x, z, Math.atan2(cx - x, cz - z), y);
    }
  };
  // park: groups on the three lawns without the pond (the pond is at world (12.5, 27.5))
  for (const [x, z] of [[27, 13], [30, 10], [27, 27], [13, 13]] as const) ring(x, z, 0.22, 3 + Math.floor(rand() * 3));
  // ferris wheel queue between the barriers (local z 9.05, 10.15, 11.25; x -4.5..4.5), facing along the snake
  for (let row = 0; row < 3; row++)
    for (let x = -4.4; x <= 4.4; x += 0.85) {
      const dirX = row % 2 === 0 ? -1 : 1;
      addStander(140 + x + (rand() - 0.5) * 0.15, 20 + 9.08 + row * 1.1, Math.atan2(dirX, 0), 0.14);
    }
  // sidewalk groups, weighted like the walkers
  const walks = sidewalks(g);
  if (walks.length) {
    const swPick = weightedPicker(walks.map((s) => s.weight * Math.hypot(s.bx - s.ax, s.bz - s.az)), rand);
    let left = nLoiter - standers;
    while (left > 0) {
      const s = walks[swPick()];
      const t = 0.2 + rand() * 0.6;
      const len = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1;
      // push a little away from the road (towards the shop fronts)
      const nx = (-(s.bz - s.az) / len) * s.side * 0.4;
      const nz = ((s.bx - s.ax) / len) * s.side * 0.4;
      const cx = s.ax + (s.bx - s.ax) * t + nx;
      const cz = s.az + (s.bz - s.az) * t + nz;
      const size = Math.min(left, rand() < 0.25 ? 1 : 2 + Math.floor(rand() * 4));
      if (size === 1) addStander(cx, cz, Math.atan2(nx, nz), s.y); // window shopper facing the shops
      else ring(cx, cz, s.y, size);
      left -= size;
    }
  }

  return { paths, packed, people: people.done(), umbrellas: umbrellas.done(), dogs: dogs.done() };
}
