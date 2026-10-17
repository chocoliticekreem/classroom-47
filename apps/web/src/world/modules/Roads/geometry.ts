// Pure helpers that accumulate flat (y-up) geometry into plain arrays, so one merged mesh per material.
import { BufferGeometry, Float32BufferAttribute } from "three";

export class FlatBuilder {
  positions: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];

  private vert(x: number, y: number, z: number, u: number, v: number) {
    this.positions.push(x, y, z);
    this.uvs.push(u, v);
    return this.positions.length / 3 - 1;
  }

  /** Triangle wound so it faces +y (CCW seen from above). */
  private tri(a: number, b: number, c: number) {
    const p = this.positions;
    const ux = p[b * 3] - p[a * 3];
    const uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3];
    const vz = p[c * 3 + 2] - p[a * 3 + 2];
    if (uz * vx - ux * vz > 0) this.indices.push(a, b, c);
    else this.indices.push(a, c, b);
  }

  /**
   * Rectangle along the line p0 -> p1, from distance s0 to s1 (measured from p0, may exceed the segment),
   * halfW either side of a centre that is shifted `offset` metres along the side vector (-dz, dx).
   * UVs are in metres: u along the line, v across it.
   */
  strip(x0: number, z0: number, x1: number, z1: number, s0: number, s1: number, halfW: number, y: number, offset = 0) {
    if (s1 <= s0) return;
    const len = Math.hypot(x1 - x0, z1 - z0) || 1;
    const dx = (x1 - x0) / len;
    const dz = (z1 - z0) / len;
    const nx = -dz;
    const nz = dx;
    const lo = offset - halfW;
    const hi = offset + halfW;
    const a = this.vert(x0 + dx * s0 + nx * lo, y, z0 + dz * s0 + nz * lo, s0, lo);
    const b = this.vert(x0 + dx * s1 + nx * lo, y, z0 + dz * s1 + nz * lo, s1, lo);
    const c = this.vert(x0 + dx * s1 + nx * hi, y, z0 + dz * s1 + nz * hi, s1, hi);
    const d = this.vert(x0 + dx * s0 + nx * hi, y, z0 + dz * s0 + nz * hi, s0, hi);
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** Axis-aligned rectangle centred on (cx, cz). */
  rect(cx: number, cz: number, sx: number, sz: number, y: number) {
    this.strip(cx - sx / 2, cz, cx + sx / 2, cz, 0, sx, sz / 2, y);
  }

  disc(cx: number, cz: number, r: number, y: number, segments = 16) {
    const c = this.vert(cx, y, cz, 0, 0);
    const ring: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      ring.push(this.vert(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, Math.cos(a) * r, Math.sin(a) * r));
    }
    for (let i = 0; i < segments; i++) this.tri(c, ring[i], ring[(i + 1) % segments]);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.positions, 3));
    g.setAttribute("uv", new Float32BufferAttribute(this.uvs, 2));
    const normals = new Float32Array(this.positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    g.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    return g;
  }
}

/** Dash intervals [start, end] covering s0..s1 with the given dash and gap lengths, centred in the span. */
export function dashes(s0: number, s1: number, dash: number, gap: number): [number, number][] {
  const span = s1 - s0;
  if (span <= 0) return [];
  const period = dash + gap;
  const n = Math.max(0, Math.floor((span + gap) / period));
  if (n === 0) return span > dash * 0.5 ? [[s0 + (span - Math.min(dash, span)) / 2, s0 + (span + Math.min(dash, span)) / 2]] : [];
  const used = n * period - gap;
  const start = s0 + (span - used) / 2;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push([start + i * period, start + i * period + dash]);
  return out;
}

/** A box instance: centre, rotation about y, size. */
export interface BoxInst {
  x: number;
  y: number;
  z: number;
  rotY: number;
  sx: number;
  sy: number;
  sz: number;
}

/**
 * Box lying along the line p0 -> p1 from s0 to s1, shifted `offset` along the side vector (-dz, dx),
 * resting on `baseY`, with `width` across and `height` up.
 */
export function boxAlong(
  x0: number, z0: number, x1: number, z1: number,
  s0: number, s1: number, offset: number, width: number, height: number, baseY = 0,
): BoxInst {
  const len = Math.hypot(x1 - x0, z1 - z0) || 1;
  const dx = (x1 - x0) / len;
  const dz = (z1 - z0) / len;
  const sm = (s0 + s1) / 2;
  return {
    x: x0 + dx * sm - dz * offset,
    y: baseY + height / 2,
    z: z0 + dz * sm + dx * offset,
    rotY: Math.atan2(dx, dz),
    sx: width,
    sy: height,
    sz: Math.max(0.01, s1 - s0),
  };
}
