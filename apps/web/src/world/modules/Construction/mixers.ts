// Concrete mixer trucks: drive the public roads (left lane) from site to site, pull off onto a pad at
// each site's gate to pour, then reverse back out and head for the next one. Registered in the shared
// registry as "truck", obey signals and the vehicle ahead, and can be crashed. Client only.
import * as THREE from "three";
import { on } from "../../bus";
import { getVehicle, nextId, registerVehicle, vehiclesAhead, type VehicleEntry, type VehicleKind } from "../../registry";
import { Lookahead, type ObstacleFn } from "../DeliveryFleet/lookahead";
import { edgeKey, findPath, getEdge, getNode, lanePosition } from "../../roads";
import { hasSignal, signalFor } from "../../signals";
import { blockedSet, useWorld } from "../../store";
import {
  IDM, advance, idmAccel, laneObstacle, needsReroute, poseAt, replanPath, signalDecision, smoothPose,
  type LaneEntry, type Pose, type PoseOffset,
} from "../Traffic/driving";
import { MIXER, mixerBody, mixerDrum } from "./parts";
import type { SiteLayout } from "./sites";

export const MIXER_COUNT = 7;
const HALF = MIXER.half;
const STOP_LINE = 5.2;
const HALF_W = 1.25; // body half-width for the look-ahead corridor
const JUNCTION_R = 10; // a vehicle this close to the node we're about to enter is "in the junction"
const KIND_HALF: Record<VehicleKind, number> = {
  car: 2.2, taxi: 2.25, bus: 5.3, van: 2.8, truck: 4.5, police: 2.4, ambulance: 3, fire: 4, roadworks: 3.5, tow: 3.5, cyclist: 0.9, motorcade: 2.6,
};

type Mode = "drive" | "enter" | "pour" | "exit" | "crashed";

interface Mixer {
  slot: number;
  entry: VehicleEntry;
  look: Lookahead;
  unregister: () => void;
  mode: Mode;
  path: string[];
  idx: number;
  t: number;
  speed: number;
  committed: boolean;
  stillFor: number;
  checkIn: number;
  site: number; // destination (or current) site
  pad: number;
  pose: Pose;
  target: Pose;
  off: PoseOffset;
  road: Pose; // where we left the lane
  roadFrom: string; // the edge we left it on (roadFrom -> gate node)
  roadT: number;
  u: number;
  dur: number;
  pourLeft: number;
  drum: number;
  crashT: number;
  crashFrom: Pose;
  crashV: number;
  crashYaw: number;
  crashRoll: number;
  crashedAt: number;
  roll: number;
}

/** t on edge a->b where a mixer stops before turning onto the site pad (≈10 m short of the node). */
export function stopT(len: number) {
  return Math.max(0.3, 1 - Math.min(10, len * 0.5) / len);
}

/** Cubic between two poses with forward tangents; out gets position + heading (forward along the curve). */
export function pullInPose(a: Pose, b: Pose, u: number, out: Pose): Pose {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const k = d * 0.42;
  const x1 = a.x + Math.sin(a.h) * k;
  const z1 = a.z + Math.cos(a.h) * k;
  const x2 = b.x - Math.sin(b.h) * k;
  const z2 = b.z - Math.cos(b.h) * k;
  const v = 1 - u;
  out.x = v * v * v * a.x + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * b.x;
  out.z = v * v * v * a.z + 3 * v * v * u * z1 + 3 * v * u * u * z2 + u * u * u * b.z;
  const dx = 3 * v * v * (x1 - a.x) + 6 * v * u * (x2 - x1) + 3 * u * u * (b.x - x2);
  const dz = 3 * v * v * (z1 - a.z) + 6 * v * u * (z2 - z1) + 3 * u * u * (b.z - z2);
  out.h = dx * dx + dz * dz > 1e-9 ? Math.atan2(dx, dz) : b.h;
  return out;
}

/** Choose the next site: a different gate node, with a free pad, reachable. Returns [site, pad] or null. */
export function chooseNext(
  sites: readonly SiteLayout[], from: number, busy: ReadonlySet<string>, blocked: ReadonlySet<string>, rand: () => number,
): [number, number] | null {
  const order = sites.map((_, i) => i).sort(() => rand() - 0.5);
  for (const i of order) {
    if (i === from || sites[i].gateNode === sites[from]?.gateNode) continue;
    for (let p = 0; p < sites[i].pads.length; p++) {
      if (busy.has(`${i}:${p}`)) continue;
      if (from >= 0 && !findPath(sites[from].gateNode, sites[i].gateNode, blocked)) break;
      return [i, p];
    }
  }
  return null;
}

const mat = new THREE.Matrix4();
const mat2 = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const pos = new THREE.Vector3();
const one = new THREE.Vector3(1, 1, 1);
const scl = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const Y_UP = new THREE.Vector3(0, 1, 0);
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const hit: LaneEntry = { t: 0, speed: 0, half: 0 };
const rand = Math.random;

export class MixerFleet {
  readonly body: THREE.InstancedMesh;
  readonly drum: THREE.InstancedMesh;
  readonly shadow: THREE.InstancedMesh;
  private mixers: Mixer[] = [];
  private busy = new Set<string>();
  private blocked = new Set<string>();
  private blockedDirty = true;
  private cleanup: (() => void)[] = [];
  private disposables: { dispose(): void }[] = [];
  private selfId = "";
  /** On-screen test (the renderer sets a camera frustum check); off-screen mixers raycast every 4th frame. */
  sees: (x: number, z: number) => boolean = () => true;
  private readonly obstacleFn: ObstacleFn | undefined;

  constructor(
    private sites: SiteLayout[],
    opts: { obstacleFn?: ObstacleFn } = {},
  ) {
    this.obstacleFn = opts.obstacleFn;
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15, flatShading: true });
    const sm = new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.28, depthWrite: false });
    const bodyG = mixerBody();
    const drumG = mixerDrum();
    const disc = new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2);
    this.disposables.push(m, sm, bodyG, drumG, disc);
    const mk = (g: THREE.BufferGeometry, mt: THREE.Material, name: string, cast: boolean) => {
      const im = new THREE.InstancedMesh(g, mt, MIXER_COUNT);
      im.name = `construction-mixer-${name}`;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.castShadow = cast;
      im.receiveShadow = cast;
      for (let i = 0; i < MIXER_COUNT; i++) im.setMatrixAt(i, mat.makeScale(0, 0, 0));
      return im;
    };
    this.body = mk(bodyG, m, "body", true);
    this.drum = mk(drumG, m, "drum", true);
    this.shadow = mk(disc, sm, "shadow", false);
    this.shadow.renderOrder = 1;
  }

  /** Read-only view for tests and debugging. */
  state() {
    return this.mixers.map((m) => ({
      id: m.entry.id, mode: m.mode, site: m.site, pad: m.pad, x: m.pose.x, z: m.pose.z, h: m.pose.h,
      speed: m.speed, from: m.path[m.idx] ?? null, to: m.path[m.idx + 1] ?? null, t: m.t, last: m.idx + 2 >= m.path.length,
    }));
  }

  idAt(instanceId: number) {
    return this.mixers[instanceId]?.entry.id ?? null;
  }

  start() {
    if (!this.sites.length) return;
    this.blocked = blockedSet();
    for (let i = 0; i < MIXER_COUNT; i++) {
      const p = (): Pose => ({ x: 0, z: 0, h: 0 });
      const entry: VehicleEntry = {
        id: "", kind: "truck", object: new THREE.Object3D(), edgeKey: null, from: null, to: null, t: 0, speed: 0, stopped: true,
      };
      const look = new Lookahead({ halfLength: HALF, halfWidth: HALF_W, decel: IDM.bComf, standoff: 0 }, this.obstacleFn, i);
      const mx: Mixer = {
        slot: i, entry, look, unregister: () => {}, mode: "pour", path: [], idx: 0, t: 0, speed: 0, committed: false, stillFor: 0,
        checkIn: 1, site: 0, pad: 0, pose: p(), target: p(), off: { x: 0, z: 0, h: 0 }, road: p(), roadFrom: "", roadT: 0,
        u: 0, dur: 1, pourLeft: 0, drum: rand() * 6, crashT: 0, crashFrom: p(), crashV: 0, crashYaw: 0, crashRoll: 0,
        crashedAt: 0, roll: 0,
      };
      entry.crash = () => this.crash(mx);
      this.mixers.push(mx);
      const site = i % this.sites.length;
      const pad = Math.floor(i / this.sites.length) % this.sites[site].pads.length;
      this.parkAt(mx, site, pad, 2 + i * 2.5);
    }
    this.cleanup.push(
      useWorld.subscribe((s, prev) => {
        if (s.blocked !== prev.blocked) this.blockedDirty = true;
      }),
      on((e) => {
        if (e.type === "incident:cleared") this.onCleared(e.incidentId);
      }),
    );
  }

  stop() {
    for (const c of this.cleanup) c();
    this.cleanup = [];
    for (const m of this.mixers) m.unregister();
    this.mixers = [];
    this.busy.clear();
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }

  /** Put a mixer on a site's pad, pouring, as if it had just pulled in from the site's approach road. */
  private parkAt(m: Mixer, site: number, pad: number, pourS: number) {
    m.unregister();
    this.release(m);
    const s = this.sites[site];
    m.site = site;
    m.pad = pad;
    this.busy.add(`${site}:${pad}`);
    const len = getEdge(s.approachNode, s.gateNode)?.length ?? 20;
    m.roadFrom = s.approachNode;
    m.roadT = stopT(len);
    const [x, z, h] = lanePosition(s.approachNode, s.gateNode, m.roadT);
    m.road.x = x;
    m.road.z = z;
    m.road.h = h;
    const p = s.pads[pad];
    m.pose.x = p.x;
    m.pose.z = p.z;
    m.pose.h = p.h;
    m.mode = "pour";
    m.pourLeft = pourS;
    m.speed = 0;
    m.roll = 0;
    m.entry.id = nextId("mixer");
    this.sync(m);
    m.unregister = registerVehicle(m.entry);
  }

  private release(m: Mixer) {
    this.busy.delete(`${m.site}:${m.pad}`);
  }

  private crash(m: Mixer): boolean {
    if (m.mode !== "drive") return false;
    m.mode = "crashed";
    m.crashFrom.x = m.pose.x;
    m.crashFrom.z = m.pose.z;
    m.crashFrom.h = m.pose.h;
    m.crashV = Math.max(m.speed, 5);
    m.crashYaw = (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.45);
    m.crashRoll = (rand() < 0.5 ? -1 : 1) * (0.04 + rand() * 0.04);
    m.crashT = 0;
    m.crashedAt = performance.now();
    m.speed = 0;
    m.entry.stopped = true;
    m.entry.speed = 0;
    this.release(m);
    return true;
  }

  private onCleared(incidentId: string) {
    const inc = useWorld.getState().incidents.find((i) => i.id === incidentId);
    if (!inc) return;
    for (const m of this.mixers)
      if (m.mode === "crashed" && Math.hypot(m.pose.x - inc.x, m.pose.z - inc.z) < 25) this.respawn(m);
  }

  /** Back to a free pad somewhere (crash cleared, or hopelessly stuck). */
  private respawn(m: Mixer) {
    this.release(m);
    const next = chooseNext(this.sites, -1, this.busy, this.blocked, rand);
    if (next) this.parkAt(m, next[0], next[1], 6 + rand() * 6);
  }

  /** Leave the pad: plan the route to the next site starting from the lane we pulled off. */
  private depart(m: Mixer): boolean {
    const next = chooseNext(this.sites, m.site, this.busy, this.blocked, rand);
    if (!next) return false;
    const s = this.sites[m.site];
    const tail = findPath(s.gateNode, this.sites[next[0]].gateNode, this.blocked);
    if (!tail || tail.length < 2) return false;
    this.release(m);
    m.site = next[0];
    m.pad = next[1];
    this.busy.add(`${m.site}:${m.pad}`);
    m.path = [m.roadFrom, ...tail];
    m.idx = 0;
    m.t = m.roadT;
    return true;
  }

  // --- per frame ---------------------------------------------------------------------------------

  step(dt: number, now: number) {
    if (this.blockedDirty) {
      this.blocked = blockedSet();
      this.blockedDirty = false;
      for (const m of this.mixers) if (m.mode === "drive") this.reroute(m);
    }
    for (const m of this.mixers) {
      switch (m.mode) {
        case "drive":
          this.drive(m, dt, now);
          break;
        case "enter":
        case "exit":
          this.pull(m, dt);
          break;
        case "pour":
          m.pourLeft -= dt;
          m.drum -= dt * 2.6; // discharging: drum turns backwards, fast
          if (m.pourLeft <= 0) {
            if (this.depart(m)) {
              m.mode = "exit";
              m.u = 1;
              m.dur = Math.hypot(m.road.x - m.pose.x, m.road.z - m.pose.z) / 2 + 2;
            } else m.pourLeft = 3;
          }
          this.sync(m);
          break;
        case "crashed":
          this.crashed(m, dt);
          if (now - m.crashedAt > 150_000) this.respawn(m);
          break;
      }
      if (m.mode === "drive" || m.mode === "enter" || m.mode === "exit") m.drum += dt * 0.9; // mixing
    }
  }

  private lookup = (from: string, to: string, afterT: number): LaneEntry | null => {
    const ahead = vehiclesAhead(from, to, afterT, this.selfId);
    if (!ahead.length) return null;
    const v = ahead[0];
    hit.t = v.t;
    hit.speed = v.speed;
    hit.half = KIND_HALF[v.kind] ?? 2.5;
    return hit;
  };

  private reroute(m: Mixer) {
    if (!needsReroute(m.path, m.idx, this.blocked)) return;
    const r = replanPath(m.path, m.idx, this.sites[m.site].gateNode, this.blocked);
    if (r) {
      m.path = r.path;
      m.idx = r.idx;
      return;
    }
    // destination cut off: try another site from the next node
    const here = m.path[m.idx + 1];
    this.release(m);
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[(m.site + 1 + i) % this.sites.length];
      const tail = findPath(here, s.gateNode, this.blocked);
      if (tail && tail.length >= 2) {
        const si = (m.site + 1 + i) % this.sites.length;
        const pad = this.busy.has(`${si}:0`) ? 1 : 0;
        m.site = si;
        m.pad = pad;
        this.busy.add(`${si}:${pad}`);
        m.path = [...m.path.slice(Math.max(0, m.idx - 1), m.idx + 1), ...tail];
        m.idx = Math.min(m.idx, 1);
        return;
      }
    }
    this.busy.add(`${m.site}:${m.pad}`);
  }

  private drive(m: Mixer, dt: number, now: number) {
    this.selfId = m.entry.id;
    m.checkIn -= dt;
    if (m.checkIn <= 0) {
      m.checkIn = 1.5;
      this.reroute(m);
    }
    const a = m.path[m.idx];
    const b = m.path[m.idx + 1];
    const edge = getEdge(a, b);
    if (!edge) {
      this.respawn(m);
      return;
    }
    const len = edge.length;
    const last = m.idx + 2 >= m.path.length;
    const v = m.speed;
    const v0 = Math.min(edge.speedLimit, 15) * 0.85;

    const lead = laneObstacle(m.path, m.idx, m.t, HALF, this.lookup);
    let gap = lead.gap;
    let closing = v - lead.speed;
    let atSignal = false;
    const consider = (g: number) => {
      if (g < gap) {
        gap = g;
        closing = v;
      }
    };
    const distToNode = (1 - m.t) * len;
    if (!last && hasSignal(b)) {
      const distToLine = distToNode - STOP_LINE - HALF;
      const act = signalDecision(signalFor(b, a, now), distToLine, v, m.committed);
      if (act === "commit") m.committed = true;
      else if (act === "stop") {
        consider(distToLine + IDM.s0);
        atSignal = true;
      }
    }
    // look-ahead raycast (bumper gap for the IDM); give way at the line to a vehicle sitting in the junction
    const look = m.look;
    look.scan(m.entry.id, m.pose.x, m.pose.z, m.pose.h, v, dt, this.sees(m.pose.x, m.pose.z));
    if (look.hitId) {
      const toLine = distToNode - STOP_LINE - HALF;
      const n = !last && toLine > 0 ? getNode(b) : null;
      if (n && look.hitInJunction(n.x, n.z, JUNCTION_R)) consider(toLine + IDM.s0);
      if (look.room < gap) {
        const o = look.hitStopped ? undefined : getVehicle(look.hitId);
        gap = look.room;
        closing = v - (o ? Math.max(0, o.speed * Math.cos(o.object.rotation.y - m.pose.h)) : 0);
      }
    }
    if (!last && this.blocked.has(edgeKey(b, m.path[m.idx + 2]))) consider(distToNode - STOP_LINE - HALF + IDM.s0);
    // arriving: stop short of the gate node, then pull onto the pad
    const tStop = stopT(len);
    if (last) consider((tStop - m.t) * len + IDM.s0);

    const acc = idmAccel(v, v0, gap, closing);
    let nv = Math.max(0, v + acc * dt);
    let ds = nv * dt;
    if (Number.isFinite(gap)) {
      const room = Math.max(0, gap - 0.4);
      if (ds > room) {
        ds = room;
        nv = Math.min(nv, room / dt);
      }
    }
    m.speed = nv;
    if (last) ds = Math.min(ds, Math.max(0, (tStop - m.t) * len));
    const entered = advance(m, ds);
    if (entered) {
      m.committed = false;
      if (m.idx > 4) {
        m.path.splice(0, m.idx - 1);
        m.idx = 1;
      }
    }

    if (last && (tStop - m.t) * len < 0.6 && nv < 1.5) {
      // pull in
      const s = this.sites[m.site];
      m.roadFrom = a;
      m.roadT = m.t;
      m.road.x = m.pose.x;
      m.road.z = m.pose.z;
      m.road.h = m.pose.h;
      m.mode = "enter";
      m.u = 0;
      const p = s.pads[m.pad];
      m.dur = Math.hypot(p.x - m.pose.x, p.z - m.pose.z) / 3 + 1.5;
      m.speed = 3;
      this.sync(m);
      return;
    }

    if (nv < 0.3 && !atSignal) {
      m.stillFor += dt;
      if (m.stillFor > 40) {
        m.stillFor = 0;
        this.respawn(m);
        return;
      }
    } else m.stillFor = 0;

    poseAt(m.path, m.idx, m.t, m.target);
    smoothPose(m.pose, m.target, m.off, dt, nv * dt * 1.6 + 0.12, m.pose);
    this.sync(m);
  }

  private pull(m: Mixer, dt: number) {
    const s = this.sites[m.site];
    const p = s.pads[m.pad];
    const pad: Pose = this.padPose;
    pad.x = p.x;
    pad.z = p.z;
    pad.h = p.h;
    if (m.mode === "enter") {
      m.u = Math.min(1, m.u + dt / m.dur);
      pullInPose(m.road, pad, m.u * m.u * (3 - 2 * m.u), m.pose);
      m.speed = 2.5;
      if (m.u >= 1) {
        m.mode = "pour";
        m.pourLeft = 9 + rand() * 6;
        m.speed = 0;
      }
    } else {
      // reversing out along the same curve
      m.u = Math.max(0, m.u - dt / m.dur);
      pullInPose(m.road, pad, m.u * m.u * (3 - 2 * m.u), m.pose);
      m.speed = 2;
      if (m.u <= 0) {
        m.mode = "drive";
        m.off.x = m.off.z = m.off.h = 0;
        m.speed = 0;
        m.committed = false;
        m.stillFor = 0;
      }
    }
    this.sync(m);
  }
  private padPose: Pose = { x: 0, z: 0, h: 0 };

  private crashed(m: Mixer, dt: number) {
    const DUR = 1.3;
    m.crashT += dt;
    const u = Math.min(1, m.crashT / DUR);
    const e = 1 - (1 - u) * (1 - u);
    const dist = m.crashV * DUR * 0.45 * e;
    const fx = Math.sin(m.crashFrom.h);
    const fz = Math.cos(m.crashFrom.h);
    const side = m.crashYaw > 0 ? -0.25 : 0.25;
    m.pose.x = m.crashFrom.x + fx * dist + fz * side * dist;
    m.pose.z = m.crashFrom.z + fz * dist - fx * side * dist;
    m.pose.h = m.crashFrom.h + m.crashYaw * e;
    m.roll = m.crashRoll * e;
    m.entry.object.position.set(m.pose.x, 0, m.pose.z);
    m.entry.object.rotation.set(0, m.pose.h, m.roll, "YXZ");
  }

  private sync(m: Mixer) {
    const e = m.entry;
    if (m.mode === "drive") {
      e.from = m.path[m.idx];
      e.to = m.path[m.idx + 1];
      e.t = m.t;
      e.edgeKey = edgeKey(e.from, e.to);
    } else {
      e.from = e.to = e.edgeKey = null;
      e.t = 0;
    }
    e.speed = m.speed;
    e.stopped = m.mode === "pour" || m.mode === "crashed" || m.speed < 0.3;
    e.object.position.set(m.pose.x, 0, m.pose.z);
    e.object.rotation.set(0, m.pose.h, m.roll, "YXZ");
  }

  // --- rendering -----------------------------------------------------------------------------------

  render() {
    for (let i = 0; i < MIXER_COUNT; i++) {
      const m = this.mixers[i];
      if (!m) continue;
      pos.set(m.pose.x, Math.abs(Math.sin(m.roll)) * 1.2, m.pose.z);
      euler.set(0, m.pose.h, m.roll, "YXZ");
      quat.setFromEuler(euler);
      mat.compose(pos, quat, one);
      this.body.setMatrixAt(i, mat);
      // drum: truck frame -> drum centre -> tilt (rear up) -> spin about its own axis
      qa.setFromAxisAngle(X, MIXER.drumTilt);
      qb.setFromAxisAngle(Z, m.drum);
      qa.multiply(qb);
      mat2.compose(pos.set(MIXER.drumC[0], MIXER.drumC[1], MIXER.drumC[2]), qa, one);
      this.drum.setMatrixAt(i, mat2.premultiply(mat));
      pos.set(m.pose.x, 0.07, m.pose.z);
      quat.setFromAxisAngle(Y_UP, m.pose.h);
      mat.compose(pos, quat, scl.set(1.6, 1, HALF * 1.05));
      this.shadow.setMatrixAt(i, mat);
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.drum.instanceMatrix.needsUpdate = true;
    this.shadow.instanceMatrix.needsUpdate = true;
  }
}
