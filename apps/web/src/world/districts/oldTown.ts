// District roads: oldTown. Owned by the oldTown agent. Curves = several short straight edges through extra nodes.
// An organic historic town: a walled oval with a ring boulevard (where the walls were), a market square
// in the middle, winding lanes radiating out to the gates, a churchyard loop around the domed cathedral,
// and a Georgian new town (crescent + garden square) across the canal to the south.
// The OLD_TOWN plan (landmark sites, wall oval, canal) is exported for the OldTown module.
import type { ZoneName } from "../config";
import type { DistrictEdge, DistrictNode, DistrictRoads } from "./types";

type P = [number, number];
const Z: ZoneName = "oldTown";
const CONNECT: ZoneName = "countryside"; // connector nodes outside the zone (farmland / motorway approach)

// ---- Plan ---------------------------------------------------------------------------------------

/** The old walled oval: the boulevard runs on this ellipse, the surviving walls just outside it. */
export const WALL_OVAL = { x: -655, z: -20, rx: 122, rz: 180 };
/** Gentle wobble so the boulevard is not a perfect ellipse. */
export function ovalPoint(deg: number, grow = 0): P {
  const t = (deg * Math.PI) / 180;
  const w = 1 + 0.025 * Math.sin(3 * t + 1) + 0.015 * Math.sin(5 * t + 0.4);
  return [WALL_OVAL.x + (WALL_OVAL.rx * w + grow) * Math.cos(t), WALL_OVAL.z + (WALL_OVAL.rz * w + grow) * Math.sin(t)];
}

export const MARKET = { x: -682, z: -12, r: 24 };
export const CLOSE = { x: -590, z: -30, rx: 50, rz: 42 }; // St Paul's Churchyard loop

/** Landmark sites (centres, sizes in metres). Roads keep clear of them (see OldTown/roads.test.ts). */
export const OLD_TOWN = {
  cathedral: { x: -590, z: -30, ry: 0 }, // long axis along x, west front facing the market
  marketHall: { x: MARKET.x, z: MARKET.z },
  abbey: { x: -708, z: -120, len: 46, wid: 28 },
  castle: { x: -611, z: -150, r: 19 },
  university: { x: -716, z: 70, w: 30, d: 30 },
  crescent: { x: -700, z: 292, r: 62, from: 205, to: 335 }, // arc degrees (0 = +x, 90 = +z)
  gardenSquare: { x: -590, z: 240, hw: 30, hd: 25 },
  /** Parish churches with spires (long axis along local x; tower at the -x end). */
  churches: [
    { x: -640, z: 84, ry: 0 },
    { x: -532, z: 132, ry: Math.PI / 2 },
    { x: -532, z: 262, ry: 0 },
  ],
  /** Canal polyline (west -> east) south of the walls; lock gates at `lock`. */
  canal: {
    width: 12,
    points: [[-800, 196], [-760, 188], [-720, 192], [-680, 186], [-640, 190], [-600, 184], [-560, 190], [-520, 186], [-500, 188]] as P[],
    lock: [-620, 187] as P,
  },
  /** Gates in the wall where lanes leave the oval (degrees on the oval). The east gate has the gatehouse. */
  gates: { E: 2, SE: 52, S: 96, SW: 138, W: 180, NW: 222, N: 268, NE: 318 },
};

// ---- Builder ------------------------------------------------------------------------------------

const nodes: DistrictNode[] = [];
const edges: DistrictEdge[] = [];
const byId = new Map<string, DistrictNode>();
let auto = 0;

function node(id: string, [x, z]: P, zone: ZoneName = Z) {
  const n = { id, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, zone };
  if (!byId.has(id)) {
    byId.set(id, n);
    nodes.push(n);
  }
  return id;
}
/** Existing nodes we join (roads.ts builds them before the districts; keep in sync). */
const EXTERNAL: Record<string, P> = { farm_s: [-310, 80], mw_j_west: [-880, 0] };
const pos = (id: string): P => {
  if (EXTERNAL[id]) return EXTERNAL[id];
  const n = byId.get(id);
  if (!n) throw new Error(`oldTown: unknown node ${id}`);
  return [n.x, n.z];
};
function edge(a: string, b: string, kind: DistrictEdge["kind"] = "street") {
  edges.push({ a, b, kind });
}

/** A lane from node `from` through control points to node `to`, subdivided so no edge exceeds `step` m. */
function lane(from: string, ctrl: P[], to: string, opts: { step?: number; kind?: DistrictEdge["kind"]; zone?: ZoneName; ext?: P } = {}) {
  const { step = 22, kind = "street", zone = Z } = opts;
  const pts: P[] = [pos(from), ...ctrl, opts.ext ?? pos(to)];
  let prev = from;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) {
      const last = i === pts.length - 2 && k === n;
      const id = last ? to : node(`old_n${auto++}`, [ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n], zone);
      edge(prev, id, kind);
      prev = id;
    }
  }
}

// ---- Market square (octagon) and churchyard loop -------------------------------------------------

const mk = (k: number) => `old_mk_${((k % 8) + 8) % 8}`;
for (let k = 0; k < 8; k++) {
  const t = (k * Math.PI) / 4;
  node(mk(k), [MARKET.x + MARKET.r * Math.cos(t), MARKET.z + MARKET.r * Math.sin(t)]);
}
for (let k = 0; k < 8; k++) edge(mk(k), mk(k + 1));

const CL_N = 16;
const cl = (k: number) => `old_cl_${((k % CL_N) + CL_N) % CL_N}`;
for (let k = 0; k < CL_N; k++) {
  const t = (k * Math.PI * 2) / CL_N;
  node(cl(k), [CLOSE.x + CLOSE.rx * Math.cos(t), CLOSE.z + CLOSE.rz * Math.sin(t)]);
}
for (let k = 0; k < CL_N; k++) edge(cl(k), cl(k + 1));

// ---- Ring boulevard on the line of the old walls --------------------------------------------------

const G = OLD_TOWN.gates;
const gateOrder: [string, number][] = [
  ["E", G.E], ["SE", G.SE], ["S", G.S], ["SW", G.SW], ["W", G.W], ["NW", G.NW], ["N", G.N], ["NE", G.NE],
];
const gate = (name: string) => `old_gate_${name}`;
for (const [name, deg] of gateOrder) node(gate(name), ovalPoint(deg));
for (let i = 0; i < gateOrder.length; i++) {
  const [na, da] = gateOrder[i];
  const [nb, dbRaw] = gateOrder[(i + 1) % gateOrder.length];
  const db = dbRaw < da ? dbRaw + 360 : dbRaw;
  const n = Math.max(2, Math.round((db - da) / 9)); // ~20 m edges
  const ctrl: P[] = [];
  for (let k = 1; k < n; k++) ctrl.push(ovalPoint(da + ((db - da) * k) / n));
  lane(gate(na), ctrl, gate(nb), { step: 40 });
}

// ---- Junction key points inside the walls ---------------------------------------------------------

const K = {
  n1: node("old_k_n1", [-670, -78]),
  n2: node("old_k_n2", [-664, -150]),
  nw1: node("old_k_nw1", [-722, -58]),
  nw2: node("old_k_nw2", [-750, -102]),
  w1: node("old_k_w1", [-738, -14]),
  sw1: node("old_k_sw1", [-722, 26]),
  s1: node("old_k_s1", [-680, 64]),
  s2: node("old_k_s2", [-674, 118]),
  se1: node("old_k_se1", [-628, 52]),
  se2: node("old_k_se2", [-600, 100]),
  e1: node("old_k_e1", [-628, -96]),
  ne1: node("old_k_ne1", [-560, -100]),
  q1: node("old_k_q1", [-742, 92]),
};

// Radial lanes: market -> gates, each winding a little
lane(mk(6), [[-686, -52]], K.n1); // Northgate
lane(K.n1, [[-662, -112]], K.n2);
lane(K.n2, [[-660, -178]], gate("N"));
lane(mk(5), [[-708, -40]], K.nw1); // Abbey Lane
lane(K.nw1, [[-742, -78]], K.nw2);
lane(K.nw2, [[-752, -128]], gate("NW"));
lane(mk(4), [[-720, -18]], K.w1); // Westgate
lane(K.w1, [[-758, -20]], gate("W"));
lane(mk(3), [[-708, 12]], K.sw1); // Scholars' Walk
lane(K.sw1, [[-740, 48], [-750, 70]], K.q1);
lane(K.q1, [], gate("SW"));
lane(mk(2), [[-684, 36]], K.s1); // Southgate
lane(K.s1, [[-670, 90]], K.s2);
lane(K.s2, [[-668, 140]], gate("S"));
lane(cl(4), [[-612, 30]], K.se1); // Bridge Street
lane(K.se1, [[-616, 78]], K.se2);
lane(K.se2, [], gate("SE"));
lane(cl(0), [], gate("E")); // Eastgate (through the gatehouse)
lane(mk(0), [], cl(8)); // Ludgate: market -> cathedral west front

// Cross lanes and alleys between the radials (they make the irregular blocks)
lane(K.n1, [[-650, -88]], K.e1); // Castle Street
lane(K.e1, [[-640, -125]], K.n2);
lane(cl(11), [], K.e1);
lane(cl(13), [[-570, -86]], K.ne1);
lane(K.ne1, [], gate("NE"));
lane(K.n1, [[-700, -70]], K.nw1); // Shambles
lane(K.nw1, [[-736, -36]], K.w1);
lane(K.w1, [[-734, 8]], K.sw1);
lane(K.sw1, [[-700, 40]], K.s1); // Cornmarket
lane(K.s1, [[-652, 58]], K.se1);
lane(K.se1, [[-596, 40], [-560, 34]], gate("E"), {}); // Tanner's Row
lane(K.s2, [[-640, 110]], K.se2);
lane(K.s2, [[-706, 112]], K.q1); // Chapel Lane
lane(K.nw2, [[-722, -92]], K.n1); // Friars' Walk (north of the abbey close)

// ---- Georgian new town south of the canal ----------------------------------------------------------

const C = OLD_TOWN.crescent;
const cres = (k: number) => `old_cr_${k}`;
const CRES_N = 7;
for (let k = 0; k <= CRES_N; k++) {
  const t = ((C.from + ((C.to - C.from) * k) / CRES_N) * Math.PI) / 180;
  node(cres(k), [C.x + C.r * Math.cos(t), C.z + C.r * Math.sin(t)]);
}
for (let k = 0; k < CRES_N; k++) edge(cres(k), cres(k + 1));

const S = OLD_TOWN.gardenSquare;
const sq = [
  node("old_sq_nw", [S.x - S.hw, S.z - S.hd]),
  node("old_sq_n", [S.x, S.z - S.hd]),
  node("old_sq_ne", [S.x + S.hw, S.z - S.hd]),
  node("old_sq_e", [S.x + S.hw, S.z]),
  node("old_sq_se", [S.x + S.hw, S.z + S.hd]),
  node("old_sq_s", [S.x, S.z + S.hd]),
  node("old_sq_sw", [S.x - S.hw, S.z + S.hd]),
  node("old_sq_w", [S.x - S.hw, S.z]),
];
sq.forEach((id, i) => edge(id, sq[(i + 1) % sq.length]));

// Canal bridges: Southgate -> crescent top, SE gate -> garden square, SW gate -> crescent west end
lane(gate("S"), [[-672, 176], [-676, 204]], cres(4));
lane(gate("SE"), [[-578, 160], [-580, 196]], "old_sq_n");
lane(gate("SW"), [[-772, 140], [-780, 178], [-778, 214], [-770, 250]], cres(0));
lane(cres(CRES_N), [[-628, 266]], "old_sq_sw"); // Brock Street
lane(cres(5), [[-650, 222]], "old_sq_nw");

// ---- Connectors to the rest of the city ------------------------------------------------------------

// East: Eastgate -> a country road through the farmland -> farm_s (farm lanes -> ring h_13 / h_14).
// (farm_w is left alone: its two farm lanes are a dead-end pocket other modules' tests rely on.)
node("old_e_out", [-512, -16]);
lane(gate("E"), [], "old_e_out");
lane("old_e_out", [[-470, -6], [-430, 18], [-390, 48], [-350, 70]], "farm_s", { kind: "country", zone: CONNECT, step: 24 });
// South-east: garden square -> farm_s (-> ring h_13 via the farm lanes)
node("old_se_out", [-512, 236]);
lane("old_sq_e", [[-540, 238]], "old_se_out");
lane("old_se_out", [[-478, 214], [-446, 180], [-410, 140], [-370, 104]], "farm_s", { kind: "country", zone: CONNECT, step: 24 });
// West: Westgate -> the motorway's Old Town junction (mw_j_west, merged before this district)
lane(gate("W"), [[-796, -16], [-830, -8], [-856, -2]], "mw_j_west", { zone: CONNECT });

export const oldTown: DistrictRoads = { nodes, edges };
