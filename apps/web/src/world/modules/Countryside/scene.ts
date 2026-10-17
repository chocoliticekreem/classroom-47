// Builds the Countryside's static geometry (one merged vertex-coloured mesh) plus the shared
// templates for rotors, sails, trees and animals. Runs once on mount.
import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  Shape,
  Vector3,
} from "three";
import { GeoBuilder, jitter, template } from "./builder";
import {
  FARM,
  makeFields,
  makeHills,
  makeTrees,
  makeTurbines,
  mulberry32,
  makeAllotments,
  makeFarmsteads,
  makeSouthWestFields,
  type Allotments,
  type Farmstead,
  type FieldLayout,
  type Hill,
  type LinePiece,
  type TreeSpot,
  type Turbine,
} from "./layout";

export const TURBINE_HEIGHT = 34;
export const WINDMILL_RY = 0.45;

function templates() {
  const box = template(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)); // base at y = 0
  const boxC = template(new BoxGeometry(1, 1, 1)); // centred
  const cyl8 = template(new CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0));
  const cyl12 = template(new CylinderGeometry(1, 1, 1, 12).translate(0, 0.5, 0));
  const cylC = template(new CylinderGeometry(1, 1, 1, 10)); // centred, for wheels and bales
  const tower = template(new CylinderGeometry(0.5, 1, 1, 10).translate(0, 0.5, 0));
  const millTower = template(new CylinderGeometry(0.65, 1, 1, 8).translate(0, 0.5, 0));
  const cone6 = template(new ConeGeometry(1, 1, 6).translate(0, 0.5, 0));
  const cone8 = template(new ConeGeometry(1, 1, 8).translate(0, 0.5, 0));
  const cone4 = template(new ConeGeometry(1, 1, 4).translate(0, 0.5, 0));
  const ico0 = template(new IcosahedronGeometry(1, 0));
  const ico1 = template(new IcosahedronGeometry(1, 1));
  const ico2 = template(new IcosahedronGeometry(1, 2));
  const tri = new Shape();
  tri.moveTo(-5.6, 0);
  tri.lineTo(5.6, 0);
  tri.lineTo(0, 3.8);
  tri.closePath();
  const prism = template(new ExtrudeGeometry(tri, { depth: 8, bevelEnabled: false }).translate(0, 0, -4));
  const barn = new Shape();
  BARN_PROFILE.forEach(([x, y], i) => (i ? barn.lineTo(x, y) : barn.moveTo(x, y)));
  barn.closePath();
  const barnBody = template(new ExtrudeGeometry(barn, { depth: 18, bevelEnabled: false }).translate(0, 0, -9));
  return { box, boxC, cyl8, cyl12, cylC, tower, millTower, cone6, cone8, cone4, ico0, ico1, ico2, prism, barnBody };
}
type T = ReturnType<typeof templates>;

const BARN_PROFILE: [number, number][] = [
  [-6, 0],
  [6, 0],
  [6, 5],
  [4.2, 7.8],
  [0, 9.2],
  [-4.2, 7.8],
  [-6, 5],
];

/** Crops and yards go in the flat (no shadow casting) builder; hedges and walls in the tall one. */
function addFields(flat: GeoBuilder, b: GeoBuilder, t: T, f: FieldLayout, rand: () => number) {
  for (const s of f.stripes) flat.add(t.box, jitter(s.color, rand(), 0.04), s.x, 0, s.z, s.sx, s.h, s.sz);
  for (const s of f.yard) flat.add(t.box, jitter(s.color, rand(), 0.03), s.x, 0, s.z, s.sx, s.h, s.sz);
  addPieces(b, t, f.pieces, rand);
  for (const bale of f.bales) b.add(t.cylC, jitter("#dcb54e", rand(), 0.06), bale.x, 0.85, bale.z, 0.85, 1.3, 0.85, bale.rot, 0, Math.PI / 2);
}

function addPieces(b: GeoBuilder, t: T, pieces: readonly LinePiece[], rand: () => number) {
  for (const p of pieces) {
    const ry = p.alongX ? 0 : Math.PI / 2;
    if (p.kind === "hedge") {
      const h = 1.3 + rand() * 0.6;
      b.add(t.box, jitter("#3f7a35", rand(), 0.12), p.x, 0, p.z, p.len, h, 1.3, ry);
      b.add(t.ico0, jitter("#4b8a3c", rand(), 0.12), p.x, h - 0.1, p.z, 1.2, 0.55 + rand() * 0.3, 0.8, ry + rand());
    } else {
      b.add(t.box, jitter("#a19c90", rand(), 0.2), p.x, 0, p.z, p.len, 0.75 + rand() * 0.2, 0.6, ry + (rand() - 0.5) * 0.04);
    }
  }
}

function addHills(b: GeoBuilder, t: T, hills: readonly Hill[], rand: () => number) {
  for (const h of hills) {
    b.add(t.ico2, jitter(rand() < 0.5 ? "#6fae4a" : "#62a144", rand(), 0.1), h.x, 0, h.z, h.r, h.h, h.r, rand() * 6.28);
  }
  // a few rocky outcrops on the front hills
  for (const h of hills.slice(0, 12)) {
    const a = rand() * 6.28;
    const d = h.r * (0.2 + rand() * 0.4);
    const x = h.x + Math.cos(a) * d;
    const z = h.z + Math.sin(a) * d;
    const y = h.h * Math.sqrt(Math.max(0, 1 - (d / h.r) ** 2));
    b.add(t.ico0, jitter("#9a968c", rand(), 0.15), x, y - 0.4, z, 1.6 + rand(), 1 + rand(), 1.4 + rand(), rand() * 6);
  }
}

function addFarmhouse(b: GeoBuilder, t: T, x: number = FARM.farmhouse.x, z: number = FARM.farmhouse.z, rot: number = FARM.farmhouse.rot) {
  b.setFrame(x, 0, z, rot);
  b.add(t.box, "#efe4cf", 0, 0, 0, 10, 5.4, 7);
  b.add(t.prism, "#566070", 0, 5.4, 0, 1, 1, 1.0);
  b.add(t.box, "#a5503a", 3.4, 6.2, 0.6, 1, 3.2, 1);
  b.add(t.box, "#a5503a", -3.4, 6.2, -0.6, 1, 3.2, 1);
  b.add(t.box, "#2f5d3a", 0, 0, 3.5, 1.4, 2.4, 0.2); // door
  b.add(t.box, "#3a3a3a", 0, 2.6, 3.7, 2.4, 0.15, 0.9); // porch canopy
  for (const wx of [-3, 3]) for (const wy of [1.3, 3.5]) {
    b.add(t.box, "#f8f4ea", wx, wy - 0.12, 3.5, 1.6, 1.5, 0.12);
    b.add(t.box, "#2c3e52", wx, wy, 3.56, 1.25, 1.2, 0.12);
  }
  for (const wx of [-3, 0, 3]) b.add(t.box, "#2c3e52", wx, 3.5, -3.56, 1.2, 1.2, 0.12);
  // little front garden hedge
  b.add(t.box, "#4a8a3c", -3.2, 0, 6, 3.5, 0.9, 0.9);
  b.add(t.box, "#4a8a3c", 3.2, 0, 6, 3.5, 0.9, 0.9);
  b.setFrame();
}

function addBarn(b: GeoBuilder, t: T, x: number = FARM.barn.x, z: number = FARM.barn.z, rot: number = FARM.barn.rot) {
  b.setFrame(x, 0, z, rot);
  b.add(t.barnBody, "#b8342a", 0, 0, 0);
  for (let i = 2; i < BARN_PROFILE.length; i++) {
    const [ax, ay] = BARN_PROFILE[i];
    const [bx, by] = BARN_PROFILE[(i + 1) % BARN_PROFILE.length];
    if (i === BARN_PROFILE.length - 1) break;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    const nx = dy / len;
    const ny = -dx / len;
    b.add(t.boxC, "#4a4c55", (ax + bx) / 2 + nx * 0.18, (ay + by) / 2 + ny * 0.18, 0, len + 0.45, 0.3, 19, 0, 0, Math.atan2(dy, dx));
  }
  // front doors with white trim and X braces
  for (const side of [9.05, -9.05]) {
    b.add(t.box, "#8f261f", 0, 0, side, 5.4, 4.6, 0.15);
    b.add(t.box, "#f4efe4", 0, 4.5, side * 1.006, 5.8, 0.3, 0.15);
    b.add(t.box, "#f4efe4", -2.75, 0, side * 1.006, 0.3, 4.7, 0.15);
    b.add(t.box, "#f4efe4", 2.75, 0, side * 1.006, 0.3, 4.7, 0.15);
    b.add(t.box, "#f4efe4", 0, 0, side * 1.006, 0.25, 4.6, 0.15);
    for (const sx of [-1.35, 1.35]) for (const a of [0.53, -0.53]) b.add(t.boxC, "#f4efe4", sx, 2.3, side * 1.008, 0.22, 5.3, 0.12, 0, 0, a);
    b.add(t.box, "#f4efe4", 0, 6.1, side * 1.006, 2.2, 1.9, 0.15); // hay loft frame
    b.add(t.box, "#8f261f", 0, 6.25, side * 1.01, 1.8, 1.6, 0.15);
  }
  // white corner trim
  for (const cx of [-6.02, 6.02]) for (const cz of [-9.02, 9.02]) b.add(t.box, "#f4efe4", cx, 0, cz, 0.25, 5, 0.25);
  b.add(t.cone6, "#4a4c55", 0, 9.3, 0, 0.8, 1.4, 0.8); // cupola
  b.add(t.box, "#f4efe4", 0, 9.1, 0, 1.0, 0.9, 1.0);
  b.setFrame();
}

function addSilos(b: GeoBuilder, t: T, x: number = FARM.silo.x, z: number = FARM.silo.z) {
  for (const [ox, oz, r, h] of [
    [0, 0, 3, 15],
    [5.6, -1.5, 2.2, 11],
  ]) {
    b.add(t.cyl12, "#cdd5da", x + ox, 0, z + oz, r, h, r);
    for (let y = 2.5; y < h; y += 3) b.add(t.cyl12, "#9eaab2", x + ox, y, z + oz, r + 0.06, 0.25, r + 0.06);
    b.add(t.ico1, "#8e9aa3", x + ox, h, z + oz, r * 1.02, r * 0.75, r * 1.02);
  }
  b.add(t.box, "#6f7a82", x + 3.1, 0, z + 0.6, 0.25, 14, 0.25); // ladder
}

function addYardProps(b: GeoBuilder, t: T, rand: () => number) {
  // conical haystacks + a stack of square bales
  for (const [hx, hz] of [
    [-316, 15],
    [-311.5, 18.5],
  ]) {
    b.add(t.cyl8, "#d4ab48", hx, 0, hz, 2.2, 1.6, 2.2);
    b.add(t.cone8, jitter("#dcb550", rand(), 0.05), hx, 1.6, hz, 2.5, 3.2, 2.5, rand());
  }
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 4 - row; i++)
      b.add(t.box, jitter("#e0bf5a", rand(), 0.06), -311 + i * 1.3 + row * 0.65, row * 0.62, 7, 1.25, 0.6, 0.65, 0.2);

  // tractor
  const tr = FARM.tractor;
  b.setFrame(tr.x, 0, tr.z, tr.rot);
  b.add(t.box, "#2f8f3d", 0, 0.7, 0.6, 1.4, 1.0, 2.6); // body/hood
  b.add(t.box, "#2f8f3d", 0, 0.7, -0.9, 1.7, 0.6, 1.4); // rear deck
  b.add(t.box, "#253038", 0, 1.3, -0.9, 1.5, 1.4, 1.3); // cab glass
  b.add(t.box, "#2f8f3d", 0, 2.7, -0.9, 1.7, 0.15, 1.5); // roof
  b.add(t.cyl8, "#333", 0.4, 1.6, 1.4, 0.07, 1.3, 0.07); // exhaust
  for (const s of [-1, 1]) {
    b.add(t.cylC, "#222", s * 1.05, 0.95, -1.0, 0.95, 0.55, 0.95, 0, 0, Math.PI / 2);
    b.add(t.cylC, "#f2c230", s * 1.1, 0.95, -1.0, 0.45, 0.5, 0.45, 0, 0, Math.PI / 2);
    b.add(t.cylC, "#222", s * 0.85, 0.5, 1.4, 0.5, 0.4, 0.5, 0, 0, Math.PI / 2);
  }
  b.setFrame();

  // wooden fence along the yard's west side
  for (let z = -2; z <= 12; z += 2.2) {
    b.add(t.box, "#7a5a3a", -324, 0, z, 0.2, 1.2, 0.2);
  }
  b.add(t.box, "#8a6a48", -324, 0.5, 5, 0.12, 0.15, 15.4);
  b.add(t.box, "#8a6a48", -324, 0.95, 5, 0.12, 0.15, 15.4);
}

function addPond(flat: GeoBuilder, b: GeoBuilder, t: T, rand: () => number) {
  const { x, z, r } = FARM.pond;
  flat.add(t.cyl12, "#7a6a4e", x, 0, z, r + 1.4, 0.05, r + 1.1);
  for (let i = 0; i < 26; i++) {
    const a = rand() * 6.28;
    if (a > 4 && a < 5.4) continue; // open bank on one side
    const d = r - 0.2 + rand() * 1.2;
    b.add(t.cone4, jitter("#4e7d34", rand(), 0.15), x + Math.cos(a) * d, 0, z + Math.sin(a) * d * 0.85, 0.12, 1.2 + rand() * 0.9, 0.12, rand());
  }
  for (let i = 0; i < 6; i++) {
    const a = rand() * 6.28;
    const d = rand() * r * 0.6;
    flat.add(t.cyl8, "#3f8f3a", x + Math.cos(a) * d, 0.1, z + Math.sin(a) * d * 0.8, 0.55, 0.03, 0.55);
  }
}

function addWindmillBody(b: GeoBuilder, t: T) {
  const { x, z } = FARM.windmill;
  b.setFrame(x, 0, z, WINDMILL_RY);
  b.add(t.cyl8, "#8f5a42", 0, 0, 0, 4.4, 1.2, 4.4); // brick base
  b.add(t.millTower, "#ece3cf", 0, 1.2, 0, 4, 12, 4);
  b.add(t.cyl8, "#6b4a32", 0, 5.6, 0, 4.4, 0.25, 4.4); // gallery
  b.add(t.cone8, "#5a3b2a", 0, 13.1, 0, 3.2, 3.6, 3.2);
  b.add(t.box, "#5a3b2a", 0, 0, 3.75, 1.4, 2.6, 0.4); // door
  b.add(t.box, "#2c3e52", 0, 8, 3.05, 0.8, 1, 0.3);
  b.add(t.box, "#2c3e52", 0, 10.6, 2.75, 0.7, 0.9, 0.3);
  b.add(t.box, "#5a3b2a", 0, 13.4, -2.9, 0.4, 0.4, 5); // tail pole
  b.setFrame();
}

function addTurbineTowers(b: GeoBuilder, t: T, turbines: readonly Turbine[]) {
  for (const tb of turbines) {
    const s = tb.scale;
    b.setFrame(tb.x, tb.y, tb.z, WINDMILL_RY);
    b.add(t.cyl8, "#c9c6bd", 0, -0.5, 0, 2.2 * s, 0.7, 2.2 * s);
    b.add(t.tower, "#f3f5f6", 0, 0, 0, 1.0 * s, TURBINE_HEIGHT * s, 1.0 * s);
    b.add(t.box, "#e9ecee", 0, TURBINE_HEIGHT * s - 0.6, 0.5 * s, 1.7 * s, 1.8 * s, 4.6 * s);
    b.add(t.box, "#ff6a1a", 0, TURBINE_HEIGHT * s + 1.15, 0.5 * s, 1.72 * s, 0.12, 2.0 * s); // Hamyway orange stripe
    b.setFrame();
  }
}

/** Rotor of a wind turbine: hub + nose + three tapered blades, spinning about local z. */
export function rotorGeometry(t: T) {
  const b = new GeoBuilder();
  b.add(t.ico1, "#eef0f1", 0, 0, 0, 0.9, 0.9, 1.1);
  b.add(t.cone8, "#eef0f1", 0, 0, 0.6, 0.85, 1.2, 0.85, 0, Math.PI / 2);
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3;
    b.add(t.cone4, "#f6f7f8", -Math.sin(a) * 0.6, Math.cos(a) * 0.6, 0, 0.55, 16, 0.14, 0, 0, a);
  }
  return b.build();
}

/** Windmill sails: two crossed stocks with lattice panels, spinning about local z. */
export function sailsGeometry(t: T) {
  const b = new GeoBuilder();
  b.add(t.ico0, "#5a3b2a", 0, 0, 0, 0.7, 0.7, 0.7);
  b.add(t.boxC, "#6b4a32", 0, 0, 0.1, 0.35, 21, 0.3);
  b.add(t.boxC, "#6b4a32", 0, 0, 0.1, 21, 0.35, 0.3);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const lx = 1.3;
    const ly = 6.2;
    b.add(t.boxC, "#f4efe2", lx * c - ly * s, lx * s + ly * c, 0.05, 2.2, 8.2, 0.1, 0, 0, a);
    for (let r = 2.6; r < 10.5; r += 1.6)
      b.add(t.boxC, "#6b4a32", 1.3 * c - r * s, 1.3 * s + r * c, 0.12, 2.4, 0.12, 0.1, 0, 0, a);
  }
  return b.build();
}

/** Tree parts: shared trunk plus one crown per species. Crowns sit with their base at y = 0. */
export function treeGeometries() {
  const trunk = new CylinderGeometry(0.7, 1, 1, 6).translate(0, 0.5, 0);
  const round = new IcosahedronGeometry(1, 1).translate(0, 1, 0);
  const conifer = (() => {
    const t = { cone: template(new ConeGeometry(1, 1, 7).translate(0, 0.5, 0)) };
    const b = new GeoBuilder();
    b.add(t.cone, "#ffffff", 0, 0, 0, 2.6, 4.4, 2.6);
    b.add(t.cone, "#ffffff", 0, 2.6, 0, 2.0, 3.8, 2.0, 0.4);
    b.add(t.cone, "#ffffff", 0, 4.9, 0, 1.35, 3.2, 1.35, 0.8);
    const g = b.build();
    g.deleteAttribute("color");
    return g;
  })();
  const poplar = new IcosahedronGeometry(1, 1).translate(0, 1, 0);
  return { trunk, crowns: [round, conifer, poplar] as BufferGeometry[] };
}

const TREE_COLORS = [
  ["#5f9e3f", "#4f8f3a", "#76ad47", "#6a9f3c", "#5a9a44", "#d9a23a", "#c9792e"],
  ["#2f6b3e", "#3a7a45", "#2a5f3a", "#356f40"],
  ["#6aa64a", "#83b84f", "#77ad48"],
];

/** Instance transforms for trunk and crowns. Matrices are written into the given arrays. */
export function treeMatrices(trees: readonly TreeSpot[]) {
  const m = new Matrix4();
  const out = {
    trunk: new Float32Array(trees.length * 16),
    crown: [[], [], []] as number[][],
    crownColor: [[], [], []] as string[][],
  };
  const p = new Vector3();
  const s = new Vector3();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  trees.forEach((t, i) => {
    const k = t.scale;
    q.setFromAxisAngle(up, t.rot);
    const [th, tr, cy, cr, ch] =
      t.species === 0 ? [2.6, 0.38, 2.0, 2.7, 2.4] : t.species === 1 ? [1.4, 0.32, 1.0, 1, 1] : [1.6, 0.26, 1.2, 1.25, 3.6];
    m.compose(p.set(t.x, t.y, t.z), q, s.set(tr * k, th * k, tr * k));
    m.toArray(out.trunk, i * 16);
    m.compose(p.set(t.x, t.y + cy * k, t.z), q, s.set(cr * k, ch * k, cr * k));
    out.crown[t.species].push(...m.elements);
    const palette = TREE_COLORS[t.species];
    // autumn colours are rare: only the last two of the oak palette, 6% of the time
    const idx = t.species === 0 && t.shade > 0.94 ? 5 + Math.floor((t.shade - 0.94) * 33) % 2 : Math.floor(t.shade * (t.species === 0 ? 5 : palette.length)) % palette.length;
    out.crownColor[t.species].push(palette[idx]);
  });
  return out;
}

export function waterGeometry() {
  const { r } = FARM.pond;
  const g = new CircleGeometry(r, 16);
  const pos = g.getAttribute("position");
  const rand = mulberry32(5);
  for (let i = 1; i < pos.count; i++) {
    const k = 0.86 + rand() * 0.14;
    pos.setXY(i, pos.getX(i) * k * 1.05, pos.getY(i) * k * 0.92);
  }
  // keep the seam closed
  pos.setXY(pos.count - 1, pos.getX(1), pos.getY(1));
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/** A SW farmstead: farmhouse, barn, silos and haystacks around its own yard. */
function addFarmstead(b: GeoBuilder, t: T, f: Farmstead, rand: () => number) {
  const c = Math.cos(f.rot);
  const sn = Math.sin(f.rot);
  const at = (lx: number, lz: number): [number, number] => [f.x + lx * c + lz * sn, f.z - lx * sn + lz * c];
  addFarmhouse(b, t, ...at(-9, -7), f.rot + 0.1);
  addBarn(b, t, ...at(9, 4), f.rot - 0.05);
  addSilos(b, t, ...at(-2, -15));
  for (const [lx, lz] of [
    [-12, 8],
    [-8, 11],
  ]) {
    const [hx, hz] = at(lx, lz);
    b.add(t.cyl8, "#d4ab48", hx, 0, hz, 2.0, 1.4, 2.0);
    b.add(t.cone8, jitter("#dcb550", rand(), 0.05), hx, 1.4, hz, 2.3, 3.0, 2.3, rand());
  }
}

const ALLOT_VEG = ["#4f9e3a", "#6fb848", "#3d8a3a", "#8fc75a", "#9a4a7a", "#c9a23a"];

function addAllotments(flat: GeoBuilder, b: GeoBuilder, t: T, a: Allotments, rand: () => number) {
  for (const site of a.sites) {
    // grass paths under the whole site
    flat.add(t.box, "#86b85a", (site.minX + site.maxX) / 2, 0, (site.minZ + site.maxZ) / 2, site.maxX - site.minX, 0.04, site.maxZ - site.minZ);
  }
  for (const p of a.plots) {
    flat.add(t.box, jitter("#6e4c30", rand(), 0.08), p.x, 0, p.z, p.w, 0.1, p.d);
    const veg = ALLOT_VEG[Math.floor(p.crop * ALLOT_VEG.length)];
    const across = p.rowsAlongX ? p.d : p.w;
    const n = Math.max(2, Math.floor(across / 1.3));
    for (let k = 0; k < n; k++) {
      if (p.shed && k === 0) continue; // the shed sits at the end of the plot
      const off = -across / 2 + (k + 0.5) * (across / n);
      const h = 0.18 + ((k * 7 + Math.floor(p.crop * 13)) % 4) * 0.08;
      if (p.rowsAlongX) flat.add(t.box, jitter(veg, rand(), 0.1), p.x, 0, p.z + off, p.w - 0.6, h, 0.6);
      else flat.add(t.box, jitter(veg, rand(), 0.1), p.x + off, 0, p.z, 0.6, h, p.d - 0.6);
    }
    if (p.shed) {
      const sx = p.rowsAlongX ? p.x : p.x - p.w / 2 + 1.1;
      const sz = p.rowsAlongX ? p.z - p.d / 2 + 1.2 : p.z;
      b.add(t.box, p.shed, sx, 0, sz, 1.8, 1.9, 1.7);
      b.add(t.boxC, "#3e3a36", sx, 2.05, sz, 2.1, 0.12, 2.0, 0, 0.12);
      b.add(t.cyl8, "#2f5a3a", sx + 1.25, 0, sz, 0.35, 0.9, 0.35); // water butt
    } else if (p.crop > 0.6) {
      // bean poles wigwam
      b.add(t.cone4, "#8a6a48", p.x, 0.1, p.z, 0.5, 2.0, 0.5, p.crop * 3);
    }
  }
  addPieces(b, t, a.hedges, rand);
}

export function buildCountryside() {
  const t = templates();
  const rand = mulberry32(99);
  const hills = makeHills();
  const turbines = makeTurbines(hills);
  const fields = makeFields();
  const farmsteads = makeFarmsteads();
  const sw = makeSouthWestFields(farmsteads);
  const allotments = makeAllotments();
  const trees = [...makeTrees(hills, turbines, 23, { extraBoxes: allotments.sites }), ...fields.hedgeTrees, ...sw.hedgeTrees];

  const flat = new GeoBuilder(); // receives shadows only
  const b = new GeoBuilder(); // casts shadows
  addHills(b, t, hills, rand);
  addFields(flat, b, t, fields, rand);
  addFields(flat, b, t, sw, rand);
  addFarmhouse(b, t);
  addBarn(b, t);
  addSilos(b, t);
  addYardProps(b, t, rand);
  addPond(flat, b, t, rand);
  addWindmillBody(b, t);
  addTurbineTowers(b, t, turbines);
  for (const f of farmsteads) addFarmstead(b, t, f, rand);
  addAllotments(flat, b, t, allotments, rand);

  return {
    staticGeo: b.build(),
    flatGeo: flat.build(),
    rotorGeo: rotorGeometry(t),
    sailsGeo: sailsGeometry(t),
    waterGeo: waterGeometry(),
    turbines,
    trees,
    pastures: [...fields.pastures, ...sw.pastures],
  };
}
