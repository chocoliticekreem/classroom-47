// District roads: hampstead. Owned by the hampstead agent. Curves = several short straight edges through extra nodes.
// Hampstead sits north of the river (zone x -620..260, z -960..-700). Layout, west -> east:
//   tennis + cricket green + Highgate-style cemetery | the heath (no roads, hills) | village round-about,
//   high street, villa contour lanes and a cul-de-sac.
// A south lane runs along the motorway side; a west lane and the "Spaniards Road" frame the heath.
// Connectors to the rest of the city: `hp_link_south` (-200,-708) and `hp_link_village` (24,-712) sit next to
// the motorway's north side (z = -700). They are wired to motorway nodes when those exist (see LINKS).
import type { DistrictEdge, DistrictNode, DistrictRoads } from "./types";
import type { RoadKind } from "../roads";

type Pt = [number, number];

const nodes: DistrictNode[] = [];
const edges: DistrictEdge[] = [];
const pos = new Map<string, Pt>();

function node(id: string, x: number, z: number) {
  if (!pos.has(id)) {
    pos.set(id, [x, z]);
    nodes.push({ id, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, zone: "hampstead" });
  }
  return id;
}

/**
 * A lane through `pts` (junction ids or coordinates). Long segments are split into pieces of at most `step` m,
 * so curves are made of several short straight edges. Intermediate nodes are `hp_<name>_<k>`.
 */
/** Resolved corner points of every lane, by lane name (for modules that line streets with buildings). */
export const HP_LANES: Record<string, Pt[]> = {};

function lane(name: string, pts: (string | Pt)[], kind: RoadKind = "street", step = 22) {
  HP_LANES[name] = pts.map((p) => (typeof p === "string" ? pos.get(p)! : p));
  let k = 0;
  const idOf = (p: string | Pt) => (typeof p === "string" ? p : node(`hp_${name}_${k++}`, p[0], p[1]));
  let prev = idOf(pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pos.get(prev)!;
    const target = pts[i];
    const [bx, bz] = typeof target === "string" ? pos.get(target)! : target;
    const pieces = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let s = 1; s < pieces; s++) {
      const id = node(`hp_${name}_${k++}`, ax + ((bx - ax) * s) / pieces, az + ((bz - az) * s) / pieces);
      edges.push({ a: prev, b: id, kind });
      prev = id;
    }
    const end = idOf(target);
    edges.push({ a: prev, b: end, kind });
    prev = end;
  }
}

// ---- Junctions
const J = {
  sw: node("hp_j_sw", -606, -724),
  cricket: node("hp_j_cricket", -412, -726),
  s200: node("hp_j_s200", -200, -722),
  nw: node("hp_j_nw", -402, -944),
  ne: node("hp_j_ne", 0, -940),
  inner: node("hp_j_inner", 10, -822),
  contour: node("hp_j_contour", 5, -900),
  east: node("hp_j_e", 195, -805),
  cres: node("hp_j_cres", 234, -895),
  linkSouth: node("hp_link_south", -200, -708),
  linkVillage: node("hp_link_village", 24, -712),
};

// ---- Village roundabout (Whitestone): ring of 8 nodes, radius 14. k = 0 east, 2 south, 4 west, 6 north.
export const HP_ROUNDABOUT = { x: 20, z: -770, r: 14 };
const rb: string[] = [];
for (let k = 0; k < 8; k++) {
  const a = (k * Math.PI) / 4;
  rb.push(node(`hp_rb_${k}`, HP_ROUNDABOUT.x + Math.cos(a) * HP_ROUNDABOUT.r, HP_ROUNDABOUT.z + Math.sin(a) * HP_ROUNDABOUT.r));
}
for (let k = 0; k < 8; k++) edges.push({ a: rb[k], b: rb[(k + 1) % 8], kind: "street" });

// ---- Lanes
// South lane: along the motorway side, tennis/cricket to the village.
lane("south", [J.sw, [-560, -716], [-510, -722], J.cricket, [-360, -718], [-300, -726], [-250, -718], J.s200,
  [-150, -728], [-100, -719], [-55, -724], [-25, -740], [-4, -754], rb[3]]);
lane("southlink", [J.s200, J.linkSouth], "street");
lane("villagelink", [rb[2], [22, -735], J.linkVillage], "street");
// West lane: between the cricket green / cemetery and the heath.
lane("west", [J.cricket, [-400, -755], [-414, -790], [-404, -830], [-394, -870], [-408, -910], J.nw], "country");
// Spaniards Road: the heath's northern edge.
lane("spaniards", [J.nw, [-350, -936], [-300, -946], [-250, -938], [-200, -947], [-150, -937], [-100, -946],
  [-50, -938], J.ne], "country");
// Heath Street: roundabout north to the Spaniards Road.
lane("heathst", [rb[6], [14, -805], J.inner, [0, -845], [-6, -865], [-2, -885], J.contour, [2, -920], J.ne]);
// High Street: roundabout east, gently curving.
lane("high", [rb[0], [60, -766], [90, -761], [120, -762], [150, -769], [175, -784], J.east], "street", 15);
// Villa crescent: a big contour loop from the high street end round to the Spaniards Road.
lane("crescent", [J.east, [222, -828], [238, -860], J.cres, [212, -922], [175, -938], [130, -944], [85, -940],
  [45, -945], J.ne]);
// Bishops Avenue: inner contour lane.
lane("bishops", [J.inner, [45, -830], [80, -824], [115, -832], [150, -846], [175, -866], [192, -886], J.cres]);
// Templewood: a contour cul-de-sac ending in a turning circle.
export const HP_TURNING = { x: 150, z: -906, r: 8 };
const tc: string[] = [];
for (let k = 0; k < 6; k++) {
  const a = Math.PI + (k * Math.PI) / 3;
  tc.push(node(`hp_tc_${k}`, HP_TURNING.x + Math.cos(a) * HP_TURNING.r, HP_TURNING.z + Math.sin(a) * HP_TURNING.r));
}
for (let k = 0; k < 6; k++) edges.push({ a: tc[k], b: tc[(k + 1) % 6], kind: "street" });
lane("temple", [J.contour, [40, -895], [75, -888], [110, -896], tc[0]]);

// ---- Links to the motorway's north side (z = -700): mw_9 is at (-190,-700), mw_5 at (6,-700) in districts/motorway.ts.
// If the Motorway agent renames them, roads.ts skips the edge with a warning and the lead re-points these two ids.
// The Bridges agent also links its north-bank ends to the nearest hp_* nodes.
const LINKS: [string, string][] = [
  [J.linkSouth, "mw_9"],
  [J.linkVillage, "mw_5"],
];
for (const [a, b] of LINKS) edges.push({ a, b, kind: "ramp" });

export const hampstead: DistrictRoads = { nodes, edges };
