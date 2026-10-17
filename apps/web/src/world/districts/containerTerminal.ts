// District roads: containerTerminal. Owned by the containerTerminal agent. Curves = several short straight edges through extra nodes.
//
// ZONES.containerTerminal: x 236..335, z 100..340 (sea east of x 340; the motorway's coast road mw_cs_* runs
// along x = 336, under the ship-to-shore cranes).
//
//  - Gate complex (north): a plaza road along z = 106 fed from the ring (h_7) and the docks (dock_s), four
//    truck check-in lanes (x = 256, 267, 278, 289) running south through the gate canopy to the post-gate road
//    (z = 134), plus a customs inspection lane (x = 319) into the X-ray shed.
//  - Yard: a west perimeter road (x = 242) and a quay road (x = 310) joined by five yard lanes along x at
//    z = 172, 209, 246 (under the three RMG cranes; truck bays ct_l0_bay..ct_l2_bay), 282 and 310.
//  - Exit (south): the exit road along z = 336 to the out-gate node ct_exit (318,348). The industrial district
//    links its north-east gate to the nearest ct_* node (= ct_exit); we also join ct_exit to the coast road.
//  - A side link from the west perimeter road to the ring's SE corner h_8.
import type { DistrictEdge, DistrictNode, DistrictRoads } from "./types";
import { motorway } from "./motorway";

const nodes: DistrictNode[] = [];
const edges: DistrictEdge[] = [];

function n(id: string, x: number, z: number) {
  nodes.push({ id, x, z, zone: "containerTerminal" });
  return id;
}
function road(...ids: string[]) {
  for (let i = 1; i < ids.length; i++) edges.push({ a: ids[i - 1], b: ids[i], kind: "street" });
}

// ---- Gate complex ----------------------------------------------------------------------------------
export const CT_GATE_X = [256, 267, 278, 289] as const;
export const CT_PLAZA_Z = 106;
export const CT_BOOTH_Z = 120;
export const CT_POSTGATE_Z = 134;

n("ct_pz_w", 240, CT_PLAZA_Z);
n("ct_pz_e", 302, CT_PLAZA_Z);
n("ct_dn", 302, 84);
CT_GATE_X.forEach((x, k) => {
  n(`ct_gn_${k}`, x, CT_PLAZA_Z);
  n(`ct_gm_${k}`, x, CT_BOOTH_Z);
  n(`ct_gs_${k}`, x, CT_POSTGATE_Z);
  road(`ct_gn_${k}`, `ct_gm_${k}`, `ct_gs_${k}`);
});
road("h_7", "ct_pz_w", "ct_gn_0", "ct_gn_1", "ct_gn_2", "ct_gn_3", "ct_pz_e", "ct_dn", "dock_s");

// ---- Perimeter + quay roads ---------------------------------------------------------------------------
/** Yard lanes (along x). The first three run under the RMG cranes. */
export const CT_LANE_Z = [172, 209, 246, 282, 310] as const;
export const CT_WEST_X = 242;
export const CT_QUAY_X = 310;
export const CT_EXIT_Z = 336;
const SPINE_Z = [CT_POSTGATE_Z, 153, 172, 190, 209, 228, 246, 264, 282, 296, 310, 323, CT_EXIT_Z];

for (const z of SPINE_Z) {
  n(`ct_w_${z}`, CT_WEST_X, z);
  n(`ct_q_${z}`, CT_QUAY_X, z);
}
road(...SPINE_Z.map((z) => `ct_w_${z}`));
road(...SPINE_Z.map((z) => `ct_q_${z}`));

// Post-gate road: west perimeter -> gate lanes -> quay road -> customs.
n("ct_pg_e", 300, CT_POSTGATE_Z);
n("ct_cus_in", 319, CT_POSTGATE_Z);
n("ct_cus_x", 319, 114);
road(`ct_w_${CT_POSTGATE_Z}`, "ct_gs_0", "ct_gs_1", "ct_gs_2", "ct_gs_3", "ct_pg_e", `ct_q_${CT_POSTGATE_Z}`, "ct_cus_in", "ct_cus_x");

// Yard lanes. ct_l<j>_bay is where a truck stops under RMG j (trailer centre ~10 m behind it).
export const CT_BAY_X = 286;
CT_LANE_Z.forEach((z, j) => {
  n(`ct_l${j}_a`, 262, z);
  n(`ct_l${j}_bay`, CT_BAY_X, z);
  road(`ct_w_${z}`, `ct_l${j}_a`, `ct_l${j}_bay`, `ct_q_${z}`);
});

// Exit road (z = 336) and the out-gate.
n("ct_x_a", 262, CT_EXIT_Z);
n("ct_x_b", 286, CT_EXIT_Z);
n("ct_exit", 318, 348);
road(`ct_w_${CT_EXIT_Z}`, "ct_x_a", "ct_x_b", `ct_q_${CT_EXIT_Z}`, "ct_exit");

// Side link to the ring's SE corner (a gentle kink, two edges).
n("ct_h8", 231, 224);
road("h_8", "ct_h8", "ct_w_228");

// Join the out-gate to the motorway coast road (nearest mw_cs_* node), when the motorway exists.
const coast = motorway.nodes
  .filter((m) => m.id.startsWith("mw_cs_"))
  .map((m) => ({ m, d: Math.hypot(m.x - 318, m.z - 348) }))
  .sort((a, b) => a.d - b.d)[0];
if (coast && coast.d < 60) road("ct_exit", coast.m.id);

/** Named terminal places for the ContainerTerminal module. */
export const CT_PLACES = {
  gateIn: CT_GATE_X.map((_, k) => `ct_gm_${k}`),
  gateApproach: CT_GATE_X.map((_, k) => `ct_gn_${k}`),
  customs: "ct_cus_x",
  bays: [0, 1, 2].map((j) => `ct_l${j}_bay`),
  exit: "ct_exit",
} as const;

export const containerTerminal: DistrictRoads = { nodes, edges };
