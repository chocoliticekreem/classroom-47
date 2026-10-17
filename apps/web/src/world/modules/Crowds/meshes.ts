// Low-poly meshes for the crowd. Each vertex carries `aPart` so the vertex shader knows which limb it
// belongs to (for swinging) and which colour to use. Local space: feet at y = 0, facing +z, right hand at -x.
import { BufferGeometry, Float32BufferAttribute } from "three";

export const PART = { torso: 0, head: 1, legL: 2, legR: 3, armL: 4, armR: 5, hair: 6 } as const;
export const UMBRELLA_PART = { canopy: 0, stick: 1 } as const;
export const DOG_PART = { body: 0, head: 1, legsA: 2, legsB: 3 } as const;

class Tris {
  pos: number[] = [];
  part: number[] = [];
  tri(a: number[], b: number[], c: number[], p: number) {
    this.pos.push(...a, ...b, ...c);
    this.part.push(p, p, p);
  }
  quad(a: number[], b: number[], c: number[], d: number[], p: number) {
    this.tri(a, b, c, p);
    this.tri(a, c, d, p);
  }
  /** Axis-aligned box, outward-facing CCW. `top`/`bottom` optional caps. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, p: number, top = true, bottom = false) {
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], p); // +z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], p); // -z
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], p); // +x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], p); // -x
    if (top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], p);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], p);
  }
  /** Octahedron (8 tris). */
  octa(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, p: number) {
    const t = [cx, cy + ry, cz], b = [cx, cy - ry, cz];
    const ring = [[cx + rx, cy, cz], [cx, cy, cz + rz], [cx - rx, cy, cz], [cx, cy, cz - rz]];
    for (let i = 0; i < 4; i++) {
      const u = ring[i], v = ring[(i + 1) % 4];
      this.tri(u, t, v, p);
      this.tri(v, b, u, p);
    }
  }
  /** Square pyramid cap, base at y0, apex at y1 (4 tris). */
  pyramid(cx: number, cz: number, r: number, y0: number, y1: number, p: number) {
    const ring = [[cx + r, y0, cz + r], [cx + r, y0, cz - r], [cx - r, y0, cz - r], [cx - r, y0, cz + r]];
    const apex = [cx, y1, cz];
    for (let i = 0; i < 4; i++) this.tri(ring[i], ring[(i + 1) % 4], apex, p);
  }
  geometry() {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("aPart", new Float32BufferAttribute(this.part, 1));
    return g;
  }
  get triangles() {
    return this.pos.length / 9;
  }
}

/** A ~1.75 m person in 54 triangles. Shoulders at y 1.42, hips at y 0.9. */
export function personTris() {
  const t = new Tris();
  t.box(0.02, 0.17, 0, 0.92, -0.075, 0.075, PART.legL, false); // 8
  t.box(-0.17, -0.02, 0, 0.92, -0.075, 0.075, PART.legR, false); // 8
  t.box(-0.22, 0.22, 0.88, 1.45, -0.12, 0.12, PART.torso, true); // 10
  t.box(0.22, 0.32, 0.8, 1.42, -0.06, 0.06, PART.armL, false); // 8
  t.box(-0.32, -0.22, 0.8, 1.42, -0.06, 0.06, PART.armR, false); // 8
  t.octa(0, 1.62, 0, 0.14, 0.17, 0.15, PART.head); // 8
  t.pyramid(0, -0.02, 0.13, 1.68, 1.82, PART.hair); // 4
  return t;
}

/** Umbrella held in the right hand (arm raised forward): stick + 6-sided canopy, 14 triangles. */
export function umbrellaTris() {
  const t = new Tris();
  const hx = -0.27, hz = 0.36; // hand
  t.box(hx - 0.02, hx + 0.02, 0.95, 2.2, hz - 0.02, hz + 0.02, UMBRELLA_PART.stick, false);
  const apex = [hx, 2.32, hz];
  const R = 0.72, y = 2.02;
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
    t.tri([hx + Math.cos(a0) * R, y, hz + Math.sin(a0) * R], apex, [hx + Math.cos(a1) * R, y, hz + Math.sin(a1) * R], UMBRELLA_PART.canopy);
  }
  return t;
}

/** A small dog facing +z, 52 triangles. */
export function dogTris() {
  const t = new Tris();
  t.box(-0.09, 0.09, 0.24, 0.42, -0.28, 0.22, DOG_PART.body, true); // 10
  t.box(-0.07, 0.07, 0.34, 0.5, 0.2, 0.38, DOG_PART.head, true); // 10
  // legs: front-left + back-right swing together (A), the other diagonal (B)
  t.box(0.03, 0.08, 0, 0.26, 0.12, 0.17, DOG_PART.legsA, false);
  t.box(-0.08, -0.03, 0, 0.26, -0.24, -0.19, DOG_PART.legsA, false);
  t.box(-0.08, -0.03, 0, 0.26, 0.12, 0.17, DOG_PART.legsB, false);
  t.box(0.03, 0.08, 0, 0.26, -0.24, -0.19, DOG_PART.legsB, false);
  return t;
}

export const personGeometry = () => personTris().geometry();
export const umbrellaGeometry = () => umbrellaTris().geometry();
export const dogGeometry = () => dogTris().geometry();
