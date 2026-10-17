// Geometry builders for the Ground module. All geometry is built directly in world space with
// world-space UVs (xz / tile) and per-vertex colour multipliers for large-scale variation.
import * as THREE from "three";
import { RIVER, WATER_X, ZONES, type Box } from "../../config";
import { fbm, MOUTH_N, mulberry32, QUAY_N, QUAY_S, ribbonEdges, shoreX, smoothstep, WATER_Y } from "./noise";

export interface Rect extends Box {
  segX: number;
  segZ: number;
}

type ColorFn = (x: number, z: number, out: THREE.Color) => void;

/** One flat indexed grid (or several, concatenated) at height y. */
export function gridGeometry(rects: Rect[], y: number, tile: number, color: ColorFn): THREE.BufferGeometry {
  let nv = 0;
  let ni = 0;
  for (const r of rects) {
    nv += (r.segX + 1) * (r.segZ + 1);
    ni += r.segX * r.segZ * 6;
  }
  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const col = new Float32Array(nv * 3);
  const idx = new Uint32Array(ni);
  const c = new THREE.Color();
  let v = 0;
  let i = 0;
  for (const r of rects) {
    const base = v;
    for (let iz = 0; iz <= r.segZ; iz++) {
      const z = r.minZ + ((r.maxZ - r.minZ) * iz) / r.segZ;
      for (let ix = 0; ix <= r.segX; ix++) {
        const x = r.minX + ((r.maxX - r.minX) * ix) / r.segX;
        pos.set([x, y, z], v * 3);
        nrm.set([0, 1, 0], v * 3);
        uv.set([x / tile, -z / tile], v * 2);
        color(x, z, c);
        col.set([c.r, c.g, c.b], v * 3);
        v++;
      }
    }
    const row = r.segX + 1;
    for (let iz = 0; iz < r.segZ; iz++) {
      for (let ix = 0; ix < r.segX; ix++) {
        const a = base + iz * row + ix;
        const b = a + 1;
        const d = a + row;
        const e = d + 1;
        // Counter-clockwise seen from above (+y).
        idx.set([a, d, b, b, d, e], i);
        i += 6;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Macro variation for the meadow: broad light/dark swathes plus sun-bleached yellowish patches. */
export const meadowColor: ColorFn = (x, z, out) => {
  const n = fbm(x / 110, z / 110, 4, 3);
  const m = fbm(x / 40 + 50, z / 40 - 20, 3, 9);
  const k = 0.8 + 0.34 * n;
  const dry = smoothstep(0.55, 0.75, m);
  out.setRGB(k * (1 + 0.14 * dry), k * (1 + 0.02 * dry), k * (1 - 0.12 * dry));
};

/** Subtle variation for zone patches. */
export function patchColor(amount: number, seed: number): ColorFn {
  return (x, z, out) => {
    const n = fbm(x / 45, z / 45, 3, seed);
    const k = 1 - amount / 2 + amount * n;
    out.setRGB(k, k, k);
  };
}

/** The land extent: everything west of the beach, well past the camera far plane so the edge is never seen. */
export const LAND_FAR = 4000;
export const BEACH_INNER = WATER_X - 22;
const LAND_EAST = WATER_X - 18;
/** Inner edge of the paved embankment along the sea wall. Coastal zone patches stop here. */
export const EMBANK_X = WATER_X - 14;

export function landRects(): Rect[] {
  const inner = 1160;
  const coarse = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({
    minX, maxX, minZ, maxZ,
    segX: Math.max(1, Math.round((maxX - minX) / 120)),
    segZ: Math.max(1, Math.round((maxZ - minZ) / 120)),
  });
  return [
    // Detailed core over the playable world (~16 m cells for the macro colour variation).
    { minX: -inner, maxX: LAND_EAST, minZ: -inner, maxZ: inner, segX: 92, segZ: 145 },
    // Coarse surround out into the haze.
    coarse(-LAND_FAR, -inner, -LAND_FAR, LAND_FAR),
    coarse(-inner, LAND_EAST, -LAND_FAR, -inner),
    coarse(-inner, LAND_EAST, inner, LAND_FAR),
  ];
}

function rect(b: Box, pad: number, cell: number): Rect {
  const r = { minX: b.minX - pad, maxX: b.maxX + pad, minZ: b.minZ - pad, maxZ: b.maxZ + pad };
  return { ...r, segX: Math.max(1, Math.round((r.maxX - r.minX) / cell)), segZ: Math.max(1, Math.round((r.maxZ - r.minZ) / cell)) };
}

const coastal = (b: Box): Box => ({ ...b, maxX: Math.min(b.maxX, EMBANK_X) });

export const PATCHES = {
  // Downtown paving reaches the outer edge of the perimeter roads plus a sidewalk.
  downtown: rect(ZONES.downtown, 7, 12),
  countryside: rect(ZONES.countryside, 0, 10),
  depot: rect(ZONES.depot, 0, 10),
  suburbs: rect(ZONES.suburbs, 0, 10),
  docks: { ...rect(ZONES.docks, 0, 10), maxX: WATER_X },
  containerTerminal: rect(coastal(ZONES.containerTerminal), 0, 12),
  industrial: rect(coastal(ZONES.industrial), 0, 14),
  shoreditch: rect(coastal(ZONES.shoreditch), 0, 14),
  southbank: rect(ZONES.southbank, 0, 14),
  oldTown: rect(ZONES.oldTown, 0, 14),
  hampstead: rect(ZONES.hampstead, 0, 18),
};

/** The paved embankment strip on top of the sea wall, either side of the docks apron. */
export function embankmentRects(): Rect[] {
  const mk = (minZ: number, maxZ: number): Rect => ({ minX: EMBANK_X, maxX: WATER_X, minZ, maxZ, segX: 1, segZ: Math.round((maxZ - minZ) / 20) });
  return [mk(QUAY_N, ZONES.docks.minZ), mk(ZONES.docks.maxZ, QUAY_S)];
}

/** Darker kerb / hedge band peeking out around a patch. Vertex-coloured quads, one mesh. */
export function bordersGeometry(): THREE.BufferGeometry {
  const items: { r: Rect; color: string; pad: number }[] = [
    { r: PATCHES.downtown, color: "#6f6e6a", pad: 1.2 },
    { r: PATCHES.countryside, color: "#3f6e2a", pad: 1.6 },
    { r: PATCHES.depot, color: "#7a776f", pad: 1.2 },
    { r: PATCHES.suburbs, color: "#5d8f3c", pad: 1.0 },
    { r: PATCHES.southbank, color: "#6f6a60", pad: 1.2 },
    { r: PATCHES.oldTown, color: "#5f584e", pad: 1.4 },
    { r: PATCHES.shoreditch, color: "#555350", pad: 1.2 },
    { r: PATCHES.industrial, color: "#6b665c", pad: 2.5 },
    { r: PATCHES.hampstead, color: "#3a6a28", pad: 2.0 },
  ];
  const geos = items.map(({ r, color, pad }) => {
    const c = new THREE.Color(color);
    return gridGeometry(
      [{ minX: r.minX - pad, maxX: r.maxX + pad, minZ: r.minZ - pad, maxZ: r.maxZ + pad, segX: 1, segZ: 1 }],
      0.005,
      1,
      (_x, _z, out) => out.copy(c),
    );
  });
  const merged = concat(geos);
  for (const g of geos) g.dispose();
  return merged;
}

/** Quay edge details along the docks: dark coping at the lip and the yellow safety line. */
export function quayLinesGeometry(): THREE.BufferGeometry {
  // Coping runs the full sea wall; the yellow line marks the working quays (docks + container terminal).
  const z0 = ZONES.docks.minZ;
  const z1 = ZONES.containerTerminal.maxZ;
  const coping = new THREE.Color("#6b7075");
  const yellow = new THREE.Color("#f5c518");
  const geos = [
    gridGeometry([{ minX: WATER_X - 0.9, maxX: WATER_X, minZ: QUAY_N, maxZ: QUAY_S, segX: 1, segZ: 1 }], 0.011, 1, (_x, _z, o) => o.copy(coping)),
    gridGeometry([{ minX: WATER_X - 2.6, maxX: WATER_X - 2.0, minZ: z0 + 0.6, maxZ: z1 - 0.6, segX: 1, segZ: 1 }], 0.012, 1, (_x, _z, o) => o.copy(yellow)),
  ];
  const merged = concat(geos);
  for (const g of geos) g.dispose();
  return merged;
}

/** Concatenate non-indexed or indexed geometries sharing position/normal/uv/color. */
function concat(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ["position", "normal", "uv", "color"] as const;
  const out = new THREE.BufferGeometry();
  let nv = 0;
  let ni = 0;
  for (const g of geos) {
    nv += g.getAttribute("position").count;
    ni += g.getIndex()!.count;
  }
  for (const name of names) {
    const size = geos[0].getAttribute(name).itemSize;
    const arr = new Float32Array(nv * size);
    let o = 0;
    for (const g of geos) {
      const a = g.getAttribute(name).array as Float32Array;
      arr.set(a, o);
      o += a.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx = new Uint32Array(ni);
  let io = 0;
  let vo = 0;
  for (const g of geos) {
    const ix = g.getIndex()!.array;
    for (let k = 0; k < ix.length; k++) idx[io + k] = ix[k] + vo;
    io += ix.length;
    vo += g.getAttribute("position").count;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------------------------------------
// Beach: a strip sloping from the meadow down under the sea, following shoreX(z).

const BEACH_COLS: { off: number | "inner"; y: number; color: string; jitter: number }[] = [
  { off: "inner", y: 0.004, color: "#7aaa4c", jitter: 0 }, // meets the meadow
  { off: -10, y: 0.006, color: "#b8c27a", jitter: 0 }, // dune grass into sand
  { off: -7, y: 0.06, color: "#ead9a0", jitter: 0.05 }, // dry sand, slight dune crest
  { off: -3.5, y: 0.0, color: "#e2cd8f", jitter: 0.04 },
  { off: -1.2, y: -0.14, color: "#c9ae74", jitter: 0.03 }, // wet sand
  { off: 0, y: WATER_Y, color: "#b3965f", jitter: 0 }, // waterline
  { off: 4, y: -0.75, color: "#9c8152", jitter: 0.05 },
  { off: 14, y: -1.7, color: "#7f6a45", jitter: 0 },
  { off: 32, y: -2.8, color: "#5f5038", jitter: 0 },
];

function beachStrip(z0: number, z1: number, step: number, rng: () => number): THREE.BufferGeometry {
  const rows = Math.max(1, Math.round(Math.abs(z1 - z0) / step));
  const cols = BEACH_COLS.length;
  const pos = new Float32Array((rows + 1) * cols * 3);
  const col = new Float32Array((rows + 1) * cols * 3);
  const c = new THREE.Color();
  let v = 0;
  for (let r = 0; r <= rows; r++) {
    const z = z0 + ((z1 - z0) * r) / rows;
    const sx = shoreX(z);
    const shade = 0.92 + 0.14 * fbm(z / 30, 4.2, 3, 5);
    for (let k = 0; k < cols; k++) {
      const bc = BEACH_COLS[k];
      const x = bc.off === "inner" ? BEACH_INNER : sx + bc.off;
      const edgeRow = r === 0 || r === rows;
      const y = bc.y + (edgeRow ? 0 : (rng() - 0.5) * 2 * bc.jitter);
      pos.set([x, y, z], v * 3);
      c.set(bc.color).multiplyScalar(k === 0 ? 1 : shade * (0.96 + rng() * 0.08));
      col.set([c.r, c.g, c.b], v * 3);
      v++;
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols - 1; k++) {
      const a = r * cols + k;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      // Winding chosen so faces point up regardless of z direction.
      if (z1 > z0) idx.push(a, d, b, b, d, e);
      else idx.push(a, b, d, b, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  // Faceted low-poly look: split vertices and use face normals.
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  flat.computeBoundingSphere();
  return flat;
}

export function beachGeometry(): THREE.BufferGeometry {
  const rng = mulberry32(99);
  const north = beachStrip(MOUTH_N, -LAND_FAR, 6, rng);
  const south = beachStrip(QUAY_S, LAND_FAR, 6, rng);
  const pos = new Float32Array([...(north.getAttribute("position").array as Float32Array), ...(south.getAttribute("position").array as Float32Array)]);
  const nrm = new Float32Array([...(north.getAttribute("normal").array as Float32Array), ...(south.getAttribute("normal").array as Float32Array)]);
  const col = new Float32Array([...(north.getAttribute("color").array as Float32Array), ...(south.getAttribute("color").array as Float32Array)]);
  north.dispose();
  south.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Rocks: one InstancedMesh of faceted boulders along the waterline, riprap at the quay corners and foot.

export function buildRocks(): THREE.InstancedMesh {
  const rng = mulberry32(1234);
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.92, flatShading: true });
  const palette = ["#8b8680", "#7a756e", "#9a948a", "#6d6a66", "#a39a8a"].map((h) => new THREE.Color(h));
  const items: { x: number; y: number; z: number; s: number; sy: number }[] = [];

  // Scattered clusters along the beaches within the visible world.
  const beachRuns: [number, number, number][] = [
    [QUAY_S + 4, 1250, 1],
    [-MOUTH_N + 4, 1250, -1],
  ];
  for (const [from, to, sign] of beachRuns) {
    for (let z = from; z < to; z += 3 + rng() * 9) {
      if (rng() < 0.45) continue;
      const zz = sign * z;
      const n = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const s = 0.4 + rng() * 1.3;
        items.push({ x: shoreX(zz) - 1.5 + rng() * 4, y: WATER_Y - 0.15 + rng() * 0.2, z: zz + (rng() - 0.5) * 4, s, sy: s * (0.5 + rng() * 0.4) });
      }
    }
  }
  // Riprap packed around the sea wall ends and the beach end at the river mouth.
  const corners: [number, number][] = [
    [QUAY_S, 1],
    [QUAY_N, -1],
    [MOUTH_N, 1],
  ];
  for (const [cz, dir] of corners) {
    for (let k = 0; k < 26; k++) {
      const s = 0.9 + rng() * 1.4;
      items.push({ x: WATER_X - 8 + rng() * 10, y: WATER_Y - 0.3 + rng() * 0.4, z: cz + dir * (0.5 + rng() * 9), s, sy: s * 0.7 });
    }
  }
  // Toe of the sea wall, just breaking the surface.
  for (let z = QUAY_N + 2; z < QUAY_S; z += 2.5 + rng() * 4) {
    const s = 0.6 + rng() * 0.8;
    items.push({ x: WATER_X + 0.6 + rng() * 1.2, y: WATER_Y - 0.5 * s, z, s, sy: s * 0.8 });
  }

  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  items.forEach((it, i) => {
    e.set(rng() * Math.PI, rng() * Math.PI * 2, rng() * Math.PI);
    q.setFromEuler(e);
    m.compose(p.set(it.x, it.y, it.z), q, sc.set(it.s * (0.8 + rng() * 0.5), it.sy, it.s * (0.8 + rng() * 0.5)));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, palette[Math.floor(rng() * palette.length)]);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// Riverbed: a muddy ribbon under the river polyline, wider than the water, darker in the channel.

const RIVER_COLS: { off: number; k: number }[] = [
  { off: -1, k: 1.25 }, // drier bank edge (+margin)
  { off: -0.5, k: 1.05 },
  { off: 0, k: 0.72 }, // deep channel
  { off: 0.5, k: 1.05 },
  { off: 1, k: 1.25 },
];

export function riverbedGeometry(margin = 9): THREE.BufferGeometry {
  // Extend the bed west into the haze; stop it at the land edge so it never floats over the sea.
  const pts: [number, number][] = [[-LAND_FAR, RIVER.points[0][1]], ...RIVER.points.filter(([x]) => x < LAND_EAST)];
  const last = RIVER.points.find(([x]) => x >= LAND_EAST);
  if (last) {
    const prev = pts[pts.length - 1];
    const t = (LAND_EAST - prev[0]) / (last[0] - prev[0]);
    pts.push([LAND_EAST, prev[1] + (last[1] - prev[1]) * t]);
  }
  const half = RIVER.width / 2;
  const edges = RIVER_COLS.map((c) => {
    const w = c.off === 0 ? 0 : Math.abs(c.off) === 1 ? half + margin : half * 0.75;
    if (w === 0) return pts;
    const [l, r] = ribbonEdges(pts, w);
    return c.off < 0 ? r : l;
  });
  const rows = pts.length;
  const cols = RIVER_COLS.length;
  const pos = new Float32Array(rows * cols * 3);
  const nrm = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const col = new Float32Array(rows * cols * 3);
  let v = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [x, z] = edges[c][r];
      pos.set([x, 0.006, z], v * 3);
      nrm.set([0, 1, 0], v * 3);
      uv.set([x / 16, -z / 16], v * 2);
      const k = RIVER_COLS[c].k;
      col.set([k, k, k], v * 3);
      v++;
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      idx.push(a, b, d, b, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
