// Shipping: procedural geometry. Every ship is ONE merged vertex-coloured mesh (hull, deck, hatch covers, lashing
// bridges, accommodation, funnel, masts, lifeboats) + one emissive "windows" mesh + one name/brand decal mesh.
// Ship-local frame: +z = bow, +x = port, y = 0 at the design waterline-ish (sea is at y = -0.25).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  CONTRACT_BAYS,
  BAY_PITCH,
  HATCH_TOP,
  KEEL,
  MAIN_DECK,
  bayZ,
  type Livery,
  type ShipLayout,
  type VesselClass,
} from "./fleet";
import { TUG_HALF } from "./tugs";

const _c = new THREE.Color();

/** Non-indexed, uv-less, vertex-coloured copy of a geometry (so everything merges). */
export function paint(g: THREE.BufferGeometry, color: string | THREE.Color): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g.clone();
  if (g.index) g.dispose();
  n.deleteAttribute("uv");
  if (!n.getAttribute("normal")) n.computeVertexNormals();
  const count = n.getAttribute("position").count;
  const col = new Float32Array(count * 3);
  if (typeof color === "string") _c.set(color);
  else _c.copy(color);
  for (let i = 0; i < count; i++) {
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  n.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return n;
}

export function box(w: number, h: number, d: number, x: number, y: number, z: number, color: string, ry = 0, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return paint(g, color);
}

function cyl(r0: number, r1: number, h: number, x: number, y: number, z: number, color: string, seg = 8) {
  const g = new THREE.CylinderGeometry(r0, r1, h, seg);
  g.translate(x, y + h / 2, z);
  return paint(g, color);
}

/** Triangle soup builder with outward-facing winding fixed from a hint direction. */
class Soup {
  pos: number[] = [];
  col: number[] = [];
  tri(a: number[], b: number[], c: number[], color: THREE.Color, hint: number[]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const area = Math.hypot(nx, ny, nz);
    if (area < 1e-6) return;
    const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0;
    const pts = flip ? [a, c, b] : [a, b, c];
    for (const p of pts) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(color.r, color.g, color.b);
    }
  }
  quad(a: number[], b: number[], c: number[], d: number[], color: THREE.Color, hint: number[]) {
    this.tri(a, b, c, color, hint);
    this.tri(a, c, d, color, hint);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Deck height along the ship: a raised forecastle with sheer at the bow, slight rise aft. */
export function deckY(L: ShipLayout, z: number) {
  return MAIN_DECK + 2.8 * sstep(L.bowStart + 6, L.half, z) + 0.5 * sstep(-L.half + 18, -L.half, z);
}

/** Hull half-width at ship-local z and height y. */
export function hullHalfWidth(L: ShipLayout, z: number, y: number) {
  const yn = (y - KEEL) / (MAIN_DECK - KEEL);
  const ync = Math.min(1, Math.max(0, yn));
  let base = L.beam / 2;
  if (y < KEEL + 0.5) base -= 2.6;
  else if (y < KEEL + 2.5) base -= 0.5;
  // bow: raked stem (keel tip further aft), finer entry low down, flare up high
  const tip = L.half - 10 * (1 - ync);
  if (z > L.bowStart) {
    const u = (z - L.bowStart) / Math.max(1, tip - L.bowStart);
    if (u >= 1) return 0;
    const p = 1.4 + 1.6 * ync;
    return base * Math.pow(1 - Math.pow(u, p), 0.62);
  }
  // stern: transom up high, cut away under water for the propeller
  const up = sstep(0.35, 0.8, yn);
  const end = -L.half + 18 * (1 - up) - 5 * up; // transom: upper levels run out past the stern
  if (z < L.sternStart) {
    const u = (L.sternStart - z) / Math.max(1, L.sternStart - end);
    if (u >= 1) return 0;
    const lower = Math.pow(1 - Math.pow(u, 1.8), 0.7);
    const upper = 1 - 0.3 * u * u;
    return base * (lower + (upper - lower) * sstep(0.45, 0.85, yn));
  }
  return base;
}

function stations(L: ShipLayout) {
  const zs = new Set<number>();
  for (let z = -L.half; z <= L.half; z += 6) zs.add(Math.round(z * 100) / 100);
  for (let z = L.bowStart; z <= L.half; z += 1.5) zs.add(Math.round(z * 100) / 100);
  for (let z = -L.half; z <= L.sternStart; z += 2) zs.add(Math.round(z * 100) / 100);
  zs.add(L.half);
  zs.add(-L.half);
  return [...zs].sort((a, b) => a - b);
}

/** The hull: lofted sides in colour bands (antifouling red, dark boot-top, topside livery), deck and transom. */
export function hullGeometry(L: ShipLayout, liv: Livery) {
  const s = new Soup();
  const zs = stations(L);
  const red = new THREE.Color(liv.antifoul), boot = new THREE.Color("#1b1d22"), top = new THREE.Color(liv.hull), deck = new THREE.Color(liv.deck);
  const white = new THREE.Color("#f2f0ea");
  const bands: { ys: (z: number) => number[]; color: THREE.Color }[] = [
    { ys: () => [KEEL, KEEL + 0.4, KEEL + 2.5, -2.5, 0.9], color: red },
    { ys: () => [0.9, 1.5], color: boot },
    { ys: (z) => [1.5, deckY(L, z) - 0.55], color: top },
    { ys: (z) => [deckY(L, z) - 0.55, deckY(L, z)], color: white },
  ];
  for (const band of bands) {
    for (let i = 0; i < zs.length - 1; i++) {
      const z0 = zs[i], z1 = zs[i + 1];
      const y0 = band.ys(z0), y1 = band.ys(z1);
      for (let j = 0; j < y0.length - 1; j++) {
        const w00 = hullHalfWidth(L, z0, y0[j]), w01 = hullHalfWidth(L, z0, y0[j + 1]);
        const w10 = hullHalfWidth(L, z1, y1[j]), w11 = hullHalfWidth(L, z1, y1[j + 1]);
        for (const side of [1, -1]) {
          s.quad(
            [side * w00, y0[j], z0], [side * w10, y1[j], z1], [side * w11, y1[j + 1], z1], [side * w01, y0[j + 1], z0],
            band.color, [side, 0, 0],
          );
        }
      }
    }
  }
  // deck
  for (let i = 0; i < zs.length - 1; i++) {
    const z0 = zs[i], z1 = zs[i + 1];
    const y0 = deckY(L, z0), y1 = deckY(L, z1);
    const w0 = hullHalfWidth(L, z0, y0), w1 = hullHalfWidth(L, z1, y1);
    s.quad([w0, y0, z0], [w1, y1, z1], [-w1, y1, z1], [-w0, y0, z0], deck, [0, 1, 0]);
  }
  // transom
  const z = -L.half;
  const ys = [KEEL, KEEL + 2.5, -2.5, 0.9, 1.5, deckY(L, z) - 0.55, deckY(L, z)];
  const cols = [red, red, red, boot, top, white];
  for (let j = 0; j < ys.length - 1; j++) {
    const w0 = hullHalfWidth(L, z, ys[j]), w1 = hullHalfWidth(L, z, ys[j + 1]);
    s.quad([w0, ys[j], z], [-w0, ys[j], z], [-w1, ys[j + 1], z], [w1, ys[j + 1], z], cols[j], [0, 0, -1]);
  }
  const g = s.build();
  // bulbous bow, just breaking the surface
  const bulb = new THREE.SphereGeometry(1, 12, 8);
  bulb.scale(2.3, 2.1, 7.5);
  bulb.translate(0, -1.9, L.half - 6.5);
  return [g, paint(bulb, liv.antifoul)];
}

/** Hatch covers, lashing bridges, breakwater, accommodation, funnel, masts, lifeboats, deck gear. */
export function topsideGeometry(cls: VesselClass, L: ShipLayout, liv: Livery): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const hw = L.beam / 2;
  const bays: number[] = [];
  for (let k = 0; k < CONTRACT_BAYS; k++) bays.push(bayZ(k));
  bays.push(...L.decoBays);
  // hatch covers (top at HATCH_TOP, where the boxes sit) with a lighter rim
  for (const z of bays) {
    parts.push(box(L.beam - 1.6, HATCH_TOP - MAIN_DECK, 12.2, 0, (HATCH_TOP + MAIN_DECK) / 2, z, liv.hatch));
    parts.push(box(L.beam - 1.2, 0.35, 0.35, 0, HATCH_TOP - 0.2, z + 6.1, "#8b949c"));
  }
  // lashing bridges between adjacent bays (two tiers high), with posts and rails
  const sorted = [...bays].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (Math.abs(sorted[i + 1] - sorted[i] - BAY_PITCH) > 0.5) continue;
    const z = (sorted[i] + sorted[i + 1]) / 2;
    const top = HATCH_TOP + 5.2;
    parts.push(box(L.beam - 1, 0.25, 0.34, 0, top, z, "#d8d4c6"));
    parts.push(box(L.beam - 1, 0.12, 0.3, 0, top - 2.6, z, "#d8d4c6"));
    for (const x of [-hw + 1, -hw / 2, 0, hw / 2, hw - 1]) parts.push(box(0.26, 5.2, 0.3, x, HATCH_TOP + 2.6, z, "#c9c4b4"));
  }
  const fwdMost = Math.max(...bays) + 6.3;
  // breakwater in front of the foremost bay
  const bwz = fwdMost + 2.2;
  for (const s of [1, -1]) parts.push(box(hw + 1, 3.4, 0.5, (s * hw) / 2, MAIN_DECK + 1.7, bwz + 1.2, liv.house, s * 0.28));
  // forecastle gear: windlasses, bollards, foremast with a crosstree
  const fz = L.half - 14;
  const fy = deckY(L, fz);
  for (const s of [1, -1]) parts.push(box(2.2, 1.4, 3.2, s * 4.5, fy + 0.7, L.half - 9, "#2d3238"));
  parts.push(cyl(0.32, 0.4, 13, 0, fy, fz, "#f2f0ea"));
  parts.push(box(4.5, 0.25, 0.25, 0, fy + 10.5, fz, "#f2f0ea"));
  // accommodation block
  const h = L.house;
  const hy0 = MAIN_DECK, hy1 = L.bridgeY;
  const hlen = h.z1 - h.z0;
  const houseW = cls.id === "feeder" ? L.beam - 6 : L.beam - 5;
  parts.push(box(houseW, hy1 - hy0, hlen, 0, (hy0 + hy1) / 2, (h.z0 + h.z1) / 2, liv.house));
  // stepped decks (tiers of balconies) on the back of the house
  for (let k = 1; k < 4; k++) parts.push(box(houseW + 0.6, 0.25, 1.4, 0, hy0 + k * 2.8, h.z0 - 0.4, "#d9d6cd"));
  // wheelhouse with wing bridges out to the ship's side + roof
  const wz = h.z1 - 3.6;
  parts.push(box(L.beam + 2.4, 3, 7.2, 0, hy1 + 1.5, wz, liv.house));
  parts.push(box(L.beam + 2.9, 0.35, 7.8, 0, hy1 + 3.18, wz, "#d9d6cd"));
  // wing bridge undersides (brackets)
  for (const s of [1, -1]) parts.push(box(1.2, 2.4, 1.2, s * (hw + 0.6), hy1 - 1.1, wz, "#c9c6bd"));
  // radar mast on the wheelhouse roof
  parts.push(box(0.4, 7.5, 0.4, 0, hy1 + 3.3 + 3.75, wz - 1.5, "#f2f0ea"));
  parts.push(box(6.5, 0.25, 0.3, 0, hy1 + 9.2, wz - 1.5, "#f2f0ea"));
  parts.push(box(4.2, 0.28, 0.7, 0, hy1 + 7.2, wz - 1.5, "#2d3238"));
  parts.push(box(2.6, 0.22, 0.6, 0, hy1 + 5.4, wz - 2.6, "#2d3238"));
  // lifeboats on davits each side of the house
  for (const s of [1, -1]) {
    parts.push(box(2.4, 2.2, 7.5, s * (houseW / 2 + 1.4), hy0 + 6.3, (h.z0 + h.z1) / 2 - 1, "#ff7a1a"));
    parts.push(box(0.3, 3.2, 0.3, s * (houseW / 2 + 0.3), hy0 + 7.2, (h.z0 + h.z1) / 2 - 4, "#c9c6bd"));
    parts.push(box(0.3, 3.2, 0.3, s * (houseW / 2 + 0.3), hy0 + 7.2, (h.z0 + h.z1) / 2 + 2, "#c9c6bd"));
  }
  // funnel: on the after end of the house (classic), or its own engine house (giant)
  const f = L.funnel;
  const flen = f.z1 - f.z0;
  const fz0 = (f.z0 + f.z1) / 2;
  let fBase = MAIN_DECK;
  if (!f.onHouse) {
    parts.push(box(L.beam - 6, 8, flen + 1, 0, MAIN_DECK + 4, fz0, liv.house));
    fBase = MAIN_DECK + 8;
  }
  const fTop = Math.max(hy1 + 6.5, fBase + 10);
  const fw = cls.id === "giant" ? 9 : cls.id === "feeder" ? 5.5 : 7;
  const funnelBand = (y0: number, y1: number, color: string) => {
    const g = new THREE.BoxGeometry(fw, y1 - y0, flen);
    g.translate(0, (y0 + y1) / 2, 0);
    // rake the funnel aft
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - (p.getY(i) - fBase) * 0.12);
    g.translate(0, 0, fz0);
    parts.push(paint(g, color));
  };
  funnelBand(fBase, fTop - 4.2, liv.funnel);
  funnelBand(fTop - 4.2, fTop - 2.4, liv.stripe);
  funnelBand(fTop - 2.4, fTop - 0.9, liv.funnel);
  funnelBand(fTop - 0.9, fTop, "#16181b");
  // stern gear: freefall lifeboat on its ramp, mooring winches, flag staff
  const sz = -L.half + 6;
  const sy = deckY(L, sz);
  parts.push(box(3, 3, 8.5, 0, sy + 2.6, sz + 2, "#ff7a1a", 0, -0.45));
  for (const s of [1, -1]) parts.push(box(2.2, 1.3, 2.8, s * 6, sy + 0.65, -L.half + 12, "#2d3238"));
  parts.push(box(0.15, 5, 0.15, 0, sy + 2.5, -L.half + 0.6, "#f2f0ea"));
  return parts;
}

/** Window bands on every house level, wraparound bridge glazing and deck floodlights (emissive at night). */
export function windowGeometry(cls: VesselClass, L: ShipLayout): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const h = L.house;
  const houseW = cls.id === "feeder" ? L.beam - 6 : L.beam - 5;
  const hlen = h.z1 - h.z0;
  const zc = (h.z0 + h.z1) / 2;
  for (let y = MAIN_DECK + 1.9; y < L.bridgeY - 0.8; y += 2.8) {
    parts.push(box(houseW + 0.12, 0.85, 0.12, 0, y, h.z1 + 0.01, "#ffffff"));
    parts.push(box(houseW - 2, 0.85, 0.12, 0, y, h.z0 - 0.01, "#ffffff"));
    parts.push(box(0.12, 0.85, hlen - 2, houseW / 2 + 0.01, y, zc, "#ffffff"));
    parts.push(box(0.12, 0.85, hlen - 2, -houseW / 2 - 0.01, y, zc, "#ffffff"));
  }
  // bridge windows (all round, slightly proud of the wheelhouse)
  parts.push(box(L.beam + 2.5, 1.3, 7.3, 0, L.bridgeY + 1.95, h.z1 - 3.6, "#ffffff"));
  // floodlights on the lashing bridges
  const bays: number[] = [];
  for (let k = 0; k < CONTRACT_BAYS; k++) bays.push(bayZ(k));
  bays.push(...L.decoBays);
  bays.sort((a, b) => a - b);
  for (let i = 0; i < bays.length - 1; i += 2) {
    const z = (bays[i] + bays[i + 1]) / 2;
    for (const s of [1, -1]) parts.push(box(0.7, 0.45, 0.5, s * (L.beam / 2 - 1.4), HATCH_TOP + 5.6, z, "#ffffff"));
  }
  // mast-top lamp housings
  parts.push(box(0.6, 0.6, 0.6, 0, L.bridgeY + 11.3, h.z1 - 5.1, "#ffffff"));
  return mergeGeometries(parts, false)!;
}

/** Name + brand decal planes. UVs: brand in the top half of the texture, name in the bottom half. */
export function decalGeometry(L: ShipLayout, brandLen: number) {
  const parts: THREE.BufferGeometry[] = [];
  const plane = (w: number, hgt: number, v0: number, v1: number) => {
    const g = new THREE.PlaneGeometry(w, hgt);
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
    return g;
  };
  const hw = L.beam / 2 + 0.06;
  // brand along the midbody, both sides
  const bw = Math.min(110, 9 * brandLen + 10);
  const by = 1.5 + (MAIN_DECK - 0.55 - 1.5) / 2;
  parts.push(plane(bw, 2.9, 0.5, 1).rotateY(Math.PI / 2).translate(hw, by, -6));
  parts.push(plane(bw, 2.9, 0.5, 1).rotateY(-Math.PI / 2).translate(-hw, by, -6));
  // name at the bow, both sides, and across the transom
  const nz = L.bowStart - 16;
  parts.push(plane(26, 1.5, 0, 0.5).rotateY(Math.PI / 2).translate(hw, 3.25, nz));
  parts.push(plane(26, 1.5, 0, 0.5).rotateY(-Math.PI / 2).translate(-hw, 3.25, nz));
  const tw = hullHalfWidth(L, -L.half, 3) * 2 - 1;
  parts.push(plane(Math.min(18, tw), 1.1, 0, 0.5).rotateY(Math.PI).translate(0, 3.1, -L.half - 0.06));
  for (const p of parts) p.deleteAttribute("normal");
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  return g;
}

export function decalTexture(name: string, brand: string, color: string) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "900 108px Arial Black, Arial, Helvetica, sans-serif";
  // brand, letter-spaced, top half
  const letters = brand.split("");
  const spacing = Math.min(118, 980 / letters.length);
  letters.forEach((ch, i) => g.fillText(ch, 512 + (i - (letters.length - 1) / 2) * spacing, 66));
  g.font = "bold 84px Arial, Helvetica, sans-serif";
  g.fillText(name, 512, 192, 1000);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The whole ship (minus containers): hull + topside merged into one geometry. */
export function shipGeometry(cls: VesselClass, L: ShipLayout, liv: Livery) {
  const parts = [...hullGeometry(L, liv), ...topsideGeometry(cls, L, liv)];
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

// ---------- containers ----------

export const ATLAS_TILES = 8;

/** Container box with UVs: long sides show the full tile (brand lettering), top/ends only a plain strip. */
export function containerGeometry() {
  const g = new THREE.BoxGeometry(2.44, 2.59, 12.19);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  // face order: +x, -x, +y, -y, +z, -z; 4 verts each
  for (let f = 2; f < 6; f++) for (let k = 0; k < 4; k++) uv.setY(f * 4 + k, uv.getY(f * 4 + k) * 0.14);
  return g;
}

/** Atlas: R = body shade (corrugation + frame), G = lettering mask. Tile 0 is plain. */
export function containerAtlas(brands: readonly string[]) {
  const tw = 384, th = 96;
  const c = document.createElement("canvas");
  c.width = tw * ATLAS_TILES;
  c.height = th;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgb(0,0,0)";
  g.fillRect(0, 0, c.width, c.height);
  for (let t = 0; t < ATLAS_TILES; t++) {
    const x0 = t * tw;
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "rgb(225,0,0)";
    g.fillRect(x0, 0, tw, th);
    for (let x = 4; x < tw - 4; x += 7) {
      g.fillStyle = "rgb(250,0,0)";
      g.fillRect(x0 + x, 3, 3, th - 6);
      g.fillStyle = "rgb(190,0,0)";
      g.fillRect(x0 + x + 3, 3, 1, th - 6);
    }
    g.fillStyle = "rgb(150,0,0)";
    g.fillRect(x0, 0, tw, 3);
    g.fillRect(x0, th - 3, tw, 3);
    g.fillRect(x0, 0, 4, th);
    g.fillRect(x0 + tw - 4, 0, 4, th);
    const name = brands[t];
    if (name) {
      g.globalCompositeOperation = "lighter";
      g.fillStyle = "rgb(0,255,0)";
      g.font = "900 46px Arial Black, Arial, Helvetica, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(name, x0 + tw / 2, th / 2 + 2, tw - 40);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  return tex;
}

/** Container material: instance colour × corrugation, brand lettering in white (or navy on light boxes). */
export function containerMaterial(atlas: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ color: "#ffffff", map: atlas, roughness: 0.75, metalness: 0.1 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aTile;")
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vec2((vMapUv.x + aTile) / ${ATLAS_TILES}.0, vMapUv.y);\n#endif`,
      );
    sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "").replace(
      "#include <color_fragment>",
      `#if defined( USE_MAP ) && ( defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) )
  vec4 txl = texture2D( map, vMapUv );
  vec3 bodyCol = diffuseColor.rgb * vColor.rgb * (0.35 + 0.65 * txl.r);
  float lum = dot( vColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
  vec3 inkCol = lum > 0.45 ? vec3( 0.03, 0.05, 0.12 ) : vec3( 0.92 );
  diffuseColor.rgb = mix( bodyCol, inkCol, txl.g );
#else
  #include <color_fragment>
#endif`,
    );
  };
  m.customProgramCacheKey = () => "ship-container-v1";
  return m;
}

// ---------- tugs, pilot boats, pontoons ----------

function outline(len: number, beam: number, bowLen: number) {
  const s = new THREE.Shape();
  const hl = len / 2, hb = beam / 2;
  s.moveTo(-hb, -hl);
  s.lineTo(hb, -hl);
  s.lineTo(hb, hl - bowLen);
  s.quadraticCurveTo(hb, hl, 0, hl);
  s.quadraticCurveTo(-hb, hl, -hb, hl - bowLen);
  s.lineTo(-hb, -hl);
  return s;
}

function hullSlab(len: number, beam: number, bowLen: number, y0: number, y1: number, color: string, scale = 1) {
  const g = new THREE.ExtrudeGeometry(outline(len * scale, beam * scale, bowLen * scale), { depth: y1 - y0, bevelEnabled: false, curveSegments: 6 });
  // shape is in XY with +Y = bow; extrude along +Z -> rotate so extrusion is up (+y) and bow is +z
  // extrusion (+z) becomes up (+y); the shape's +Y (bow) ends up at -z, so turn it round to face +z
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI);
  g.translate(0, y0, 0);
  return paint(g, color);
}

export function tugGeometry() {
  const L = TUG_HALF * 2;
  const parts = [
    hullSlab(L, 11, 7, -2.2, 0.5, "#b3262a"),
    hullSlab(L, 11, 7, 0.5, 2.6, "#1f2b3a"),
    hullSlab(L, 11, 7, 1.6, 2.7, "#151515", 1.05), // fender belt
    box(9.6, 0.2, L - 6, 0, 2.62, -1.5, "#4e5a52"), // deck
    box(7, 3, 9, 0, 4.1, 2, "#f2f0ea"), // deckhouse
    box(7.6, 2.4, 5, 0, 6.8, 3, "#f2f0ea"), // wheelhouse
    box(8, 0.25, 5.6, 0, 8.1, 3, "#d9d6cd"),
    box(0.3, 4.5, 0.3, 0, 10.4, 3, "#f2f0ea"), // mast
    box(2.4, 0.2, 0.2, 0, 11.6, 3, "#f2f0ea"),
    box(0.9, 3.4, 1.1, 1.8, 7.2, -1.6, "#ffb000"), // twin stacks
    box(0.9, 3.4, 1.1, -1.8, 7.2, -1.6, "#ffb000"),
    box(0.95, 0.6, 1.15, 1.8, 9.2, -1.6, "#16181b"),
    box(0.95, 0.6, 1.15, -1.8, 9.2, -1.6, "#16181b"),
    box(3.2, 1.6, 2.2, 0, 3.4, -9, "#2d3238"), // towing winch
    box(0.5, 1.6, 0.5, 0, 3.4, -12.3, "#e3b62a"), // towing hook post
    cyl(0.9, 1.1, 1.2, 0, 2.6, 12, "#151515"), // bow fender
  ];
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return g;
}

export function pilotGeometry() {
  const parts = [
    hullSlab(18, 5.4, 6, -1, 0.4, "#1f2b3a"),
    hullSlab(18, 5.4, 6, 0.4, 1.8, "#ff6a1a"),
    hullSlab(18, 5.4, 6, 1.2, 1.9, "#151515", 1.06),
    box(3.8, 2, 5.5, 0, 2.8, 0.5, "#f2f0ea"),
    box(3.9, 0.7, 5.2, 0, 3.4, 0.6, "#1c2633"),
    box(0.2, 2.4, 0.2, 0, 5, -0.6, "#f2f0ea"),
  ];
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return g;
}

/** Floating pontoon with a gangway to the quay, a hut and bollards, at a tug base. */
export function pontoonGeometry(bx: number, bz: number, quayX: number) {
  const parts = [
    box(7, 1.2, 74, bx, 0.1, bz, "#8d8a83"),
    box(7.2, 0.15, 74.2, bx, 0.75, bz, "#b9b4a8"),
    box(bx - quayX - 3.5, 0.4, 2.6, (bx + quayX) / 2 - 1.5, 1.0, bz, "#6d6f72"),
    box(4, 3, 5, bx, 2.3, bz + 26, "#ff6a1a"),
    box(4.6, 0.3, 5.6, bx, 3.9, bz + 26, "#2d3238"),
  ];
  for (let z = -32; z <= 32; z += 8) {
    parts.push(cyl(0.3, 0.35, 0.8, bx + 3.1, 0.8, bz + z, "#2d2f33", 6));
    parts.push(cyl(0.3, 0.35, 0.8, bx - 3.1, 0.8, bz + z, "#2d2f33", 6));
  }
  for (const z of [-38, 38]) parts.push(cyl(0.6, 0.6, 9, bx + 4.5, -4, bz + z, "#3d3f42", 8));
  return parts;
}
