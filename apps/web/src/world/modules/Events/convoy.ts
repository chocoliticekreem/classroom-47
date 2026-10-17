// A rigid convoy along a route track: one lead distance `s`, every member a fixed gap behind it (and a
// lateral offset). Speed control: cruise, slow for turns and the end, brake for whatever is ahead, and
// creep past a stuck car after a while (police wave it aside). Pure (no three).
import type { RouteTrack } from "./route";

export interface Member {
  offset: number; // metres behind the lead
  lateral: number; // metres to the right of the lane centre (towards the road centre line)
}

export const CONVOY = {
  accel: 2.2,
  brake: 6,
  turnSpeed: 7,
  turnLook: 26,
  endBrake: 2.2,
  stuckS: 4,
  ghostS: 3,
  ghostSpeed: 3, // slow enough that brushing a car is not a crash
};

export class Convoy {
  s: number;
  speed = 0;
  private stuckFor = 0;
  private ghostFor = 0;
  readonly span: number;

  constructor(readonly track: RouteTrack, readonly members: readonly Member[], public cruise = 14, startS = 0) {
    this.s = startS;
    this.span = members.reduce((m, x) => Math.max(m, x.offset), 0);
  }

  /** Lead target speed at its current position, ignoring obstacles. */
  targetSpeed(): number {
    let v = this.cruise;
    const turn = this.track.nextTurn(this.s);
    if (turn < CONVOY.turnLook) v = Math.min(v, CONVOY.turnSpeed + (this.cruise - CONVOY.turnSpeed) * Math.max(0, turn / CONVOY.turnLook) * 0.5);
    const rem = Math.max(0, this.track.length - 0.5 - this.s);
    v = Math.min(v, Math.sqrt(2 * CONVOY.endBrake * rem));
    return v;
  }

  /**
   * Advance by dt seconds. `obstacle`: metres from the lead's nose to the nearest non-convoy vehicle ahead
   * in its lane (Infinity when clear).
   */
  step(dt: number, obstacle = Infinity) {
    let target = this.targetSpeed();
    if (this.ghostFor > 0) {
      this.ghostFor -= dt;
      target = Math.min(target, CONVOY.ghostSpeed);
    } else if (obstacle < 40) {
      target = Math.min(target, Math.max(0, (obstacle - 4) * 0.7));
      if (this.speed < 0.3 && obstacle < 14) {
        this.stuckFor += dt;
        if (this.stuckFor > CONVOY.stuckS) {
          this.stuckFor = 0;
          this.ghostFor = CONVOY.ghostS;
        }
      } else this.stuckFor = 0;
    } else this.stuckFor = 0;
    const dv = target - this.speed;
    this.speed += Math.max(-CONVOY.brake * dt, Math.min(CONVOY.accel * dt, dv));
    if (this.speed < 0) this.speed = 0;
    this.s = Math.min(this.track.length - 0.5, this.s + this.speed * dt);
  }

  memberS(i: number) {
    return this.s - this.members[i].offset;
  }

  /** Route edge index under the lead / under the last member (clamped to the route). */
  headIdx() {
    return this.track.edgeAt(this.s);
  }

  tailIdx() {
    return this.track.edgeAt(Math.max(0, this.s - this.span));
  }

  get arrived() {
    return this.s >= this.track.length - 1 && this.speed < 0.2;
  }

  get ghosting() {
    return this.ghostFor > 0;
  }
}
