// Fast A* over the shared road graph for traffic (same cost model as roads.findPath: travel time,
// avoiding blocked edge keys). Typed arrays + a binary heap, no per-expansion allocation, so a few
// hundred vehicles can re-path on a city-sized graph without frame spikes.
import { ROAD_EDGES, ROAD_NODES } from "../../roads";

const ids = [...ROAD_NODES.keys()];
const index = new Map(ids.map((id, i) => [id, i]));
const N = ids.length;
const xs = new Float64Array(N);
const zs = new Float64Array(N);
ids.forEach((id, i) => {
  const n = ROAD_NODES.get(id)!;
  xs[i] = n.x;
  zs[i] = n.z;
});

// CSR adjacency
const deg = new Int32Array(N);
for (const e of ROAD_EDGES.values()) {
  deg[index.get(e.a)!]++;
  deg[index.get(e.b)!]++;
}
const start = new Int32Array(N + 1);
for (let i = 0; i < N; i++) start[i + 1] = start[i] + deg[i];
const fill = start.slice(0, N);
const adjNb = new Int32Array(start[N]);
const adjCost = new Float64Array(start[N]);
const adjKey: string[] = new Array(start[N]);
let maxSpeed = 1;
for (const e of ROAD_EDGES.values()) {
  const a = index.get(e.a)!;
  const b = index.get(e.b)!;
  const cost = e.length / e.speedLimit;
  maxSpeed = Math.max(maxSpeed, e.speedLimit);
  adjNb[fill[a]] = b;
  adjCost[fill[a]] = cost;
  adjKey[fill[a]++] = e.key;
  adjNb[fill[b]] = a;
  adjCost[fill[b]] = cost;
  adjKey[fill[b]++] = e.key;
}

// Search state, reused between calls (stamp trick instead of clearing)
const g = new Float64Array(N);
const came = new Int32Array(N);
const seen = new Uint32Array(N);
const closed = new Uint32Array(N);
let stamp = 0;
let heapF = new Float64Array(64);
let heapN = new Int32Array(64);
let heapSize = 0;

function push(f: number, n: number) {
  if (heapSize === heapF.length) {
    const nf = new Float64Array(heapSize * 2);
    nf.set(heapF);
    heapF = nf;
    const nn = new Int32Array(heapSize * 2);
    nn.set(heapN);
    heapN = nn;
  }
  let i = heapSize++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapF[p] <= f) break;
    heapF[i] = heapF[p];
    heapN[i] = heapN[p];
    i = p;
  }
  heapF[i] = f;
  heapN[i] = n;
}

function pop(): number {
  const top = heapN[0];
  const lastF = heapF[--heapSize];
  const lastN = heapN[heapSize];
  let i = 0;
  for (;;) {
    let c = 2 * i + 1;
    if (c >= heapSize) break;
    if (c + 1 < heapSize && heapF[c + 1] < heapF[c]) c++;
    if (heapF[c] >= lastF) break;
    heapF[i] = heapF[c];
    heapN[i] = heapN[c];
    i = c;
  }
  heapF[i] = lastF;
  heapN[i] = lastN;
  return top;
}

/** Shortest-time path from -> to avoiding `blocked` edge keys, or null. Same contract as roads.findPath. */
export function fastPath(from: string, to: string, blocked: ReadonlySet<string>): string[] | null {
  const s = index.get(from);
  const t = index.get(to);
  if (s === undefined || t === undefined) return null;
  if (s === t) return [from];
  stamp = (stamp + 1) >>> 0 || 1;
  heapSize = 0;
  const tx = xs[t];
  const tz = zs[t];
  const h = (i: number) => Math.hypot(xs[i] - tx, zs[i] - tz) / maxSpeed;
  g[s] = 0;
  seen[s] = stamp;
  came[s] = -1;
  push(h(s), s);
  const checkBlocked = blocked.size > 0;
  while (heapSize) {
    const cur = pop();
    if (closed[cur] === stamp) continue;
    closed[cur] = stamp;
    if (cur === t) {
      const out: string[] = [];
      for (let n = t; n !== -1; n = came[n]) out.push(ids[n]);
      return out.reverse();
    }
    for (let k = start[cur]; k < start[cur + 1]; k++) {
      const nb = adjNb[k];
      if (closed[nb] === stamp) continue;
      if (checkBlocked && blocked.has(adjKey[k])) continue;
      const ng = g[cur] + adjCost[k];
      if (seen[nb] !== stamp || ng < g[nb]) {
        seen[nb] = stamp;
        g[nb] = ng;
        came[nb] = cur;
        push(ng + h(nb), nb);
      }
    }
  }
  return null;
}
