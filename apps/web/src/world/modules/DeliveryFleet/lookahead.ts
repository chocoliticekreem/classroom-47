// Look-ahead braking shared by the fleet, buses, container lorries, mixers, roadworks trucks and
// responders: cast physics.obstacleAhead() along the vehicle's heading, turn the hit into "metres of road
// I can still use", and cap speed so the vehicle stops smoothly short of it. Works whether or not the
// physics raycast is implemented yet (the stub returns null, so everything just drives as before).
// Allocation-free per frame; the obstacle function is injectable for tests.
import { Frustum, Matrix4, Sphere, Vector3, type Camera } from "three";
import { obstacleAhead, type Hit } from "../../physics";
import { getVehicle } from "../../registry";

export type ObstacleFn = (selfId: string, x: number, z: number, heading: number, range: number, halfWidth: number) => Hit | null;

export interface LookSpec {
  /** Centre to front bumper (m). The ray starts at the centre, so this is subtracted from hits. */
  halfLength: number;
  /** Vehicle half-width (m); the corridor adds 0.3 either side. */
  halfWidth: number;
  /** Braking rate (m/s²) used both for the stopping-distance range and for the speed cap. */
  decel: number;
  /** Extra look-ahead beyond the stopping distance (m). Default 5. */
  buffer?: number;
  /** Gap kept to the obstacle at a standstill (m). Default 2. */
  standoff?: number;
}

export const DEFAULT_BUFFER = 5;
export const CORRIDOR_PAD = 0.3;
/** Off-screen vehicles only cast every Nth frame (and coast on the cached hit in between). */
export const OFFSCREEN_EVERY = 4;
/** Stalled behind the same raycast hit this long: ignore it briefly so two vehicles can't deadlock. */
export const PATIENCE_S = 7;
const IGNORE_S = 1.5;

/** Stopping distance at speed v with braking `decel`, plus the buffer: the ray's reach past the bumper. */
export function lookRange(v: number, decel: number, buffer = DEFAULT_BUFFER) {
  return (v * v) / (2 * Math.max(decel, 0.1)) + buffer;
}

/** Highest speed that can still stop within `room` metres braking at `decel`. */
export function stopSpeed(room: number, decel: number) {
  return room > 0 ? Math.sqrt(2 * decel * room) : 0;
}

/** Is registry vehicle `id` within `r` metres of (x, z)? (Used for "something is in the junction".) */
export function vehicleNear(id: string, x: number, z: number, r: number) {
  const v = getVehicle(id);
  if (!v) return false;
  const p = v.object.position;
  const dx = p.x - x;
  const dz = p.z - z;
  return dx * dx + dz * dz < r * r;
}

/**
 * Per-vehicle look-ahead state. Call scan() once per frame from the vehicle's update; read `room`
 * (metres of usable road in front of the bumper, Infinity when clear) and `hitId`.
 */
export class Lookahead {
  /** Usable metres ahead of the front bumper before the standoff gap; Infinity when nothing is ahead. */
  room = Infinity;
  hitId = "";
  hitStopped = false;
  private frame: number;
  private stalled = 0;
  private ignoreFor = 0;
  private ignoreId = "";
  /** Look-ahead past the stopping distance; mutable (e.g. responders shorten it with blues on). */
  buffer: number;
  readonly standoff: number;

  constructor(
    readonly spec: LookSpec,
    public fn: ObstacleFn = obstacleAhead,
    phase = 0,
  ) {
    this.buffer = spec.buffer ?? DEFAULT_BUFFER;
    this.standoff = spec.standoff ?? 2;
    this.frame = phase % OFFSCREEN_EVERY;
  }

  /**
   * Cast (every frame when `visible`, every OFFSCREEN_EVERY frames otherwise) from the vehicle centre.
   * `speed` is the current speed, `dt` the frame time (for coasting on a cached hit and patience).
   */
  scan(selfId: string, x: number, z: number, heading: number, speed: number, dt: number, visible = true): number {
    this.frame = (this.frame + 1) % OFFSCREEN_EVERY;
    if (this.ignoreFor > 0) this.ignoreFor -= dt;
    if (visible || this.frame === 0) {
      const s = this.spec;
      const range = s.halfLength + lookRange(speed, s.decel, this.buffer);
      let hit: Hit | null = null;
      try {
        hit = this.fn(selfId, x, z, heading, range, s.halfWidth + CORRIDOR_PAD);
      } catch {
        hit = null; // a physics bug must never stop the traffic
      }
      if (hit && this.ignoreFor > 0 && hit.id === this.ignoreId) hit = null;
      if (hit && Number.isFinite(hit.dist)) {
        if (hit.id !== this.hitId) this.stalled = 0;
        this.hitId = hit.id;
        this.hitStopped = hit.stopped;
        this.room = Math.max(0, hit.dist - s.halfLength - this.standoff);
      } else this.clear();
    } else if (this.hitId) {
      // off-screen, between casts: assume the obstacle stayed put (cautious) and we closed on it
      this.room = Math.max(0, this.room - speed * dt);
    }
    // patience: sat still behind the same thing for ages -> look past it for a moment
    if (this.hitId && speed < 0.3 && this.room < 1) {
      this.stalled += dt;
      if (this.stalled > PATIENCE_S) {
        this.ignoreId = this.hitId;
        this.ignoreFor = IGNORE_S;
        this.stalled = 0;
        this.clear();
      }
    } else if (!this.hitId || speed > 1) this.stalled = 0;
    return this.room;
  }

  /** Speed cap from the current room (Infinity when clear). */
  cap(decel = this.spec.decel) {
    return Number.isFinite(this.room) ? stopSpeed(this.room, decel) : Infinity;
  }

  /** True when the current hit is a vehicle sitting within `r` metres of junction node (x, z). */
  hitInJunction(x: number, z: number, r = 10) {
    return this.hitId !== "" && vehicleNear(this.hitId, x, z, r);
  }

  clear() {
    this.room = Infinity;
    this.hitId = "";
    this.hitStopped = false;
  }
}

/** Camera frustum test for "is this vehicle on screen" (update once per frame, no allocations). */
export class ViewCheck {
  private frustum = new Frustum();
  private m = new Matrix4();
  private sphere = new Sphere(new Vector3(), 8);
  private ready = false;

  update(camera: Camera) {
    this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m);
    this.ready = true;
  }

  /** Before the first update everything counts as visible. */
  sees = (x: number, z: number, r = 8) => {
    if (!this.ready) return true;
    this.sphere.center.set(x, 1.5, z);
    this.sphere.radius = r;
    return this.frustum.intersectsSphere(this.sphere);
  };
}

/**
 * Test helper: report a stationary car-sized obstacle at world point (ox, oz) to vehicle `targetId` only,
 * at its straight-line distance (whatever the heading), as long as it's within range.
 */
export function obstacleAt(targetId: string, ox: number, oz: number, id = "test-obstacle"): ObstacleFn {
  const hit: Hit = { id, dist: 0, kind: "car", stopped: true };
  return (selfId, x, z, _heading, range) => {
    if (selfId !== targetId) return null;
    const d = Math.hypot(ox - x, oz - z) - 2.2; // near edge of a car footprint
    if (d > range) return null;
    hit.dist = Math.max(0, d);
    return hit;
  };
}
