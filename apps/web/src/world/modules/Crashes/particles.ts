// Fixed-size particle pool (struct of arrays, no per-frame allocation).
// Output arrays (pos, params = [size, alpha, rotation], color) feed InstancedBufferAttributes directly.

export interface SpawnArgs {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number; // seconds
  size0?: number;
  size1?: number;
  alpha?: number;
  r?: number;
  g?: number;
  b?: number;
  r1?: number; // colour at end of life (defaults to start colour)
  g1?: number;
  b1?: number;
  gravity?: number; // m/s^2 downward (negative = buoyant)
  drag?: number; // 1/s
  spin?: number; // rad/s
  owner?: number;
}

const SCRATCH: Required<SpawnArgs> = {
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, size0: 1, size1: 1, alpha: 1,
  r: 1, g: 1, b: 1, r1: 1, g1: 1, b1: 1, gravity: 0, drag: 0, spin: 0, owner: -1,
};

export class ParticlePool {
  readonly n: number;
  readonly pos: Float32Array;
  readonly params: Float32Array;
  readonly color: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private size: Float32Array; // s0, s1
  private alpha: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private phys: Float32Array; // gravity, drag, spin
  private owner: Int16Array;
  private cursor = 0;

  constructor(n: number) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.params = new Float32Array(n * 3);
    this.color = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1);
    this.life = new Float32Array(n).fill(0);
    this.size = new Float32Array(n * 2);
    this.alpha = new Float32Array(n);
    this.c0 = new Float32Array(n * 3);
    this.c1 = new Float32Array(n * 3);
    this.phys = new Float32Array(n * 3);
    this.owner = new Int16Array(n).fill(-1);
  }

  spawn(s: SpawnArgs) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    const i3 = i * 3;
    this.pos[i3] = s.x;
    this.pos[i3 + 1] = s.y;
    this.pos[i3 + 2] = s.z;
    this.vel[i3] = s.vx ?? 0;
    this.vel[i3 + 1] = s.vy ?? 0;
    this.vel[i3 + 2] = s.vz ?? 0;
    this.age[i] = 0;
    this.life[i] = s.life;
    this.size[i * 2] = s.size0 ?? 1;
    this.size[i * 2 + 1] = s.size1 ?? s.size0 ?? 1;
    this.alpha[i] = s.alpha ?? 1;
    const r = s.r ?? 1;
    const g = s.g ?? 1;
    const b = s.b ?? 1;
    this.c0[i3] = r;
    this.c0[i3 + 1] = g;
    this.c0[i3 + 2] = b;
    this.c1[i3] = s.r1 ?? r;
    this.c1[i3 + 1] = s.g1 ?? g;
    this.c1[i3 + 2] = s.b1 ?? b;
    this.phys[i3] = s.gravity ?? 0;
    this.phys[i3 + 1] = s.drag ?? 0;
    this.phys[i3 + 2] = s.spin ?? 0;
    this.params[i3 + 2] = Math.random() * 6.283;
    this.owner[i] = s.owner ?? -1;
  }

  /** Allocation-free spawn for per-frame emitters (positional twin of spawn()). */
  emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size0: number, size1: number, alpha: number,
    r: number, g: number, b: number, r1: number, g1: number, b1: number,
    gravity: number, drag: number, spin: number, owner: number,
  ) {
    const s = SCRATCH;
    s.x = x; s.y = y; s.z = z; s.vx = vx; s.vy = vy; s.vz = vz;
    s.life = life; s.size0 = size0; s.size1 = size1; s.alpha = alpha;
    s.r = r; s.g = g; s.b = b; s.r1 = r1; s.g1 = g1; s.b1 = b1;
    s.gravity = gravity; s.drag = drag; s.spin = spin; s.owner = owner;
    this.spawn(s);
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3;
      if (this.age[i] >= this.life[i]) {
        this.params[i3] = 0;
        this.params[i3 + 1] = 0;
        continue;
      }
      this.age[i] += dt;
      const k = Math.min(1, this.age[i] / this.life[i]);
      if (k >= 1) {
        this.params[i3] = 0;
        this.params[i3 + 1] = 0;
        continue;
      }
      const damp = Math.max(0, 1 - this.phys[i3 + 1] * dt);
      this.vel[i3] *= damp;
      this.vel[i3 + 1] = (this.vel[i3 + 1] - this.phys[i3] * dt) * damp;
      this.vel[i3 + 2] *= damp;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.05) {
        this.pos[i3 + 1] = 0.05;
        this.vel[i3 + 1] *= -0.3;
      }
      // size eases out, alpha: quick fade in, long fade out
      const e = 1 - (1 - k) * (1 - k);
      this.params[i3] = this.size[i * 2] + (this.size[i * 2 + 1] - this.size[i * 2]) * e;
      const fade = k < 0.08 ? k / 0.08 : 1 - (k - 0.08) / 0.92;
      this.params[i3 + 1] = this.alpha[i] * fade;
      this.params[i3 + 2] += this.phys[i3 + 2] * dt;
      this.color[i3] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * k;
      this.color[i3 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * k;
      this.color[i3 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * k;
    }
  }

  /** Fast-fade every particle of an owner (it finishes within `within` seconds). 0 kills now. */
  killOwner(owner: number, within = 0) {
    for (let i = 0; i < this.n; i++) {
      if (this.owner[i] !== owner || this.age[i] >= this.life[i]) continue;
      if (within <= 0) this.age[i] = this.life[i];
      else this.life[i] = Math.min(this.life[i], this.age[i] + within);
    }
  }

  aliveCount() {
    let c = 0;
    for (let i = 0; i < this.n; i++) if (this.age[i] < this.life[i]) c++;
    return c;
  }
}

export interface DebrisArgs {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  scale: number;
  r: number;
  g: number;
  b: number;
  spin?: number;
  owner: number;
}

/** Rigid debris (glass, plastic, cargo boxes): thrown, bounces, settles and stays until its owner is cleared. */
export class DebrisPool {
  readonly n: number;
  readonly pos: Float32Array;
  readonly rot: Float32Array;
  readonly scale: Float32Array;
  readonly color: Float32Array;
  private vel: Float32Array;
  private ang: Float32Array;
  private owner: Int16Array;
  /** 0 dead, 1 flying, 2 settled */
  readonly state: Uint8Array;
  private cursor = 0;
  private halfHeight: number;

  constructor(n: number, halfHeight = 0.5) {
    this.n = n;
    this.halfHeight = halfHeight;
    this.pos = new Float32Array(n * 3);
    this.rot = new Float32Array(n * 3);
    this.scale = new Float32Array(n);
    this.color = new Float32Array(n * 3).fill(1);
    this.vel = new Float32Array(n * 3);
    this.ang = new Float32Array(n * 3);
    this.owner = new Int16Array(n).fill(-1);
    this.state = new Uint8Array(n);
  }

  spawn(d: DebrisArgs) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    const i3 = i * 3;
    this.pos[i3] = d.x;
    this.pos[i3 + 1] = d.y;
    this.pos[i3 + 2] = d.z;
    this.vel[i3] = d.vx;
    this.vel[i3 + 1] = d.vy;
    this.vel[i3 + 2] = d.vz;
    const sp = d.spin ?? 8;
    this.ang[i3] = (Math.random() - 0.5) * sp;
    this.ang[i3 + 1] = (Math.random() - 0.5) * sp;
    this.ang[i3 + 2] = (Math.random() - 0.5) * sp;
    this.rot[i3] = Math.random() * 6.28;
    this.rot[i3 + 1] = Math.random() * 6.28;
    this.rot[i3 + 2] = Math.random() * 6.28;
    this.scale[i] = d.scale;
    this.color[i3] = d.r;
    this.color[i3 + 1] = d.g;
    this.color[i3 + 2] = d.b;
    this.owner[i] = d.owner;
    this.state[i] = 1;
  }

  /** Returns true if anything moved (matrices need rewriting). */
  update(dt: number): boolean {
    let moved = false;
    for (let i = 0; i < this.n; i++) {
      if (this.state[i] !== 1) continue;
      moved = true;
      const i3 = i * 3;
      this.vel[i3 + 1] -= 22 * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.rot[i3] += this.ang[i3] * dt;
      this.rot[i3 + 1] += this.ang[i3 + 1] * dt;
      this.rot[i3 + 2] += this.ang[i3 + 2] * dt;
      const floor = this.halfHeight * this.scale[i] + 0.04;
      if (this.pos[i3 + 1] <= floor) {
        this.pos[i3 + 1] = floor;
        if (Math.abs(this.vel[i3 + 1]) < 2.5) {
          this.state[i] = 2;
          // lie flat-ish: keep yaw, damp pitch/roll toward a resting face
          this.rot[i3] = Math.round(this.rot[i3] / 1.5708) * 1.5708;
          this.rot[i3 + 2] = Math.round(this.rot[i3 + 2] / 1.5708) * 1.5708;
        } else {
          this.vel[i3 + 1] *= -0.35;
          this.vel[i3] *= 0.55;
          this.vel[i3 + 2] *= 0.55;
          this.ang[i3] *= 0.5;
          this.ang[i3 + 1] *= 0.5;
          this.ang[i3 + 2] *= 0.5;
        }
      }
    }
    return moved;
  }

  killOwner(owner: number) {
    let any = false;
    for (let i = 0; i < this.n; i++)
      if (this.owner[i] === owner && this.state[i] !== 0) {
        this.state[i] = 0;
        this.scale[i] = 0;
        any = true;
      }
    return any;
  }
}

/** Flat ground decals (skid marks): fixed pool, ring-recycled, removed per owner. */
export class DecalPool {
  readonly n: number;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly yaw: Float32Array;
  readonly len: Float32Array;
  readonly width: Float32Array;
  readonly alive: Uint8Array;
  private owner: Int16Array;
  private cursor = 0;
  dirty = true;

  constructor(n: number) {
    this.n = n;
    this.x = new Float32Array(n);
    this.z = new Float32Array(n);
    this.yaw = new Float32Array(n);
    this.len = new Float32Array(n);
    this.width = new Float32Array(n);
    this.alive = new Uint8Array(n);
    this.owner = new Int16Array(n).fill(-1);
  }

  /** A strip from (x0,z0) to (x1,z1). */
  add(x0: number, z0: number, x1: number, z1: number, width: number, owner: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.x[i] = (x0 + x1) / 2;
    this.z[i] = (z0 + z1) / 2;
    this.yaw[i] = Math.atan2(x1 - x0, z1 - z0);
    this.len[i] = Math.hypot(x1 - x0, z1 - z0);
    this.width[i] = width;
    this.owner[i] = owner;
    this.alive[i] = 1;
    this.dirty = true;
  }

  killOwner(owner: number) {
    for (let i = 0; i < this.n; i++)
      if (this.owner[i] === owner && this.alive[i]) {
        this.alive[i] = 0;
        this.dirty = true;
      }
  }

  count() {
    let c = 0;
    for (let i = 0; i < this.n; i++) c += this.alive[i];
    return c;
  }
}
