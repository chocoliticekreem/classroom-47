// District roads: industrial. Owned by the industrial agent. Curves = several short straight edges through extra nodes.
//
// A gritty estate south-east of the ring (ZONES.industrial: x 80..335, z 370..660):
// - two link roads from the ring's south side (h_9 at (110,220) and the h_8 corner at (220,220)) come down the
//   x 110..220 corridor into the north avenue,
// - a spine road runs north -> south through a roundabout (8-node ring) at (208,510),
// - perimeter lanes loop around the four big plots (power station NW, refinery NE, steelworks SW, chemicals/scrap SE),
// - short cul-de-sacs into the plots,
// - a link to the container terminal (nearest ct_* node when that district exists, else the docks' dock_s),
// - `ind_mw_link` at (200,700) south of the estate for the motorway; joined to the nearest mw_* node when present.
//
// Districts merged BEFORE this one (motorway, containerTerminal) cannot reference our nodes (they don't exist yet
// when their edges are merged), so the cross-district joins are made from this side by looking at their data.
import { containerTerminal } from "./containerTerminal";
import { motorway } from "./motorway";
import type { DistrictEdge, DistrictNode, DistrictRoads } from "./types";

type P = [number, number];
type Stop = string | P | [number, number, string]; // existing id | anonymous waypoint | named waypoint

const nodes: DistrictNode[] = [];
const edges: DistrictEdge[] = [];
const pos = new Map<string, P>();

/** Existing nodes outside this district that we join (positions copied from roads.ts / docs). */
const EXTERNAL: Record<string, P> = { h_8: [220, 220], h_9: [110, 220], dock_s: [300, 60] };
for (const [id, p] of Object.entries(EXTERNAL)) pos.set(id, p);

const MAX_SEG = 30; // longer straight runs are split so traffic and the minimap get smooth, short edges

function node(id: string, x: number, z: number) {
  if (pos.has(id)) throw new Error(`industrial: duplicate node ${id}`);
  nodes.push({ id, x, z, zone: "industrial" });
  pos.set(id, [x, z]);
  return id;
}

let auto = 0;
function link(a: string, b: string) {
  const [ax, az] = pos.get(a)!;
  const [bx, bz] = pos.get(b)!;
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / MAX_SEG));
  let prev = a;
  for (let k = 1; k < n; k++) {
    const id = node(`ind_r${auto++}`, Math.round(ax + ((bx - ax) * k) / n), Math.round(az + ((bz - az) * k) / n));
    edges.push({ a: prev, b: id, kind: "street" });
    prev = id;
  }
  edges.push({ a: prev, b, kind: "street" });
}

/** A road through stops. Anonymous waypoints become `ind_<name>_<k>` nodes. */
function road(name: string, stops: Stop[]) {
  let prev: string | null = null;
  stops.forEach((s, k) => {
    const id =
      typeof s === "string" ? s : s.length === 3 ? node(s[2], s[0], s[1]) : node(`ind_${name}_${k}`, s[0], s[1]);
    if (!pos.has(id)) throw new Error(`industrial: unknown node ${id}`);
    if (prev) link(prev, id);
    prev = id;
  });
}

// ---- Junctions ---------------------------------------------------------------------------------
node("ind_nw", 130, 380); // north avenue, west end (link from h_9 arrives here)
node("ind_n_gate", 205, 378); // north avenue x spine (link from h_8 arrives here)
node("ind_ne", 292, 382); // north avenue, east end
node("ind_ct_gate", 314, 377); // NE corner: container terminal link + east lane
node("ind_w_jn", 98, 512); // west lane x west arm
node("ind_e_jn", 318, 500); // east arm x east lane
node("ind_s_gate", 202, 650); // south gate: spine x south lanes, motorway link
node("ind_mw_link", 200, 700); // motorway join point (outside the zone, by design)

// Roundabout: ring of 8 nodes, radius 14, around (208, 510). k = 0 north, 2 east, 4 south, 6 west.
export const IND_ROUNDABOUT = { x: 208, z: 510, r: 14 };
const RB = Array.from({ length: 8 }, (_, k) => {
  const a = (k * Math.PI) / 4;
  return node(
    `ind_rb_${k}`,
    Math.round(IND_ROUNDABOUT.x + IND_ROUNDABOUT.r * Math.sin(a)),
    Math.round(IND_ROUNDABOUT.z - IND_ROUNDABOUT.r * Math.cos(a)),
  );
});
RB.forEach((id, k) => edges.push({ a: id, b: RB[(k + 1) % 8], kind: "street" }));

// ---- Links to the ring (south side) ------------------------------------------------------------
road("lw", ["h_9", [112, 248], [115, 276], [119, 304], [123, 332], [127, 358], "ind_nw"]);
road("le", ["h_8", [219, 248], [218, 276], [216, 304], [213, 330], [209, 356], "ind_n_gate"]);

// ---- North avenue (gently bowed) --------------------------------------------------------------------
road("na", [
  "ind_nw", [150, 383], [170, 381, "ind_power_jn"], [188, 379], "ind_n_gate",
  [228, 379], [250, 381], [272, 383], "ind_ne", "ind_ct_gate",
]);

// ---- Spine: north gate -> roundabout -> south gate (slight S-curve) ----------------------------------
road("sp", ["ind_n_gate", [207, 400], [210, 425], [212, 450, "ind_ref_jn"], [211, 472], [209, 488], RB[0]]);
road("ss", [RB[4], [207, 545], [206, 568, "ind_steel_jn"], [205, 592, "ind_scrap_jn"], [204, 615], [203, 635], "ind_s_gate"]);

// ---- Roundabout arms ---------------------------------------------------------------------------------
road("wa", [RB[6], [176, 512], [156, 514], [136, 515], [116, 514], "ind_w_jn"]);
road("ea", [RB[2], [240, 508], [262, 506], [284, 505], [304, 503], "ind_e_jn"]);

// ---- Perimeter lanes -----------------------------------------------------------------------------------
road("wl", ["ind_nw", [110, 383], [95, 393], [88, 412], [86, 434], [86, 456], [87, 478], [91, 497], "ind_w_jn"]);
road("el", ["ind_ct_gate", [320, 394], [322, 416], [323, 440], [323, 464], [321, 484], "ind_e_jn"]);
road("swl", [
  "ind_w_jn", [92, 530], [88, 553], [87, 577], [89, 601], [95, 624], [107, 642], [128, 651], [154, 654], [180, 653], "ind_s_gate",
]);
road("sel", [
  "ind_e_jn", [322, 521], [323, 545], [323, 570], [322, 595], [319, 618], [311, 637], [294, 648], [272, 653], [247, 653], [224, 652], "ind_s_gate",
]);

// ---- Cul-de-sacs into the plots ---------------------------------------------------------------------
road("pw", ["ind_power_jn", [168, 398], [166, 414, "ind_power_gate"]]);
road("rf", ["ind_ref_jn", [224, 451], [236, 452, "ind_ref_gate"]]);
road("st", ["ind_steel_jn", [190, 570], [176, 572, "ind_steel_gate"]]);
road("sc", ["ind_scrap_jn", [222, 589], [240, 587], [256, 586, "ind_scrap_gate"]]);

// ---- Motorway link ------------------------------------------------------------------------------------
road("ml", ["ind_s_gate", [201, 675], "ind_mw_link"]);

// ---- Cross-district joins (made from this side, see header) --------------------------------------
function nearest(list: DistrictNode[], x: number, z: number, maxDist: number) {
  let best: DistrictNode | null = null;
  let bd = maxDist;
  for (const n of list) {
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}
function joinExternal(from: string, target: DistrictNode) {
  if (!pos.has(target.id)) pos.set(target.id, [target.x, target.z]);
  link(from, target.id);
}

/** Id of the node the container-terminal link ends at: nearest ct_* node, else dock_s. */
export const IND_CT_TARGET = (() => {
  const [gx, gz] = pos.get("ind_ct_gate")!;
  const ct = nearest(containerTerminal.nodes.filter((n) => n.id.startsWith("ct_")), gx, gz, 400);
  if (ct) {
    joinExternal("ind_ct_gate", ct);
    return ct.id;
  }
  road("ctl", ["ind_ct_gate", [306, 340], "dock_s"]);
  return "dock_s";
})();

/** Id of the motorway node joined to ind_mw_link, or null while the motorway district is empty. */
export const IND_MW_TARGET = (() => {
  const mw = nearest(motorway.nodes.filter((n) => n.id.startsWith("mw_")), 200, 700, 260);
  if (!mw) return null;
  joinExternal("ind_mw_link", mw);
  return mw.id;
})();

/** The motorway's coast road (mw_cs_*) runs just east of the estate: join the east lane to it. */
export const IND_COAST_TARGET = (() => {
  const [ex, ez] = pos.get("ind_e_jn")!;
  const cs = nearest(motorway.nodes.filter((n) => n.id.startsWith("mw_cs_")), ex, ez, 40);
  if (!cs) return null;
  joinExternal("ind_e_jn", cs);
  return cs.id;
})();

export const industrial: DistrictRoads = { nodes, edges };
