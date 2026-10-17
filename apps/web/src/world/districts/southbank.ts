// District roads: southbank. Owned by the southbank agent. Curves = several short straight edges through extra nodes.
// Organic plan (no grid): a curving high street, a diagonal tree-lined boulevard between two roundabouts,
// a Georgian crescent, cobbled mews (cul-de-sacs), a stadium approach and a link south to the motorway.
// The pedestrianised market street has NO road edges (the Southbank module paves it).
// Zone: x -440..-80, z 250..620. Connectors leave the zone only to reach the ring (h_12 / h_11),
// the depot yard (depot_yard_w) and the motorway (sb_mw_link, about (-300, 700)).
import type { RoadKind } from "../roads";
import { motorway } from "./motorway";
import type { DistrictEdge, DistrictNode, DistrictRoads } from "./types";

type P = [number, number];

/** Named features the Southbank module builds around. Pure data, shared by roads and buildings. */
export const SB_FEATURES = {
  roundabouts: [
    { id: "sb_ra1", x: -165, z: 345, r: 14 },
    { id: "sb_ra2", x: -300, z: 455, r: 14 },
  ],
  crescent: { x: -412, z: 412, r: 44, from: (-75 * Math.PI) / 180, to: (75 * Math.PI) / 180 },
  /** Pedestrianised market street centre line (paving only, 12 m wide). */
  market: [[-288, 308], [-283, 332], [-276, 356], [-268, 382], [-262, 406]] as P[],
  marketWidth: 12,
  park: { minX: -245, maxX: -153, minZ: 426, maxZ: 518 },
  lake: { x: -198, z: 478, rx: 26, rz: 14 },
  bandstand: { x: -228, z: 446 },
  stadium: { x: -370, z: 552, rx: 68, rz: 55 },
  mwLink: [-300, 700] as P,
} as const;

const nodes: DistrictNode[] = [];
const edges: DistrictEdge[] = [];
const byId = new Map<string, DistrictNode>();

function node(id: string, x: number, z: number): string {
  const n: DistrictNode = { id, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, zone: "southbank" };
  nodes.push(n);
  byId.set(id, n);
  return id;
}

function edge(a: string, b: string, kind: RoadKind = "street") {
  edges.push({ a, b, kind });
}

/** Centripetal-ish Catmull-Rom through control points, resampled to roughly `step` m segments. */
function spline(ctrl: P[], step = 22): P[] {
  const dense: P[] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let k = 0; k < 20; k++) {
      const t = k / 20, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  dense.push(ctrl[ctrl.length - 1]);
  // arc length resample
  const acc = [0];
  for (let i = 1; i < dense.length; i++) acc.push(acc[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = acc[acc.length - 1];
  const n = Math.max(1, Math.round(total / step));
  const out: P[] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const s = (total * k) / n;
    while (j < acc.length - 2 && acc[j + 1] < s) j++;
    const u = (s - acc[j]) / (acc[j + 1] - acc[j] || 1);
    out.push([dense[j][0] + (dense[j + 1][0] - dense[j][0]) * u, dense[j][1] + (dense[j + 1][1] - dense[j][1]) * u]);
  }
  return out;
}

/** Lays a chain of nodes along pts and joins them. `start`/`end` reuse existing ids instead of the first/last point. */
function chain(prefix: string, pts: P[], kind: RoadKind = "street", start?: string, end?: string): string[] {
  const ids: string[] = [];
  pts.forEach(([x, z], i) => {
    if (i === 0 && start) ids.push(start);
    else if (i === pts.length - 1 && end) ids.push(end);
    else ids.push(node(`${prefix}_${i}`, x, z));
  });
  for (let i = 1; i < ids.length; i++) edge(ids[i - 1], ids[i], kind);
  return ids;
}

function nearest(ids: string[], x: number, z: number): string {
  let best = ids[0], bd = Infinity;
  for (const id of ids) {
    const n = byId.get(id)!;
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bd) {
      bd = d;
      best = id;
    }
  }
  return best;
}

const pos = (id: string): P => {
  const n = byId.get(id)!;
  return [n.x, n.z];
};

// --- Roundabouts: a ring of 8 nodes. k = 0 east, 2 south (+z), 4 west, 6 north.
const ra: string[][] = SB_FEATURES.roundabouts.map(({ id, x, z, r }) => {
  const ring: string[] = [];
  for (let k = 0; k < 8; k++) ring.push(node(`${id}_${k}`, x + r * Math.cos((k * Math.PI) / 4), z + r * Math.sin((k * Math.PI) / 4)));
  for (let k = 0; k < 8; k++) edge(ring[k], ring[(k + 1) % 8]);
  return ring;
});
const [ra1, ra2] = ra;

// --- High street: curves in from the west edge to roundabout 1, then on east to the depot.
const hsWest = chain(
  "sb_hs",
  spline([[-432, 318], [-400, 301], [-360, 292], [-320, 299], [-285, 295], [-250, 282], [-215, 285], [-190, 306], pos(ra1[5])], 22),
  "street",
  undefined,
  ra1[5],
);
chain("sb_hse", spline([pos(ra1[0]), [-128, 339], [-104, 323], [-82, 309]], 22), "street", ra1[0]);
const hsEastEnd = nodes[nodes.length - 1].id;
edge(hsEastEnd, "depot_yard_w"); // link east to the depot

// --- Ring connectors (south-west corner h_12 and south side h_11)
const hsAtRing = nearest(hsWest, -218, 285);
chain("sb_h12", [[-220, 220], [-221, 254], pos(hsAtRing)], "street", "h_12", hsAtRing);
chain("sb_h11", [[-110, 220], [-116, 253], [-127, 276], [-140, 297], [-153, 316], pos(ra1[6])], "street", "h_11", ra1[6]);

// --- Diagonal boulevard: roundabout 1 (south-west exit) straight to roundabout 2 (north-east exit)
const bvA = pos(ra1[3]), bvB = pos(ra2[7]);
const bvPts: P[] = [];
for (let i = 0; i <= 6; i++) bvPts.push([bvA[0] + ((bvB[0] - bvA[0]) * i) / 6, bvA[1] + ((bvB[1] - bvA[1]) * i) / 6]);
const boulevard = chain("sb_bv", bvPts, "street", ra1[3], ra2[7]);

// --- Street W: high street down to roundabout 2 (north exit)
const hsW = nearest(hsWest, -322, 299);
chain("sb_sw", spline([pos(hsW), [-332, 330], [-326, 360], [-318, 390], [-309, 418], pos(ra2[6])], 22), "street", hsW, ra2[6]);
const swIds = nodes.filter((n) => n.id.startsWith("sb_sw_")).map((n) => n.id);

// --- Street E: high street down to the boulevard, east of the market
const hsE = nearest(hsWest, -215, 285);
chain("sb_se", [pos(hsE), [-219, 312], [-211, 338], [-214, 362], pos(boulevard[2])], "street", hsE, boulevard[2]);

// --- The crescent: an arc around a lawn, opening east
const C = SB_FEATURES.crescent;
const crPts: P[] = [];
for (let i = 0; i <= 8; i++) {
  const a = C.from + ((C.to - C.from) * i) / 8;
  crPts.push([C.x + C.r * Math.cos(a), C.z + C.r * Math.sin(a)]);
}
const crescent = chain("sb_cr", crPts);
const hsCr = nearest(hsWest, -402, 301);
chain("sb_crn", [pos(hsCr), [-399, 322], [-404, 346], pos(crescent[0])], "street", hsCr, crescent[0]);
chain("sb_crs", spline([pos(crescent[8]), [-376, 462], [-345, 461], pos(ra2[4])], 22), "street", crescent[8], ra2[4]);

// --- S1: roundabout 2 south past the stadium to the motorway link
const s1 = chain("sb_s1", spline([pos(ra2[2]), [-290, 490], [-282, 520], [-280, 550], [-284, 580], [-290, 612]], 24), "street", ra2[2]);
const s1End = s1[s1.length - 1];
const [mlx, mlz] = SB_FEATURES.mwLink;
chain("sb_mwl", [pos(s1End), [-292, 634], [-296, 657], [-299, 679]], "street", s1End);
node("sb_mw_link", mlx, mlz);
edge("sb_mwl_3", "sb_mw_link");
// Join the motorway if its agent has laid nodes near the south side; otherwise sb_mw_link stays a stub.
{
  let best: DistrictNode | null = null, bd = 160;
  for (const n of motorway.nodes) {
    const d = Math.hypot(n.x - mlx, n.z - mlz);
    if (n.z > mlz - 10 && d < bd) {
      bd = d;
      best = n;
    }
  }
  if (best) edge("sb_mw_link", best.id, "ramp");
}

// --- S2: roundabout 1 south between the park and the glass towers, to the culture quarter
const s2 = chain("sb_s2", spline([pos(ra1[2]), [-157, 385], [-147, 412], [-140, 442], [-137, 472], [-139, 502], [-145, 532]], 24), "street", ra1[2]);

// --- S3: southern street joining S1 and S2, between the park and the culture quarter
const s1j = nearest(s1, -282, 522);
chain("sb_s3", spline([pos(s1j), [-255, 532], [-228, 537], [-200, 535], [-172, 540], pos(s2[s2.length - 1])], 24), "street", s1j, s2[s2.length - 1]);

// --- Mews: narrow cobbled cul-de-sacs
const swMid = nearest(swIds, -326, 360);
chain("sb_mw1", [pos(swMid), [-344, 353], [-362, 349]], "country", swMid);
const hsM2 = nearest(hsWest, -360, 292);
chain("sb_mw2", [pos(hsM2), [-363, 272], [-357, 258]], "country", hsM2);
const hsM3 = nearest(hsWest, -285, 295);
chain("sb_mw3", [pos(hsM3), [-279, 276], [-286, 259]], "country", hsM3);

export const southbank: DistrictRoads = { nodes, edges };
