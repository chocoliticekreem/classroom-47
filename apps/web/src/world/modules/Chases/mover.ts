// A vehicle that drives the road graph for the Chases module: path following (reusing Traffic's pure
// curve/advance helpers), lateral offsets for overtaking on the wrong side and mounting the kerb,
// a "free" mode for scripted moves (spins, crashes, boxing in), and its registry entry.
import { Object3D } from "three";
import { registerVehicle, nextId, vehiclesAhead, type VehicleEntry, type VehicleKind } from "../../registry";
import { edgeKey, getEdge } from "../../roads";
import { advance, poseAt, smoothPose, type Pose, type PoseOffset } from "../Traffic/driving";

export const OVERTAKE_LAT = 4; // metres to the right: the oncoming lane
export const KERB_LAT = -2.7; // metres to the left: up on the pavement

export class Mover {
  path: string[] = [];
  idx = 0;
  t = 0;
  speed = 0;
  lat = 0;
  latTarget = 0;
  latVel = 0;
  free = false; // scripted pose: path following paused
  active = false;
  pose: Pose = { x: 0, z: 0, h: 0 };
  readonly target: Pose = { x: 0, z: 0, h: 0 };
  readonly off: PoseOffset = { x: 0, z: 0, h: 0 };
  // rendered extras
  yaw = 0; // extra heading (skids, spins)
  roll = 0;
  pitch = 0;
  lift = 0; // y offset (kerb)
  stuck = 0; // seconds stopped (owner's safety nets)
  half: number;
  readonly entry: VehicleEntry;
  private unregister: (() => void) | null = null;

  constructor(
    readonly object: Object3D,
    kind: VehicleKind,
    half: number,
  ) {
    this.half = half;
    this.entry = {
      id: "", kind, object: new Object3D(), edgeKey: null, from: null, to: null, t: 0, speed: 0, stopped: false,
      crash: () => false, // chase vehicles stage their own crashes
    };
  }

  get from() {
    return this.path[this.idx];
  }
  get to() {
    return this.path[this.idx + 1];
  }
  get edgeLen() {
    return getEdge(this.from, this.to)?.length ?? 1;
  }
  get limit() {
    return getEdge(this.from, this.to)?.speedLimit ?? 11;
  }
  get remaining() {
    return (1 - this.t) * this.edgeLen;
  }

  /** Put the vehicle on `path` at (idx, t), snap its pose, show it and register it. */
  spawn(path: string[], idx: number, t: number, speed: number, idPrefix: string) {
    this.path = path;
    this.idx = idx;
    this.t = t;
    this.speed = speed;
    this.lat = this.latTarget = this.latVel = 0;
    this.yaw = this.roll = this.pitch = this.lift = 0;
    this.off.x = this.off.z = this.off.h = 0;
    this.free = false;
    this.stuck = 0;
    poseAt(this.path, this.idx, this.t, this.pose);
    this.active = true;
    this.object.visible = true;
    this.entry.id = nextId(idPrefix);
    this.sync();
    this.unregister?.();
    this.unregister = registerVehicle(this.entry);
  }

  despawn() {
    this.active = false;
    this.object.visible = false;
    this.unregister?.();
    this.unregister = null;
  }

  /** Re-enter the road graph on edge from -> to at t (after a scripted move); the pose glides back. */
  rejoin(from: string, to: string, t: number, tail: string[]) {
    this.path = [from, to, ...tail.slice(tail[0] === to ? 1 : 0)];
    this.idx = 0;
    this.t = Math.min(0.95, Math.max(0, t));
    this.free = false;
    this.stuck = 0;
    this.latTarget = 0;
    poseAt(this.path, 0, this.t, this.target);
    this.off.x = this.pose.x - this.target.x;
    this.off.z = this.pose.z - this.target.z;
    this.off.h = Math.atan2(Math.sin(this.pose.h + this.yaw - this.target.h), Math.cos(this.pose.h + this.yaw - this.target.h));
    this.yaw = 0;
  }

  /** Move ds metres along the path. Returns the number of junctions passed. */
  move(ds: number) {
    if (this.path.length < 2) return 0;
    const n = advance(this, ds);
    if (this.idx > 6) {
      this.path.splice(0, this.idx - 1);
      this.idx = 1;
    }
    return n;
  }

  /** Nearest registered vehicle ahead on our lane (this edge, then the next one), as a gap in metres. */
  lead(): { gap: number; speed: number; v: VehicleEntry | null } {
    const len = this.edgeLen;
    const here = vehiclesAhead(this.from, this.to, this.t, this.entry.id);
    if (here.length) return { gap: (here[0].t - this.t) * len - this.half - 2.4, speed: here[0].speed, v: here[0] };
    if (this.idx + 2 < this.path.length && this.remaining < 35) {
      const next = vehiclesAhead(this.to, this.path[this.idx + 2], -1, this.entry.id);
      if (next.length) {
        const l2 = getEdge(this.to, this.path[this.idx + 2])?.length ?? 1;
        return { gap: this.remaining + next[0].t * l2 - this.half - 2.4, speed: next[0].speed, v: next[0] };
      }
    }
    return { gap: Infinity, speed: 0, v: null };
  }

  /** Any vehicle coming the other way on this edge within `metres` ahead of us? */
  oncoming(metres: number): boolean {
    const len = this.edgeLen;
    const mine = this.t * len;
    // on the reverse lane, t runs from our `to`; their position along our direction is (1 - t) * len
    for (const v of vehiclesAhead(this.to, this.from, -1, this.entry.id)) {
      const along = (1 - v.t) * len;
      if (along > mine - 3 && along < mine + metres) return true;
    }
    return false;
  }

  /** Compute the rendered pose (path pose + smoothing + lateral offset) and write it to the object and registry. */
  update(dt: number) {
    if (!this.free && this.path.length >= 2) {
      // lateral: ease towards the target lane offset
      const d = this.latTarget - this.lat;
      const want = Math.max(-5, Math.min(5, d * 3));
      this.latVel += (want - this.latVel) * Math.min(1, dt * 6);
      this.lat += this.latVel * dt;
      poseAt(this.path, this.idx, this.t, this.target);
      smoothPose(this.pose, this.target, this.off, dt, this.speed * dt * 1.6 + 0.15, this.pose);
    }
    this.sync();
  }

  private sync() {
    const h = this.pose.h;
    const lat = this.free ? 0 : this.lat;
    const x = this.pose.x - Math.cos(h) * lat;
    const z = this.pose.z + Math.sin(h) * lat;
    const steer = this.free ? 0 : -Math.atan2(this.latVel, Math.max(this.speed, 2));
    this.object.position.set(x, this.lift, z);
    this.object.rotation.set(this.pitch, h + this.yaw + steer, this.roll, "YXZ");
    const e = this.entry;
    e.object.position.set(x, 0, z);
    e.object.rotation.y = h + this.yaw + steer;
    if (this.path.length >= 2) {
      // over in the oncoming lane: register on that lane so oncoming traffic sees (and brakes for) us
      const rev = lat > 3;
      e.from = rev ? this.to : this.from;
      e.to = rev ? this.from : this.to;
      e.t = rev ? 1 - this.t : this.t;
      e.edgeKey = edgeKey(this.from, this.to);
    }
    e.speed = this.speed;
    e.stopped = this.speed < 0.3;
  }
}
