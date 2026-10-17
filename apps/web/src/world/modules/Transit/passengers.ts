// Little people for bus stops and platforms: one fixed pool in typed arrays (no per-frame
// allocation). Each person walks through up to MAX_WP waypoints, then idles, boards or fades out.
import { mulberry32 } from "./rng";

export const MAX_WP = 6;
export const ST = { FREE: 0, WALK: 1, IDLE: 2, LEAVING: 3 } as const;
export const END = { IDLE: 0, BOARD: 1, VANISH: 2 } as const;

export class PassengerPool {
  readonly cap: number;
  active = 0;
  readonly state: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly yaw: Float32Array;
  readonly scale: Float32Array;
  readonly speed: Float32Array;
  readonly phase: Float32Array; // walk cycle
  readonly look: Uint8Array; // palette index
  readonly faceYaw: Float32Array; // yaw to face when idle
  private readonly wp: Float32Array;
  private readonly wpN: Uint8Array;
  private readonly wpI: Uint8Array;
  private readonly end: Uint8Array;
  private readonly rand: () => number;
  /** Set when a slot changes between used/free, so the renderer can hide it. */
  dirtyFree = false;

  constructor(cap: number, seed: number) {
    this.cap = cap;
    this.state = new Uint8Array(cap);
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.z = new Float32Array(cap);
    this.yaw = new Float32Array(cap);
    this.scale = new Float32Array(cap);
    this.speed = new Float32Array(cap);
    this.phase = new Float32Array(cap);
    this.look = new Uint8Array(cap);
    this.faceYaw = new Float32Array(cap);
    this.wp = new Float32Array(cap * MAX_WP * 3);
    this.wpN = new Uint8Array(cap);
    this.wpI = new Uint8Array(cap);
    this.end = new Uint8Array(cap);
    this.rand = mulberry32(seed);
  }

  /** New person at (x,y,z), growing in from nothing. Returns -1 when the pool is full. */
  spawn(x: number, y: number, z: number): number {
    for (let i = 0; i < this.cap; i++) {
      if (this.state[i] !== ST.FREE) continue;
      this.state[i] = ST.IDLE;
      this.x[i] = x;
      this.y[i] = y;
      this.z[i] = z;
      this.scale[i] = 0.05;
      this.speed[i] = 1.3 + this.rand() * 0.6;
      this.phase[i] = this.rand() * 6.28;
      this.look[i] = Math.floor(this.rand() * 255);
      this.wpN[i] = 0;
      this.wpI[i] = 0;
      this.end[i] = END.IDLE;
      this.active++;
      return i;
    }
    return -1;
  }

  /** Replace the route: clear waypoints (call before addWaypoint when re-routing). */
  clearPath(i: number) {
    this.wpN[i] = 0;
    this.wpI[i] = 0;
  }

  addWaypoint(i: number, x: number, y: number, z: number) {
    const n = this.wpN[i];
    if (n >= MAX_WP) return;
    const o = (i * MAX_WP + n) * 3;
    this.wp[o] = x;
    this.wp[o + 1] = y;
    this.wp[o + 2] = z;
    this.wpN[i] = n + 1;
    this.state[i] = ST.WALK;
  }

  /** What happens after the last waypoint; faceYaw is used when idling. */
  finish(i: number, end: number, faceYaw: number) {
    this.end[i] = end;
    this.faceYaw[i] = faceYaw;
    if (this.wpN[i] === 0) this.arrive(i);
  }

  free(i: number) {
    if (this.state[i] === ST.FREE) return;
    this.state[i] = ST.FREE;
    this.active--;
    this.dirtyFree = true;
  }

  private arrive(i: number) {
    const e = this.end[i];
    if (e === END.IDLE) {
      this.state[i] = ST.IDLE;
      this.yaw[i] = this.faceYaw[i];
    } else this.state[i] = ST.LEAVING;
  }

  step(dt: number) {
    for (let i = 0; i < this.cap; i++) {
      const st = this.state[i];
      if (st === ST.FREE) continue;
      if (st === ST.LEAVING) {
        this.scale[i] -= dt * (this.end[i] === END.BOARD ? 7 : 1.4);
        if (this.scale[i] <= 0.02) this.free(i);
        continue;
      }
      if (this.scale[i] < 1) this.scale[i] = Math.min(1, this.scale[i] + dt * 2.5);
      if (st !== ST.WALK) continue;
      this.phase[i] += dt * this.speed[i] * 7;
      let budget = this.speed[i] * dt;
      while (budget > 0 && this.wpI[i] < this.wpN[i]) {
        const o = (i * MAX_WP + this.wpI[i]) * 3;
        const dx = this.wp[o] - this.x[i];
        const dy = this.wp[o + 1] - this.y[i];
        const dz = this.wp[o + 2] - this.z[i];
        const flat = Math.hypot(dx, dz);
        const d = Math.hypot(flat, dy);
        if (flat > 0.05) this.yaw[i] = Math.atan2(dx, dz);
        if (d <= budget) {
          this.x[i] = this.wp[o];
          this.y[i] = this.wp[o + 1];
          this.z[i] = this.wp[o + 2];
          budget -= d;
          this.wpI[i]++;
        } else {
          const k = budget / d;
          this.x[i] += dx * k;
          this.y[i] += dy * k;
          this.z[i] += dz * k;
          budget = 0;
        }
      }
      if (this.wpI[i] >= this.wpN[i]) this.arrive(i);
    }
  }
}
