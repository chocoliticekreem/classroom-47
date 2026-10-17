// Arc-length parameterised 3D polylines with rounded corners. Everything that moves at the airport
// (planes, tugs, crash tenders) rides one of these, sampled by distance travelled.

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });

/**
 * Replace each interior corner with a quadratic Bezier that starts `r` before the corner and ends `r` after it
 * (r is clamped to half of each adjacent segment so consecutive fillets never overlap).
 */
export function roundCorners(pts: readonly V3[], r: number, steps = 8): V3[] {
  if (pts.length < 3) return pts.map((p) => ({ ...p }));
  const out: V3[] = [{ ...pts[0] }];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const c = pts[i];
    const b = pts[i + 1];
    const la = Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z);
    const lb = Math.hypot(b.x - c.x, b.y - c.y, b.z - c.z);
    const rr = Math.min(r, la / 2, lb / 2);
    if (rr < 1e-6) {
      out.push({ ...c });
      continue;
    }
    const p0 = lerp3(c, a, rr / la);
    const p2 = lerp3(c, b, rr / lb);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push({
        x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x,
        y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y,
        z: u * u * p0.z + 2 * u * t * c.z + t * t * p2.z,
      });
    }
  }
  out.push({ ...pts[pts.length - 1] });
  return out;
}

function lerp3(a: V3, b: V3, t: number): V3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export class Path {
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  readonly zs: number[] = [];
  readonly cum: number[] = [];
  readonly length: number;

  constructor(points: readonly V3[]) {
    let total = 0;
    for (const p of points) {
      const n = this.xs.length;
      if (n) {
        const d = Math.hypot(p.x - this.xs[n - 1], p.y - this.ys[n - 1], p.z - this.zs[n - 1]);
        if (d < 1e-6) continue;
        total += d;
      }
      this.xs.push(p.x);
      this.ys.push(p.y);
      this.zs.push(p.z);
      this.cum.push(total);
    }
    if (this.xs.length === 1) {
      // degenerate: a single point; give it a tiny segment so tangents are defined
      this.xs.push(this.xs[0]);
      this.ys.push(this.ys[0]);
      this.zs.push(this.zs[0] + 1e-3);
      this.cum.push(1e-3);
      total = 1e-3;
    }
    this.length = total;
  }

  get start(): V3 {
    return { x: this.xs[0], y: this.ys[0], z: this.zs[0] };
  }

  get end(): V3 {
    const n = this.xs.length - 1;
    return { x: this.xs[n], y: this.ys[n], z: this.zs[n] };
  }

  /** Index i such that cum[i] <= d < cum[i+1] (clamped). */
  private seg(d: number) {
    const c = this.cum;
    let lo = 0;
    let hi = c.length - 2;
    if (d <= 0) return 0;
    if (d >= c[hi + 1]) return hi;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (c[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  sample(d: number, out: V3): V3 {
    const dd = Math.min(Math.max(d, 0), this.length);
    const i = this.seg(dd);
    const span = this.cum[i + 1] - this.cum[i] || 1;
    const t = (dd - this.cum[i]) / span;
    out.x = this.xs[i] + (this.xs[i + 1] - this.xs[i]) * t;
    out.y = this.ys[i] + (this.ys[i + 1] - this.ys[i]) * t;
    out.z = this.zs[i] + (this.zs[i + 1] - this.zs[i]) * t;
    return out;
  }

  /** Unit direction of travel at distance d. */
  tangent(d: number, out: V3): V3 {
    const i = this.seg(Math.min(Math.max(d, 0), this.length));
    const dx = this.xs[i + 1] - this.xs[i];
    const dy = this.ys[i + 1] - this.ys[i];
    const dz = this.zs[i + 1] - this.zs[i];
    const l = Math.hypot(dx, dy, dz) || 1;
    out.x = dx / l;
    out.y = dy / l;
    out.z = dz / l;
    return out;
  }
}
