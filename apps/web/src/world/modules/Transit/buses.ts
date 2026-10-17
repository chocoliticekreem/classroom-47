// London red double-deckers on 3 looping routes, plus their stops and the people using them.
// Imperative engine: build once, tick per frame. All buses share one set of instanced meshes.
import * as THREE from "three";
import { registerVehicle, vehiclesAhead, type VehicleEntry } from "../../registry";
import { Lookahead, type ObstacleFn } from "../DeliveryFleet/lookahead";
import { edgeKey, getEdge, getNode, lanePosition } from "../../roads";
import { hasSignal, signalFor } from "../../signals";
import { blockedSet, useWorld } from "../../store";
import { BUS_ROUTES, LoopNavigator, lanePose, type BusRoute, type BusStop, type Pose } from "./busRoutes";
import { growWaiting, planVisit } from "./crowd";
import { Rig, frame, local, std } from "./kit";
import { END, PassengerPool, ST } from "./passengers";
import { mulberry32 } from "./rng";
import { busBlindTexture, busStopTexture, timetableTexture } from "./textures";

const VMAX = 9.5; // m/s, a bit under the street limit
const ACCEL = 1.5;
const BRAKE = 3.2;
const STOP_LINE = 7; // metres before a signalled junction
const GAP = 11.5; // centre-to-centre spacing to the vehicle ahead
const BUS_HALF_LEN = 5.2;
const BUS_HALF_W = 1.25;
const JUNCTION_R = 10; // a vehicle this close to the node we're heading for is "in the junction"
const TURN_R = 6;
const PULL_IN = 0.9; // extra metres toward the kerb at a stop
const DOOR_LAT = PULL_IN + 1.35; // lane-relative lateral of the bus's nearside doors
const FRONT_DOOR = 3.6;
const MID_DOOR = -0.8;
const MIN_DWELL = 4;
const CAPACITY = 70;
const MAX_WAIT = 9;
const ARRIVAL_RATE = 0.09; // people per second per stop

interface Frame {
  x: number;
  z: number;
  h: number;
}

interface StopRt {
  stop: BusStop;
  fr: Frame; // origin on the left lane at the stop, facing the direction of travel
  agents: Int16Array;
  n: number;
}

const MODE = { DRIVE: 0, DWELL: 1 } as const;

interface Bus {
  id: string;
  route: BusRoute;
  slot: number; // index into the bus rig
  blindSlot: number; // index into this route's blind rig
  nav: LoopNavigator;
  prev: string | null;
  from: string;
  to: string | null;
  t: number;
  v: number;
  mode: number;
  dwellT: number;
  alightLeft: number;
  boardLeft: number;
  releaseT: number;
  lastEta: number;
  servedKey: string;
  onboard: number;
  crashed: boolean;
  crashT: number;
  stuckT: number;
  stopAt: StopRt | null;
  pose: Pose; // simulated
  shown: Pose; // displayed (smoothed)
  obj: THREE.Object3D;
  entry: VehicleEntry;
  look: Lookahead;
}

export interface BusOptions {
  /** Look-ahead raycast (defaults to physics.obstacleAhead); injectable for tests. */
  obstacleFn?: ObstacleFn;
}

/** World point at (along, lateral) in a frame; lateral + is to the left of travel. */
function at(fr: Frame, along: number, lat: number, out: { x: number; z: number }) {
  const c = Math.cos(fr.h), s = Math.sin(fr.h);
  out.x = fr.x + lat * c + along * s;
  out.z = fr.z - lat * s + along * c;
  return out;
}

function edgeLen(a: string, b: string) {
  return getEdge(a, b)?.length ?? 40;
}

function smooth01(x: number) {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function createBuses(pool: PassengerPool, seed = 2025, opts: BusOptions = {}) {
  const rand = mulberry32(seed);
  const pt = { x: 0, z: 0 };
  const m4 = new THREE.Matrix4();

  // --- stops (shared when two routes stop on the same directed road) -------------------------
  const stopsByKey = new Map<string, StopRt>();
  const routeStopKeys = new Map<BusRoute, Set<string>>();
  for (const r of BUS_ROUTES) {
    const keys = new Set<string>();
    for (const s of r.stops) {
      const k = `${s.from}>${s.to}`;
      keys.add(k);
      if (stopsByKey.has(k)) continue;
      const [x, z, h] = lanePosition(s.from, s.to, s.t);
      stopsByKey.set(k, { stop: s, fr: { x, z, h }, agents: new Int16Array(MAX_WAIT), n: 0 });
    }
    routeStopKeys.set(r, keys);
  }
  const stops = [...stopsByKey.values()];

  const faceRoad = (fr: Frame) => Math.atan2(-Math.cos(fr.h), Math.sin(fr.h));
  const slotPos = (k: number) => ({ along: -2.9 + (k % 5) * 1.1, lat: 2.9 + Math.floor(k / 5) * 0.85 });

  function addWaiting(st: StopRt, walkIn: boolean) {
    if (st.n >= MAX_WAIT) return;
    const slot = slotPos(st.n);
    at(st.fr, slot.along, slot.lat, pt);
    const sx = pt.x, sz = pt.z;
    let i: number;
    if (walkIn) {
      at(st.fr, (rand() < 0.5 ? -1 : 1) * (9 + rand() * 5), 2.8 + rand() * 1.4, pt);
      i = pool.spawn(pt.x, 0, pt.z);
      if (i < 0) return;
      pool.addWaypoint(i, sx, 0, sz);
    } else {
      i = pool.spawn(sx, 0, sz);
      if (i < 0) return;
    }
    pool.finish(i, END.IDLE, faceRoad(st.fr) + (rand() - 0.5) * 0.8);
    st.agents[st.n++] = i;
  }

  function takeWaiting(st: StopRt): number {
    while (st.n > 0) {
      const i = st.agents[0];
      st.agents.copyWithin(0, 1, st.n);
      st.n--;
      if (pool.state[i] === ST.IDLE || pool.state[i] === ST.WALK) return i;
    }
    return -1;
  }

  for (const st of stops) {
    const n = 1 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) addWaiting(st, false);
  }

  // --- bus meshes -----------------------------------------------------------------------------
  const busCount = BUS_ROUTES.reduce((a, r) => a + r.buses, 0);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.36, 10).rotateZ(Math.PI / 2);
  const blindGeo = new THREE.PlaneGeometry(2.0, 0.42);
  const red = std("#d3201b", { roughness: 0.55 });
  const dark = std("#26282b");
  const roofMat = std("#ece7de");
  const glass = std("#1b2430", { roughness: 0.3, emissive: new THREE.Color("#ffd27a"), emissiveIntensity: 0 });
  const tyre = std("#151515");
  const hazardMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffa21a").multiplyScalar(2), toneMapped: false });

  const busRig = new Rig(busCount);
  busRig.part(unitBox, red, [local(0, 2.1, 0, 0, 2.5, 3.3, 10.4)], true);
  busRig.part(unitBox, dark, [local(0, 0.62, 0, 0, 2.52, 0.34, 10.3)]);
  busRig.part(unitBox, roofMat, [local(0, 3.79, 0, 0, 2.4, 0.1, 10.2)]);
  busRig.part(unitBox, glass, [
    local(0, 1.85, 0.2, 0, 2.56, 0.9, 9.2), // lower deck side windows
    local(0, 3.28, 0, 0, 2.56, 0.78, 9.8), // upper deck side windows
    local(0, 1.9, 0, 0, 2.2, 1.0, 10.46), // windscreens front/back (lower)
    local(0, 3.28, 0, 0, 2.2, 0.78, 10.46), // upper deck front/back
  ]);
  busRig.part(wheelGeo, tyre, [local(1.12, 0.5, 3.3), local(-1.12, 0.5, 3.3), local(1.12, 0.5, -3.2), local(-1.12, 0.5, -3.2)]);
  const hazards = busRig.part(unitBox, hazardMat, [
    local(1.16, 1.0, 5.2, 0, 0.26, 0.2, 0.08), local(-1.16, 1.0, 5.2, 0, 0.26, 0.2, 0.08),
    local(1.16, 1.0, -5.2, 0, 0.26, 0.2, 0.08), local(-1.16, 1.0, -5.2, 0, 0.26, 0.2, 0.08),
  ]);
  const blindLocals = [local(0, 2.58, 5.215), local(0, 2.58, -5.215, Math.PI)];
  const blindTex: THREE.Texture[] = [];
  const blindMats: THREE.Material[] = [];
  const blindRigs = new Map<BusRoute, Rig>();
  for (const r of BUS_ROUTES) {
    const tex = busBlindTexture(r.number, r.destination);
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    blindTex.push(tex);
    blindMats.push(mat);
    const rig = new Rig(r.buses);
    rig.part(blindGeo, mat, blindLocals);
    blindRigs.set(r, rig);
  }

  // --- stop furniture (static) ----------------------------------------------------------------
  const stopRig = new Rig(stops.length);
  const metal = std("#2f3a3a", { roughness: 0.6 });
  const shelterGlass = std("#bfe3f2", { transparent: true, opacity: 0.45, roughness: 0.2 });
  const shelterRoof = std("#e6e6e0");
  const signTex = busStopTexture();
  const ttTex = timetableTexture();
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, alphaTest: 0.5, roughness: 0.7 });
  const ttMat = new THREE.MeshStandardMaterial({ map: ttTex, roughness: 0.7 });
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 6).translate(0, 0.5, 0);
  stopRig.part(unitBox, shelterRoof, [local(3.95, 2.5, -1, 0, 1.6, 0.1, 4.4)], true);
  stopRig.part(unitBox, shelterGlass, [local(4.7, 1.35, -1, 0, 0.06, 2.1, 4.2)]);
  stopRig.part(unitBox, metal, [
    local(4.7, 1.25, -3.1, 0, 0.09, 2.5, 0.09), local(4.7, 1.25, 1.1, 0, 0.09, 2.5, 0.09),
    local(3.3, 1.25, -3.1, 0, 0.09, 2.5, 0.09), local(3.3, 1.25, 1.1, 0, 0.09, 2.5, 0.09),
    local(4.4, 0.45, -1, 0, 0.45, 0.08, 2.6), // bench
  ]);
  stopRig.part(poleGeo, metal, [local(2.45, 0, 4.6, 0, 1, 3.3, 1), local(2.5, 0, -4.2, 0, 1, 1.9, 1)]);
  stopRig.part(planeGeo, signMat, [local(2.45, 3.0, 4.6, 0, 0.95, 0.95, 1), local(2.45, 3.0, 4.6, Math.PI, 0.95, 0.95, 1)]);
  stopRig.part(planeGeo, ttMat, [local(2.42, 1.45, -4.2, -Math.PI / 2, 0.55, 0.8, 1)]);
  stops.forEach((st, k) => stopRig.set(k, frame(st.fr.x, 0, st.fr.z, st.fr.h, m4)));
  stopRig.commit();

  // --- buses ----------------------------------------------------------------------------------
  const buses: Bus[] = [];
  let slot = 0;
  for (const r of BUS_ROUTES) {
    for (let k = 0; k < r.buses; k++) {
      const startIdx = Math.floor((k * r.loop.length) / r.buses);
      const nav = new LoopNavigator(r.loop, r.stops, startIdx);
      const to = nav.chooseNext(new Set());
      const obj = new THREE.Object3D();
      obj.name = `bus-${r.number}-${k}`;
      const id = `bus-${r.number}-${k + 1}`;
      const b: Bus = {
        id, route: r, slot: slot++, blindSlot: k, nav, prev: null, from: r.loop[startIdx], to, t: 0.15, v: 0,
        mode: MODE.DRIVE, dwellT: 0, alightLeft: 0, boardLeft: 0, releaseT: 0, lastEta: 0, servedKey: "",
        onboard: 6 + Math.floor(rand() * 18), crashed: false, crashT: 0, stuckT: 0, stopAt: null,
        pose: { x: 0, z: 0, h: 0 }, shown: { x: 0, z: 0, h: 0 }, obj,
        entry: null as unknown as VehicleEntry,
        look: new Lookahead({ halfLength: BUS_HALF_LEN, halfWidth: BUS_HALF_W, decel: BRAKE }, opts.obstacleFn, slot),
      };
      b.entry = {
        id, kind: "bus", object: obj, edgeKey: to ? edgeKey(b.from, to) : null, from: b.from, to, t: b.t, speed: 0, stopped: true,
        crash: () => {
          if (b.crashed) return false;
          b.crashed = true;
          b.crashT = 0;
          b.v = 0;
          return true;
        },
      };
      if (to) lanePose(null, b.from, to, nav.peekAfterTarget(), b.t, TURN_R, b.pose);
      b.shown.x = b.pose.x;
      b.shown.z = b.pose.z;
      b.shown.h = b.pose.h;
      buses.push(b);
    }
  }
  const root = new THREE.Group();
  root.name = "TransitBuses";
  for (const b of buses) root.add(b.obj);

  // --- per-bus behaviour ----------------------------------------------------------------------
  function beginDwell(b: Bus, st: StopRt, key: string) {
    b.mode = MODE.DWELL;
    b.dwellT = 0;
    b.v = 0;
    b.stopAt = st;
    b.servedKey = key;
    const visit = planVisit(st.n, b.onboard, CAPACITY, rand);
    b.alightLeft = visit.alight;
    b.boardLeft = visit.board;
    b.releaseT = 0.7;
    b.lastEta = 0;
  }

  function stepDwell(b: Bus, dt: number) {
    const st = b.stopAt!;
    b.dwellT += dt;
    b.releaseT -= dt;
    if (b.releaseT <= 0) {
      if (b.alightLeft > 0) {
        at(st.fr, MID_DOOR + (rand() - 0.5) * 0.6, DOOR_LAT, pt);
        const i = pool.spawn(pt.x, 0, pt.z);
        if (i >= 0) {
          at(st.fr, MID_DOOR, 2.75, pt);
          pool.addWaypoint(i, pt.x, 0, pt.z);
          const dir = rand() < 0.5 ? -1 : 1;
          at(st.fr, MID_DOOR + dir * (9 + rand() * 7), 2.7 + rand() * 1.6, pt);
          pool.addWaypoint(i, pt.x, 0, pt.z);
          pool.finish(i, END.VANISH, 0);
        }
        b.alightLeft--;
        b.onboard = Math.max(0, b.onboard - 1);
        b.releaseT = 0.45;
      } else if (b.boardLeft > 0) {
        const i = takeWaiting(st);
        if (i < 0) b.boardLeft = 0;
        else {
          const sx = pool.x[i], sz = pool.z[i];
          pool.clearPath(i);
          at(st.fr, FRONT_DOOR, 2.75, pt);
          const d = Math.hypot(pt.x - sx, pt.z - sz) + 0.6;
          pool.addWaypoint(i, pt.x, 0, pt.z);
          at(st.fr, FRONT_DOOR, DOOR_LAT - 0.1, pt);
          pool.addWaypoint(i, pt.x, 0, pt.z);
          pool.speed[i] = 1.9;
          pool.finish(i, END.BOARD, 0);
          b.lastEta = Math.max(b.lastEta, b.dwellT + d / 1.9 + 0.3);
          b.boardLeft--;
          b.onboard++;
          b.releaseT = 0.4;
        }
      }
    }
    const done = b.alightLeft === 0 && b.boardLeft === 0 && b.dwellT >= Math.max(MIN_DWELL, b.lastEta);
    if (done || b.dwellT > 14) {
      b.mode = MODE.DRIVE;
      b.stopAt = null;
    }
  }

  function incidentS(from: string, to: string, key: string): number {
    const inc = useWorld.getState().incidents;
    const a = getNode(from), bn = getNode(to);
    const dx = bn.x - a.x, dz = bn.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    for (let k = inc.length - 1; k >= 0; k--) {
      const i = inc[k];
      if (i.edgeKey !== key || i.status === "cleared") continue;
      return ((i.x - a.x) * dx + (i.z - a.z) * dz) / len;
    }
    return len / 2;
  }

  function arrive(b: Bus) {
    b.prev = b.from;
    b.nav.arrive(b.to!);
    b.from = b.to!;
    b.to = b.nav.chooseNext(blockedSet());
    b.servedKey = "";
  }

  function stepDrive(b: Bus, dt: number, now: number, blocked: Record<string, string>, sees: (x: number, z: number) => boolean) {
    if (!b.to) {
      b.v = 0;
      b.to = b.nav.chooseNext(blockedSet());
      if (!b.to) return;
      b.t = 0;
    }
    const len = edgeLen(b.from, b.to);
    let s = b.t * len;
    const key = edgeKey(b.from, b.to);
    const dkey = `${b.from}>${b.to}`;
    let D = Infinity;
    let blockedAhead = false;

    const st = routeStopKeys.get(b.route)!.has(dkey) ? stopsByKey.get(dkey)! : null;
    const stopS = st ? st.stop.t * len : -1;
    if (st && b.servedKey !== dkey && s <= stopS + 0.05) D = stopS - s;

    if (hasSignal(b.to)) {
      const dl = len - STOP_LINE - s;
      if (dl > 0) {
        const c = signalFor(b.to, b.from, now);
        if (c === "red" || (c === "amber" && dl > (b.v * b.v) / (2 * BRAKE) + 1)) D = Math.min(D, dl);
      }
    }

    const ahead = vehiclesAhead(b.from, b.to, b.t, b.id);
    if (ahead.length) D = Math.min(D, Math.max(0, (ahead[0].t - b.t) * len - GAP));

    // look-ahead raycast: brake for anything in front, and give way to a vehicle sitting in the junction
    const look = b.look;
    look.scan(b.id, b.pose.x, b.pose.z, b.pose.h, b.v, dt, sees(b.pose.x, b.pose.z));
    if (look.hitId) {
      let d = look.room;
      const toLine = len - STOP_LINE - s;
      if (toLine > 0) {
        const n = getNode(b.to);
        if (look.hitInJunction(n.x, n.z, JUNCTION_R)) d = Math.min(d, toLine);
      }
      D = Math.min(D, d);
    }

    if (blocked[key]) {
      const si = incidentS(b.from, b.to, key);
      if (si > s) {
        const d = Math.max(0, si - s - 9);
        if (d <= D) blockedAhead = true;
        D = Math.min(D, d);
      }
    }

    const limit = Math.min(VMAX, (getEdge(b.from, b.to)?.speedLimit ?? 11) * 0.85);
    const vT = Math.min(limit, Math.sqrt(2 * BRAKE * Math.max(0, D - 0.3)));
    if (b.v < vT) b.v = Math.min(vT, b.v + ACCEL * dt);
    else b.v = Math.max(vT, b.v - BRAKE * 2 * dt);
    if (D <= 0.05) b.v = 0;
    s += Math.min(b.v * dt, Math.max(0, D));

    // stuck behind a closed road: turn round and find another way
    if (blockedAhead && b.v < 0.1) {
      b.stuckT += dt;
      if (b.stuckT > 3) {
        b.stuckT = 0;
        const back = b.from;
        b.nav.uTurn(back);
        b.from = b.to;
        b.to = back;
        b.prev = null;
        b.t = 1 - s / len;
        b.servedKey = "";
        return;
      }
    } else b.stuckT = 0;

    if (st && b.servedKey !== dkey && Math.abs(stopS - s) < 0.3 && b.v < 0.6) {
      b.t = stopS / len;
      beginDwell(b, st, dkey);
      return;
    }

    if (s >= len) {
      const over = s - len;
      arrive(b);
      b.t = b.to ? Math.min(0.5, over / edgeLen(b.from, b.to)) : 0;
    } else b.t = s / len;
  }

  function pullFactor(b: Bus): number {
    if (b.mode === MODE.DWELL) return 1;
    if (!b.to) return 0;
    const dkey = `${b.from}>${b.to}`;
    if (!routeStopKeys.get(b.route)!.has(dkey)) return 0;
    const st = stopsByKey.get(dkey)!;
    const len = edgeLen(b.from, b.to);
    const ds = st.stop.t * len - b.t * len;
    if (b.servedKey === dkey) return ds < 0 ? smooth01(1 + ds / 14) : 0;
    return ds >= 0 ? smooth01(1 - ds / 16) : 0;
  }

  function stepStops(dt: number) {
    for (const st of stops) {
      const n = growWaiting(st.n, dt, ARRIVAL_RATE, MAX_WAIT, rand);
      if (n > st.n) addWaiting(st, true);
    }
  }

  // --- per-frame ------------------------------------------------------------------------------
  const busM = new THREE.Matrix4();
  function tick(dt: number, now: number, simulate: boolean, night: number, sees: (x: number, z: number) => boolean = () => true) {
    glass.emissiveIntensity = night * 0.9;
    const blink = Math.floor(now / 400) % 2 === 0;
    if (simulate) {
      stepStops(dt);
      const blocked = useWorld.getState().blocked;
      for (const b of buses) {
        if (b.crashed) {
          b.crashT += dt;
          b.v = 0;
          const k = b.to ? edgeKey(b.from, b.to) : "";
          if (b.crashT > 30 && !blocked[k]) b.crashed = false;
        } else if (b.mode === MODE.DWELL) stepDwell(b, dt);
        else stepDrive(b, dt, now, blocked, sees);

        if (b.to) {
          lanePose(b.prev, b.from, b.to, b.nav.peekAfterTarget(), b.t, TURN_R, b.pose);
          const f = pullFactor(b) * PULL_IN;
          if (f > 0) {
            const [, , eh] = lanePosition(b.from, b.to, 0);
            b.pose.x += f * Math.cos(eh);
            b.pose.z -= f * Math.sin(eh);
          }
        }
        // ease the displayed pose (hides the lane swap of a u-turn and tiny corner jumps)
        const k = 1 - Math.exp(-dt * 10);
        const jump = Math.hypot(b.pose.x - b.shown.x, b.pose.z - b.shown.z) > 20;
        b.shown.x = jump ? b.pose.x : b.shown.x + (b.pose.x - b.shown.x) * k;
        b.shown.z = jump ? b.pose.z : b.shown.z + (b.pose.z - b.shown.z) * k;
        b.shown.h += wrapAngle(b.pose.h - b.shown.h) * (jump ? 1 : 1 - Math.exp(-dt * 7));

        const e = b.entry;
        e.from = b.from;
        e.to = b.to;
        e.edgeKey = b.to ? edgeKey(b.from, b.to) : null;
        e.t = b.t;
        e.speed = b.v;
        e.stopped = b.v < 0.1;
        b.obj.position.set(b.shown.x, 0, b.shown.z);
        b.obj.rotation.y = b.shown.h;
      }
    }
    for (const b of buses) {
      frame(b.shown.x, 0, b.shown.z, b.shown.h, busM, b.crashed ? 0.06 : 0);
      busRig.set(b.slot, busM);
      if (!(b.crashed && blink)) busRig.hide(b.slot, hazards);
      blindRigs.get(b.route)!.set(b.blindSlot, busM);
    }
    busRig.commit();
    for (const r of blindRigs.values()) r.commit();
  }

  const meshes: THREE.Object3D[] = [root, ...busRig.meshes, ...stopRig.meshes, ...[...blindRigs.values()].flatMap((r) => r.meshes)];
  return {
    meshes,
    tick,
    /** Read-only view for tests and debugging. */
    state: () => buses.map((b) => ({ id: b.id, x: b.pose.x, z: b.pose.z, h: b.pose.h, v: b.v, mode: b.mode, from: b.from, to: b.to, t: b.t, crashed: b.crashed,
      stopAhead: !!b.to && routeStopKeys.get(b.route)!.has(`${b.from}>${b.to}`) && b.servedKey !== `${b.from}>${b.to}` })),
    /** Put the buses in the shared vehicle registry; returns the undo. Call from an effect. */
    register() {
      const offs = buses.map((b) => registerVehicle(b.entry));
      return () => offs.forEach((u) => u());
    },
    dispose() {
      for (const m of meshes) if (m instanceof THREE.InstancedMesh) m.dispose();
      [unitBox, wheelGeo, blindGeo, planeGeo, poleGeo].forEach((g) => g.dispose());
      [red, dark, roofMat, glass, tyre, hazardMat, metal, shelterGlass, shelterRoof, signMat, ttMat, ...blindMats].forEach((m) => m.dispose());
      [signTex, ttTex, ...blindTex].forEach((t) => t.dispose());
    },
  };
}

