// District roads: shoreditch. Owned by the shoreditch agent. Curves = several short straight edges through extra nodes.
// Shoreditch (x 80..335, z -540..-240): the "Silicon Roundabout" (8-node ring) at (165,-300) with seven arms,
// a winding high street north to the riverside road, a diagonal Hackney Road crescent, warehouse cross streets and
// three cul-de-sacs. Connected to ring h_3/h_4, suburbs sub_1_0/sub_1_1, and east to the motorway coast road
// (mw_cn_0..7 along x = 336, which runs along the seafront; the promenade is a boardwalk on its sea side).
import type { DistrictEdge, DistrictNode, DistrictRoads } from "./types";

/** Silicon Roundabout centre and radius (the module puts the lit sculpture inside). */
export const SH_ROUNDABOUT = { x: 165, z: -300, r: 16 };

const N: [string, number, number][] = [];
const E: [string, string][] = [];

function node(id: string, x: number, z: number) {
  N.push([id, Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
  return id;
}

/** A polyline road: from an existing id through new points to an existing id (or ending in a dead end). */
function chain(from: string, prefix: string, pts: [number, number][], to?: string) {
  let prev = from;
  pts.forEach(([x, z], i) => {
    const id = node(`${prefix}${i + 1}`, x, z);
    E.push([prev, id]);
    prev = id;
  });
  if (to) E.push([prev, to]);
}

// --- Silicon Roundabout: rb0 east, then clockwise (rb2 south, rb4 west, rb6 north)
const RB = SH_ROUNDABOUT;
for (let k = 0; k < 8; k++) {
  const a = (k * Math.PI) / 4;
  node(`sh_rb${k}`, RB.x + RB.r * Math.cos(a), RB.z + RB.r * Math.sin(a));
}
for (let k = 0; k < 8; k++) E.push([`sh_rb${k}`, `sh_rb${(k + 1) % 8}`]);

// --- Riverside road along the north edge, east to the motorway coast road (mw_cn_*, x = 336)
node("sh_river", 192, -533); // riverside node: the bridges link in near here
chain("sh_river", "sh_rs", [[222, -535], [250, -534], [276, -529], [304, -527]], "mw_cn_0");

// --- High street: north from the roundabout to the riverside road
chain("sh_rb6", "sh_hs", [[163, -338], [158, -362], [155, -388], [154, -414], [157, -440], [163, -466], [170, -492], [178, -518]], "sh_river");

// --- City Road: south-west arm to ring h_3
chain("sh_rb2", "sh_cr", [[152, -268], [134, -252], [118, -236]], "h_3");
// --- Great Eastern Street: south-east arm to ring h_4, with a spur to the promenade
chain("sh_rb1", "sh_ge", [[191, -273], [205, -256], [215, -238]], "h_4");
chain("sh_ge2", "sh_gp", [[231, -252], [258, -256], [284, -262], [310, -266]], "mw_cn_7");
// --- Old Street west, to the suburbs (sub_1_0)
chain("sh_rb4", "sh_ow", [[130, -298], [110, -292], [92, -284], [76, -272]], "sub_1_0");
// --- Old Street east, to the seafront
chain("sh_rb0", "sh_oe", [[204, -302], [228, -307], [252, -313], [277, -317], [305, -307]], "mw_cn_6");
// --- Curtain Road: north-east diagonal to the seafront
chain("sh_rb7", "sh_cu", [[192, -330], [208, -350], [226, -368], [245, -383], [266, -394], [299, -388]], "mw_cn_4");
// --- Hackney Road: a long north-west crescent that sweeps round to meet the high street near the river
chain(
  "sh_rb5",
  "sh_hk",
  [[138, -328], [122, -348], [108, -370], [97, -394], [91, -420], [92, -448], [100, -476], [112, -500], [128, -520], [150, -531]],
  "sh_hs8",
);
// --- Link to the suburbs (sub_1_1)
chain("sub_1_1", "sh_sw", [[84, -330], [103, -340]], "sh_hk2");

// --- Warehouse cross streets
chain("sh_hk3", "sh_rv", [[130, -374]], "sh_hs3"); // Rivington Street
chain("sh_hk5", "sh_rc", [[112, -425], [134, -421]], "sh_hs4"); // Redchurch Street
chain("sh_hk7", "sh_bg", [[121, -472], [142, -466]], "sh_hs6"); // Bethnal Green Lane
chain("sh_hs3", "sh_ch", [[180, -392], [204, -396], [225, -392]], "sh_cu4"); // Charlotte Road
chain("sh_hs5", "sh_ft", [[182, -442], [208, -446], [234, -444], [258, -437], [281, -430], [307, -420]], "mw_cn_3"); // Fashion Street
chain("sh_hs7", "sh_bk", [[195, -490], [220, -488], [246, -484], [272, -480], [302, -486]], "mw_cn_1"); // Brick Lane
chain("sh_hs1", "sh_ps", [[180, -346]], "sh_cu2"); // Paul Street, a short link
// --- Cul-de-sacs
chain("sh_ft3", "sh_cdA", [[238, -462]]);
chain("sh_ch2", "sh_cdB", [[200, -418]]);
chain("sh_bk2", "sh_cdC", [[218, -510]]);

const nodes: DistrictNode[] = N.map(([id, x, z]) => ({ id, x, z, zone: "shoreditch" }));
const edges: DistrictEdge[] = E.map(([a, b]) => ({ a, b, kind: "street" }));

export const shoreditch: DistrictRoads = { nodes, edges };
