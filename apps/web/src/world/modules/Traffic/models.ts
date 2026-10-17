// Low-poly vehicle geometry, merged into one BufferGeometry per (archetype, part) so each part
// is a single InstancedMesh. Local frame: front is +z, left is +x, ground at y = 0.
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Archetype } from "./driving";

export type Part = "paint" | "fixed" | "head" | "tail" | "indL" | "indR";
export const PARTS: Part[] = ["paint", "fixed", "head", "tail", "indL", "indR"];

interface Piece {
  part: Part;
  geo: BufferGeometry;
  color?: string;
}

const tmpColor = new Color();

function box(part: Part, w: number, h: number, l: number, x: number, y: number, z: number, color?: string): Piece {
  const g = new BoxGeometry(w, h, l);
  g.translate(x, y, z);
  return { part, geo: g, color };
}

function wheel(x: number, z: number, r: number, width = 0.28): Piece {
  const g = new CylinderGeometry(r, r, width, 8);
  g.rotateZ(Math.PI / 2);
  g.translate(x, r, z);
  return { part: "fixed", geo: g, color: "#1b1b1e" };
}

const GLASS = "#253241";
const TRIM = "#2e2f33";
const CHROME = "#b9bec4";

function lights(halfW: number, front: number, back: number, y: number, ySize = 0.16): Piece[] {
  const lw = Math.min(0.36, halfW * 0.4);
  const out: Piece[] = [];
  for (const s of [1, -1]) {
    out.push(box("head", lw, ySize, 0.06, s * (halfW - lw / 2 - 0.08), y, front + 0.02));
    out.push(box("tail", lw, ySize, 0.06, s * (halfW - lw / 2 - 0.08), y, back - 0.02));
  }
  // indicators: small cubes on the corners, left = +x
  for (const s of [1, -1]) {
    const part: Part = s === 1 ? "indL" : "indR";
    out.push(box(part, 0.14, 0.12, 0.12, s * (halfW + 0.01), y, front - 0.12));
    out.push(box(part, 0.14, 0.12, 0.12, s * (halfW + 0.01), y, back + 0.12));
  }
  return out;
}

interface CarSpec {
  L: number;
  W: number;
  bodyH: number;
  clearance: number;
  cabinL: number;
  cabinH: number;
  cabinZ: number;
  wheelR: number;
  wheelInset: number;
}

function car(s: CarSpec): Piece[] {
  const halfL = s.L / 2;
  const halfW = s.W / 2;
  const bodyY = s.clearance + s.bodyH / 2;
  const top = s.clearance + s.bodyH;
  const p: Piece[] = [
    box("paint", s.W, s.bodyH, s.L, 0, bodyY, 0),
    box("fixed", s.W - 0.12, s.cabinH, s.cabinL, 0, top + s.cabinH / 2, s.cabinZ, GLASS),
    box("paint", s.W - 0.08, 0.1, s.cabinL - 0.1, 0, top + s.cabinH + 0.05, s.cabinZ),
    box("fixed", s.W + 0.04, 0.18, 0.16, 0, s.clearance + 0.1, halfL, TRIM),
    box("fixed", s.W + 0.04, 0.18, 0.16, 0, s.clearance + 0.1, -halfL, TRIM),
  ];
  for (const x of [halfW - 0.1, -(halfW - 0.1)])
    for (const z of [halfL - s.wheelInset, -(halfL - s.wheelInset)]) p.push(wheel(x, z, s.wheelR));
  p.push(...lights(halfW, halfL, -halfL, bodyY + s.bodyH * 0.15));
  return p;
}

function hgv(): Piece[] {
  const W = 2.5;
  const cabL = 2.3;
  const front = 5.8;
  const cabZ = front - cabL / 2;
  const trailerL = 8.8;
  const trailerZ = front - cabL - 0.4 - trailerL / 2;
  const back = trailerZ - trailerL / 2;
  const p: Piece[] = [
    box("paint", W, 2.5, cabL, 0, 0.6 + 1.25, cabZ),
    box("fixed", W - 0.2, 0.9, 0.06, 0, 2.35, front + 0.01, GLASS),
    box("fixed", W + 0.04, 0.7, 1.0, 0, 2.35, front - 0.6, GLASS), // side windows
    box("fixed", 1.2, 0.5, 0.1, 0, 0.95, front + 0.02, CHROME), // grille
    box("paint", W - 0.3, 0.5, 1.4, 0, 3.35, cabZ - 0.2), // roof fairing
    box("fixed", 1.0, 0.25, L(front, back) - 0.4, 0, 0.6, (front + back) / 2, TRIM), // chassis
    box("fixed", W, 3.0, trailerL, 0, 1.1 + 1.5, trailerZ, "#e9ebee"),
    box("fixed", W + 0.04, 0.25, trailerL, 0, 1.3, trailerZ, "#9aa1aa"), // side skirt stripe
    box("fixed", W + 0.04, 0.3, 0.16, 0, 0.75, front, TRIM),
  ];
  for (const x of [W / 2 - 0.15, -(W / 2 - 0.15)]) {
    p.push(wheel(x, front - 1.0, 0.5, 0.36));
    p.push(wheel(x, front - cabL - 0.2, 0.5, 0.36));
    p.push(wheel(x, back + 1.2, 0.5, 0.36));
    p.push(wheel(x, back + 2.3, 0.5, 0.36));
  }
  p.push(...lights(W / 2, front, back, 0.95, 0.22));
  return p;
}

function L(front: number, back: number) {
  return front - back;
}

function cab(): Piece[] {
  // London black cab: tall, rounded-ish, with an amber TAXI roof sign
  const p = car({ L: 4.5, W: 1.85, bodyH: 0.75, clearance: 0.32, cabinL: 2.6, cabinH: 0.8, cabinZ: -0.25, wheelR: 0.36, wheelInset: 0.85 });
  p.push(box("fixed", 0.7, 0.2, 0.3, 0, 0.32 + 0.75 + 0.8 + 0.2, 0.6, "#ffb000"));
  p.push(box("fixed", 1.3, 0.25, 0.3, 0, 0.6, 2.26, CHROME));
  return p;
}

function estate(): Piece[] {
  // long roof running to the tailgate, roof rails
  const p = car({ L: 4.75, W: 1.82, bodyH: 0.62, clearance: 0.3, cabinL: 3.0, cabinH: 0.56, cabinZ: -0.55, wheelR: 0.34, wheelInset: 0.85 });
  for (const x of [0.7, -0.7]) p.push(box("fixed", 0.06, 0.06, 2.6, x, 0.3 + 0.62 + 0.56 + 0.13, -0.55, TRIM));
  return p;
}

function sports(): Piece[] {
  const p = car({ L: 4.3, W: 1.9, bodyH: 0.48, clearance: 0.2, cabinL: 1.6, cabinH: 0.4, cabinZ: -0.45, wheelR: 0.34, wheelInset: 0.8 });
  p.push(box("paint", 1.7, 0.06, 0.32, 0, 0.2 + 0.48 + 0.24, -2.0)); // spoiler
  for (const x of [0.6, -0.6]) p.push(box("fixed", 0.06, 0.2, 0.06, x, 0.2 + 0.48 + 0.1, -2.0, TRIM));
  return p;
}

function minibus(): Piece[] {
  const p = car({ L: 5.6, W: 2.0, bodyH: 1.0, clearance: 0.35, cabinL: 4.3, cabinH: 0.8, cabinZ: -0.55, wheelR: 0.38, wheelInset: 0.95 });
  p.push(box("paint", 1.9, 0.8, 4.2, 0, 0.35 + 1.0 + 0.8 + 0.18, -0.55)); // high roof
  return p;
}

function van(): Piece[] {
  const W = 2.0;
  const L = 5.4;
  const halfL = L / 2;
  const p: Piece[] = [
    box("paint", W, 1.95, 3.8, 0, 0.38 + 0.975, -0.8), // load box
    box("paint", W, 0.8, 1.6, 0, 0.38 + 0.4, 1.9), // bonnet
    box("fixed", W - 0.1, 0.75, 0.9, 0, 0.38 + 0.8 + 0.38, 1.45, GLASS), // windscreen / cab glass
    box("paint", W - 0.06, 0.08, 0.9, 0, 0.38 + 1.55 + 0.04 + 0.32, 1.45),
    box("fixed", W + 0.04, 0.2, 0.16, 0, 0.45, halfL, TRIM),
    box("fixed", W + 0.04, 0.2, 0.16, 0, 0.45, -halfL, TRIM),
  ];
  for (const x of [W / 2 - 0.1, -(W / 2 - 0.1)]) for (const z of [halfL - 0.9, -(halfL - 1.0)]) p.push(wheel(x, z, 0.37));
  p.push(...lights(W / 2, halfL, -halfL, 0.85));
  return p;
}

function moto(): Piece[] {
  const p: Piece[] = [
    box("paint", 0.42, 0.42, 1.1, 0, 0.78, 0.1), // tank + fairing
    box("paint", 0.3, 0.25, 0.6, 0, 0.82, -0.6), // tail
    box("fixed", 0.46, 0.62, 0.4, 0, 1.3, -0.2, "#2a2d34"), // rider torso
    box("fixed", 0.32, 0.3, 0.34, 0, 1.78, -0.12, "#e8e8e8"), // helmet
    box("fixed", 0.6, 0.06, 0.06, 0, 1.08, 0.48, TRIM), // handlebars
  ];
  for (const z of [0.72, -0.72]) {
    const g = new CylinderGeometry(0.32, 0.32, 0.14, 10);
    g.rotateZ(Math.PI / 2);
    g.translate(0, 0.32, z);
    p.push({ part: "fixed", geo: g, color: "#1b1b1e" });
  }
  p.push(box("head", 0.16, 0.14, 0.06, 0, 0.9, 0.68));
  p.push(box("tail", 0.14, 0.08, 0.06, 0, 0.88, -0.92));
  for (const s of [1, -1]) {
    const part: Part = s === 1 ? "indL" : "indR";
    p.push(box(part, 0.08, 0.06, 0.06, s * 0.22, 0.9, 0.62));
    p.push(box(part, 0.08, 0.06, 0.06, s * 0.16, 0.88, -0.88));
  }
  return p;
}

const SPECS: Record<Archetype, () => Piece[]> = {
  hatch: () => car({ L: 3.8, W: 1.72, bodyH: 0.62, clearance: 0.28, cabinL: 2.0, cabinH: 0.58, cabinZ: -0.3, wheelR: 0.32, wheelInset: 0.65 }),
  saloon: () => car({ L: 4.6, W: 1.8, bodyH: 0.6, clearance: 0.28, cabinL: 2.2, cabinH: 0.55, cabinZ: -0.2, wheelR: 0.33, wheelInset: 0.85 }),
  suv: () => car({ L: 4.7, W: 1.95, bodyH: 0.85, clearance: 0.42, cabinL: 2.9, cabinH: 0.68, cabinZ: -0.35, wheelR: 0.42, wheelInset: 0.85 }),
  estate,
  sports,
  cab,
  minibus,
  van,
  hgv,
  moto,
};

export const HALF_LENGTH: Record<Archetype, number> = {
  hatch: 1.9, saloon: 2.3, suv: 2.35, estate: 2.4, sports: 2.15, cab: 2.25, minibus: 2.8, van: 2.75, hgv: 5.9, moto: 1.0,
};
export const WIDTH: Record<Archetype, number> = {
  hatch: 1.72, saloon: 1.8, suv: 1.95, estate: 1.82, sports: 1.9, cab: 1.85, minibus: 2.0, van: 2.0, hgv: 2.5, moto: 0.5,
};

/** One merged geometry per part (null when the archetype has no pieces for that part). */
export function buildArchetype(kind: Archetype): Record<Part, BufferGeometry | null> {
  const pieces = SPECS[kind]();
  const out = {} as Record<Part, BufferGeometry | null>;
  for (const part of PARTS) {
    const list = pieces.filter((p) => p.part === part);
    if (!list.length) {
      out[part] = null;
      continue;
    }
    const geos = list.map((p) => {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
      if (part === "fixed") {
        tmpColor.set(p.color ?? "#888888");
        const n = g.getAttribute("position").count;
        const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          arr[i * 3] = tmpColor.r;
          arr[i * 3 + 1] = tmpColor.g;
          arr[i * 3 + 2] = tmpColor.b;
        }
        g.setAttribute("color", new BufferAttribute(arr, 3));
      }
      g.deleteAttribute("uv");
      return g;
    });
    out[part] = mergeGeometries(geos, false);
    for (const p of list) p.geo.dispose();
  }
  return out;
}

export const PALETTES: Record<Archetype, string[]> = {
  hatch: ["#d6453d", "#2f6db5", "#f2f2f2", "#e8b33a", "#3d8a5a", "#14a3b8", "#9aa3ab", "#f07aa0", "#7fc241"],
  saloon: ["#1f2a44", "#c9ccd1", "#2b2b2b", "#8a1f2b", "#3b5f8a", "#f2f2f2", "#5a6b5a", "#b5352d"],
  suv: ["#2b2b2b", "#f2f2f2", "#4a5568", "#2f4f3a", "#7a3fa0", "#c08a3e", "#9aa3ab"],
  estate: ["#5b6770", "#f2f2f2", "#2c3e50", "#7d2e2e", "#a8b2a0", "#202020", "#c9a66b"],
  sports: ["#e01b24", "#ffcc00", "#1c6dd0", "#111111", "#f2f2f2", "#16a34a", "#ff4fa3"],
  cab: ["#141414", "#141414", "#141414", "#1d232c", "#3a1418"],
  minibus: ["#f2f2f2", "#c9ccd1", "#2f6db5", "#f2c200", "#3d8a5a"],
  van: ["#f4f4f4", "#f4f4f4", "#c9ccd1", "#2b4c7e", "#1f3d2b", "#8a1f2b", "#d9d4c7"],
  moto: ["#e01b24", "#111111", "#1c6dd0", "#f2f2f2", "#ffcc00", "#16a34a"],
  hgv: ["#2a5db0", "#c43a2f", "#f2f2f2", "#2f8f4e", "#e3a21a", "#474b52"],
};
