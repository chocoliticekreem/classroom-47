// District roads: government. Owned by the Government agent. Curves = several short straight edges through extra nodes.
//
// ZONES.government: x 236..330, z -236..-90 (ring east side at x = 220, coast road mw_cn_* at x = 336,
// paved sea-wall embankment from x = 326, Shoreditch north of z = -240, docks south of z = -80).
//
//  - The Avenue (ceremonial, south): ring h_5 -> Whitehall corner -> a gentle rise to the Circus (8-node
//    roundabout round the Victory column at (299,-106)) -> the coast road (mw_cn_11). Flags line both sides.
//  - Residence drive: north out of the Circus through the gate lodges (gov_res_gate), sweeping west round the
//    South Lawn to the south portico (gov_res_porch).
//  - Whitehall (west): a slightly bowed street from the Avenue north past Parliament and the Ministry to
//    Embassy Row and the ring's NE corner (h_4).
//  - Embassy Row (north): Whitehall -> Downing Street junction -> the residence's north (mailroom) gate ->
//    the embassy -> the coast road (mw_cn_8).
//  - Downing Street: a short gated cul-de-sac north off Embassy Row; the PM's office is at its end (gov_pm).
import type { DistrictEdge, DistrictNode, DistrictRoads } from "./types";

const nodes: DistrictNode[] = [];
const edges: DistrictEdge[] = [];

function n(id: string, x: number, z: number) {
  nodes.push({ id, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, zone: "government" });
  return id;
}
function road(...ids: string[]) {
  for (let i = 1; i < ids.length; i++) edges.push({ a: ids[i - 1], b: ids[i], kind: "street" });
}

/** The Circus (roundabout on the Avenue) and its central column. */
export const GOV_CIRCUS = { x: 299, z: -106, r: 10 };

// ---- The Avenue -------------------------------------------------------------------------------------------
n("gov_av0", 240, -110);
n("gov_av1", 258, -106);
n("gov_av2", 276, -104);
for (let k = 0; k < 8; k++) {
  const a = (k * Math.PI) / 4; // k = 0 east, 2 south (+z), 4 west, 6 north
  n(`gov_cc${k}`, GOV_CIRCUS.x + GOV_CIRCUS.r * Math.cos(a), GOV_CIRCUS.z + GOV_CIRCUS.r * Math.sin(a));
}
for (let k = 0; k < 8; k++) road(`gov_cc${k}`, `gov_cc${(k + 1) % 8}`);
n("gov_av3", 318, -111);
road("h_5", "gov_av0", "gov_av1", "gov_av2", "gov_cc4");
road("gov_cc0", "gov_av3", "mw_cn_11");

// ---- Residence drive -----------------------------------------------------------------------------------------
n("gov_res_gate", 299, -127);
n("gov_rd1", 289, -136);
n("gov_rd2", 284, -152);
n("gov_rd3", 287, -168);
n("gov_res_porch", 298, -177);
road("gov_cc6", "gov_res_gate", "gov_rd1", "gov_rd2", "gov_rd3", "gov_res_porch");

// ---- Whitehall -----------------------------------------------------------------------------------------------
n("gov_parliament", 244, -132);
n("gov_wh2", 247, -154);
n("gov_min_mail", 247, -176);
n("gov_wh4", 245, -196);
n("gov_er0", 240, -215);
road("gov_av0", "gov_parliament", "gov_wh2", "gov_min_mail", "gov_wh4", "gov_er0", "h_4");

// ---- Embassy Row + Downing Street ---------------------------------------------------------------------------------
n("gov_ds_jn", 266, -214);
n("gov_res_mail", 286, -214);
n("gov_embassy", 304, -214);
n("gov_er4", 322, -217);
road("gov_er0", "gov_ds_jn", "gov_res_mail", "gov_embassy", "gov_er4", "mw_cn_8");
n("gov_ds1", 266, -223);
n("gov_pm", 266, -231);
road("gov_ds_jn", "gov_ds1", "gov_pm");

/** Named places for motorcades and state events (Events module). */
export const GOV_PLACES = {
  residenceGate: "gov_res_gate",
  residence: "gov_res_porch",
  pmOffice: "gov_pm",
  embassy: "gov_embassy",
  parliament: "gov_parliament",
  circus: "gov_cc6",
} as const;

/** Government delivery stops: the secure mailrooms (residence north gate, Ministry side door on Whitehall). */
export const GOV_DELIVERY_NODES: readonly string[] = ["gov_res_mail", "gov_min_mail"];

export const government: DistrictRoads = { nodes, edges };
