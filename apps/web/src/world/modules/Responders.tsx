"use client";
// Module: Responders. Emergency services react to incidents: police, ambulance, fire engine and a
// recovery truck drive from their bases, secure the scene, clear it, reopen the road and go home.
// Pure planning/lifecycle logic lives in ./Responders/ (tested); this file is the per-frame driver.
// Cyclist hits: the ambulance goes first and fastest, a paramedic kneels by the rider, the rider is
// stretchered into the ambulance, which leaves with blues on; then the police clear and reopen the road.
// A tow only comes when the vehicle that hit them is wrecked (Collisions' hit record says so).
import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { emit } from "../bus";
import { getEdge, getNode, edgeKey as makeEdgeKey, lanePosition, ROAD_EDGES } from "../roads";
import { registerVehicle, type VehicleEntry } from "../registry";
import { blockedSet, useWorld, type Incident, type IncidentKind } from "../store";
import { cyclistHits } from "./Collisions/cyclist";
import { newMedic, stepMedic, type Medic } from "./Responders/medic";
import {
  BASE,
  CYCLIST_AMBULANCE_BOOST,
  GAP_M,
  gapFor,
  companionEdges,
  leaveDelays,
  planApproach,
  planDispatch,
  planReturn,
  REPEAT_GAP_M,
  shouldHandle,
  towsRequired,
  towWorkSeconds,
  type Route,
  type Side,
  type UnitRole,
} from "./Responders/dispatch";
import { newLife, stepLife, type Life } from "./Responders/lifecycle";
import { DEFAULT_BUFFER, Lookahead, ViewCheck } from "./DeliveryFleet/lookahead";
import {
  BLUES_BUFFER,
  UNIT_BRAKE,
  UNIT_SIZE,
  advance,
  approachSpeed,
  lookTarget,
  remainingMetres,
  type Cursor,
} from "./Responders/motion";
import { getShared, UnitMesh, type UnitParts } from "./Responders/meshes";

const RESPONSE_SPEED = 1.4; // x speed limit with blues on
const RETRY_S = 2;
const MAX_CONES = 48;
const CONES_PER_SCENE = 4;
const LIGHT_POOL = 3;
const STOP_LINE = 6; // where a unit without blues waits to give way to a vehicle in the junction

// Camera frustum check so off-screen units only raycast every 4th frame.
const view = new ViewCheck();

type Mode = "waiting" | "enroute" | "parked" | "returning" | "gone";

interface Unit {
  id: string;
  role: UnitRole;
  nth: number; // 0 for the first unit of this role at the scene, 1 for a second (pileups)
  incidentId: string;
  base: string;
  mode: Mode;
  returning: boolean; // waiting/returning towards base
  bluesHome: boolean; // returning with blues on (ambulance taking a patient to hospital)
  departed: boolean; // has left base at least once (visible)
  route: Route | null;
  cur: Cursor;
  side: Side | null;
  anchor: string; // node to plan from while waiting
  retryAt: number;
  departAt: number; // returning units start moving at this sim time
  speed: number;
  look: Lookahead;
  park: number; // 0..1 police "fend-off" diagonal blend
  placed: boolean;
  x: number;
  z: number;
  heading: number;
  flash: number; // per-unit flash phase offset
  // scene dressing (police)
  officer: number; // 0..1 walked out
  coneLevel: number; // 0..CONES_PER_SCENE cones deployed
  cones: Float32Array; // [x, z] * CONES_PER_SCENE
  door: [number, number];
  post: [number, number];
}

interface Scene {
  id: string;
  kind: IncidentKind;
  edgeKey: string;
  note: string;
  x: number;
  z: number;
  life: Life;
  units: Unit[];
  medic: Medic | null; // cyclist hit: the paramedic looking after the rider
  workDone: boolean; // cyclist hit: the ambulance has left with the rider
}

const edgeLen = (a: string, b: string) => getEdge(a, b)?.length ?? 1;

function shortestAngle(from: number, to: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

let unitSeq = 0;

export default function Responders() {
  const [units, setUnits] = useState<Unit[]>([]);
  const scenes = useRef(new Map<string, Scene>());
  const handled = useRef(new Set<string>());
  const parts = useRef(new Map<string, UnitParts>());
  const entries = useRef(new Map<string, { entry: VehicleEntry; off: () => void }>());
  const sim = useRef(0);
  const conesRef = useRef<THREE.InstancedMesh>(null);
  const lightsRef = useRef<(THREE.PointLight | null)[]>([]);
  const tmp = useRef(new THREE.Object3D());
  const warned = useRef(false);

  const refreshList = useCallback(() => {
    const list: Unit[] = [];
    for (const s of scenes.current.values()) for (const u of s.units) if (u.mode !== "gone") list.push(u);
    setUnits(list);
  }, []);

  // --- dispatch: handle each crash/breakdown incident exactly once --------------------------------
  const dispatch = useCallback(
    (inc: Incident) => {
      if (handled.current.has(inc.id) || !shouldHandle(inc.kind) || inc.status === "cleared") return;
      if (!ROAD_EDGES.has(inc.edgeKey)) return;
      handled.current.add(inc.id);
      const now = sim.current;
      const opts = { vehicleCrashed: !!cyclistHits.get(inc.id)?.damaged };
      const scene: Scene = {
        id: inc.id,
        kind: inc.kind,
        edgeKey: inc.edgeKey,
        note: inc.note,
        x: inc.x,
        z: inc.z,
        life: newLife(now, { towsRequired: towsRequired(inc.kind, opts), towWorkS: towWorkSeconds(inc.kind) }),
        units: [],
        medic: inc.kind === "cyclist_hit" ? newMedic() : null,
        workDone: inc.kind !== "cyclist_hit",
      };
      const roles = planDispatch(inc.kind, opts);
      const delays = leaveDelays(roles, inc.kind);
      roles.forEach((role, idx) => {
        unitSeq += 1;
        scene.units.push({
          id: `${role.toUpperCase()}-${unitSeq}`,
          role,
          nth: roles.slice(0, idx).filter((r) => r === role).length,
          incidentId: inc.id,
          base: BASE[role],
          mode: "waiting",
          returning: false,
          bluesHome: false,
          departed: false,
          route: null,
          cur: { seg: 0, t: 0 },
          side: null,
          anchor: BASE[role],
          retryAt: now + delays[idx],
          departAt: 0,
          speed: 0,
          look: new Lookahead({ ...UNIT_SIZE[role], decel: UNIT_BRAKE, buffer: BLUES_BUFFER }, undefined, unitSeq),
          park: 0,
          placed: false,
          x: 0,
          z: 0,
          heading: 0,
          flash: Math.random() * Math.PI * 2,
          officer: 0,
          coneLevel: 0,
          cones: new Float32Array(CONES_PER_SCENE * 2),
          door: [0, 0],
          post: [0, 0],
        });
      });
      scenes.current.set(inc.id, scene);
      refreshList();
    },
    [refreshList],
  );

  useEffect(() => {
    const scan = (list: Incident[]) => {
      for (const i of list) {
        try {
          dispatch(i);
        } catch (err) {
          console.warn("[Responders] dispatch failed", err);
        }
      }
    };
    scan(useWorld.getState().incidents);
    const unsub = useWorld.subscribe((s, p) => {
      if (s.incidents !== p.incidents) scan(s.incidents);
    });
    return unsub;
  }, [dispatch]);

  // --- registry: register each unit once its meshes exist -----------------------------------------
  const onBind = useCallback((id: string, p: UnitParts | null) => {
    const prev = entries.current.get(id);
    if (prev) {
      prev.off();
      entries.current.delete(id);
    }
    if (!p) {
      parts.current.delete(id);
      return;
    }
    parts.current.set(id, p);
    const role = id.split("-")[0].toLowerCase() as UnitRole;
    const entry: VehicleEntry = {
      id,
      kind: role,
      object: p.car,
      edgeKey: null,
      from: null,
      to: null,
      t: 0,
      speed: 0,
      stopped: true,
      crash: () => false, // emergency vehicles don't crash
    };
    entries.current.set(id, { entry, off: registerVehicle(entry) });
  }, []);

  useEffect(() => {
    const ents = entries.current;
    return () => {
      for (const e of ents.values()) e.off();
      ents.clear();
    };
  }, []);

  // --- per-frame simulation ---------------------------------------------------------------------
  useFrame(({ camera }, rawDelta) => {
    view.update(camera);
    try {
      step(Math.min(rawDelta, 0.1));
    } catch (err) {
      if (!warned.current) {
        warned.current = true;
        console.warn("[Responders] frame step failed", err);
      }
    }
  });

  function startReturn(u: Unit, now: number, delay: number) {
    if (u.returning || u.mode === "gone") return;
    u.returning = true;
    u.departAt = now + delay;
    if (!u.departed || !u.route) {
      u.mode = "gone";
      return;
    }
    planHome(u, now);
  }

  /** (Re)plan the trip home from the unit's current leg. On failure wait and retry. */
  function planHome(u: Unit, now: number) {
    const r = u.route;
    if (!r || r.nodes.length < 2) {
      u.mode = "gone";
      return;
    }
    const seg = Math.min(u.cur.seg, r.nodes.length - 2);
    const from = r.nodes[seg];
    const to = r.nodes[seg + 1];
    const home = planReturn(from, to, u.base, blockedSet());
    if (home) {
      u.route = home;
      u.cur = { seg: 0, t: u.cur.t };
      u.mode = "returning";
    } else {
      u.mode = "waiting";
      u.retryAt = now + RETRY_S;
    }
  }

  function planOut(u: Unit, scene: Scene, now: number) {
    // Spread units over both ends of the road: the tow avoids the (first) police car's end, and a
    // second unit of a role (pileups) avoids the first one's end.
    const police = scene.units.find((o) => o.role === "police" && o.nth === 0);
    const firstSame = u.nth > 0 ? scene.units.find((o) => o.role === u.role && o.nth === 0) : undefined;
    const avoid = firstSame?.side ?? (u.role === "tow" && police?.side ? police.side : undefined) ?? undefined;
    const extraGap = gapFor(u.role, scene.kind) - GAP_M[u.role] + u.nth * REPEAT_GAP_M;
    const ap = planApproach(u.anchor, scene, u.role, blockedSet(), avoid, extraGap);
    if (ap) {
      u.route = ap.route;
      u.side = ap.side;
      u.cur = { seg: 0, t: 0 };
      u.mode = "enroute";
      u.departed = true;
    } else {
      u.mode = "waiting";
      u.retryAt = now + RETRY_S;
    }
  }

  /** Ambulance with the rider aboard: turn round (don't drive through the scene) and go with blues on. */
  function departWithBlues(u: Unit, now: number) {
    const r = u.route;
    if (u.returning || !r || r.nodes.length < 2) return;
    u.returning = true;
    u.bluesHome = true;
    u.departAt = now;
    const n = r.nodes.length;
    const home = planReturn(r.nodes[n - 1], r.nodes[n - 2], u.base, blockedSet());
    if (home) {
      u.route = home;
      u.cur = { seg: 0, t: Math.max(0, Math.min(1, 1 - u.cur.t)) };
      u.mode = "returning";
    } else planHome(u, now);
  }

  /** Cyclist hit: paramedic choreography; when the rider is aboard, the ambulance leaves. */
  function stepCyclistScene(scene: Scene, dt: number, now: number) {
    const m = scene.medic;
    if (!m) return;
    const amb = scene.units.find((x) => x.role === "ambulance" && x.nth === 0);
    const hit = cyclistHits.get(scene.id);
    if (!amb || scene.life.phase === "cleared" || scene.life.phase === "done") {
      m.visible = false;
      if (hit) hit.carry = null;
      return;
    }
    const parked = amb.mode === "parked" && !amb.returning;
    if (!parked && m.phase === "waiting") return;
    const rider = hit ? (hit.rider.rest ? hit.rider : hit) : scene;
    const res = stepMedic(m, dt, parked, { x: amb.x, z: amb.z, h: amb.heading }, UNIT_SIZE.ambulance.halfLength, rider);
    if (hit) {
      if (res.carry) {
        const c = (hit.carry ??= { x: 0, y: 0, z: 0, h: 0 });
        c.x = res.carry.x;
        c.y = res.carry.y;
        c.z = res.carry.z;
        c.h = res.carry.h;
      } else hit.carry = null;
      hit.loaded = res.loaded;
    }
    if (res.done && !scene.workDone) {
      departWithBlues(amb, now);
      scene.workDone = true;
    }
  }

  function onArrive(u: Unit) {
    u.mode = "parked";
    u.speed = 0;
    if (u.role !== "police" || !u.route) return;
    // Lay out a cone taper behind the car, from the kerb back upstream to the centre line near the car.
    const n = u.route.nodes;
    const a = getNode(n[n.length - 2]);
    const b = getNode(n[n.length - 1]);
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const fx = (b.x - a.x) / len;
    const fz = (b.z - a.z) / len;
    const rx = -fz; // right-hand vector (towards the centre line when driving on the left)
    const rz = fx;
    const cx = a.x + fx * len * u.cur.t;
    const cz = a.z + fz * len * u.cur.t;
    for (let i = 0; i < CONES_PER_SCENE; i++) {
      const back = 3.8 + i * 2.6;
      const lat = 0.4 + i * 1.1; // to the left of the centre line
      u.cones[i * 2] = cx - fx * back - rx * lat;
      u.cones[i * 2 + 1] = cz - fz * back - rz * lat;
    }
    u.door = [cx - rx * 2.9, cz - rz * 2.9];
    u.post = [cx - fx * 3 - rx * 4.8, cz - fz * 3 - rz * 4.8];
  }

  function step(dt: number) {
    const world = useWorld.getState();
    const paused = world.paused;
    if (!paused) sim.current += dt;
    const now = sim.current;
    const blocked = world.blocked;
    let listChanged = false;

    if (!paused) {
      for (const scene of scenes.current.values()) {
        // lifecycle
        const stored = world.incidents.find((i) => i.id === scene.id);
        const anyArrived = scene.units.some((u) => u.mode === "parked");
        let towsArrived = 0;
        for (const u of scene.units) if (u.role === "tow" && u.mode === "parked") towsArrived++;
        const externallyCleared = !stored || (stored.status === "cleared" && scene.life.phase !== "cleared" && scene.life.phase !== "done");
        if (scene.medic) stepCyclistScene(scene, dt, now);
        const workDone = scene.workDone;
        for (const act of stepLife(scene.life, { anyArrived, towsArrived, externallyCleared, workDone }, now)) {
          try {
            if (act === "set_responding") world.updateIncident(scene.id, { status: "responding" });
            else if (act === "set_clearing") world.updateIncident(scene.id, { status: "clearing" });
            else if (act === "release_tow") {
              for (const u of scene.units) if (u.role === "tow") startReturn(u, now, 0);
              listChanged = true;
            } else if (act === "set_cleared") {
              // a pileup may also close an adjacent road (same reason); reopen it too
              const closed = [scene.edgeKey, ...companionEdges(scene.edgeKey, scene.note, useWorld.getState().blocked)];
              world.updateIncident(scene.id, { status: "cleared" });
              for (const k of closed) world.unblockEdge(k);
              emit({ type: "incident:cleared", incidentId: scene.id });
              for (const k of closed) emit({ type: "road:reopened", edgeKey: k });
            } else if (act === "release_units") {
              for (const u of scene.units) startReturn(u, now, u.role === "police" ? 1.6 : u.role === "ambulance" ? 0.4 : 0.9);
              listChanged = true;
            }
          } catch (err) {
            console.warn("[Responders] lifecycle action failed", act, err);
          }
        }

        // units
        for (const u of scene.units) {
          if (u.mode === "gone") continue;
          if (u.mode === "waiting") {
            if (now < u.retryAt) continue;
            if (u.returning) planHome(u, now);
            else planOut(u, scene, now);
            if ((u.mode as Mode) === "gone") listChanged = true;
            continue;
          }
          if (u.mode === "parked" || !u.route) continue;
          if (u.mode === "returning" && now < u.departAt) continue;

          const r = u.route;
          const seg = Math.min(u.cur.seg, r.nodes.length - 2);
          const e = seg >= 0 ? getEdge(r.nodes[seg], r.nodes[seg + 1]) : undefined;
          const limit = e?.speedLimit ?? 11;
          let target = u.returning && !u.bluesHome ? limit : limit * RESPONSE_SPEED;
          if (scene.kind === "cyclist_hit" && u.role === "ambulance") target *= CYCLIST_AMBULANCE_BOOST;
          target = Math.min(target, 2 + remainingMetres(r, u.cur, edgeLen) * 1.1);
          // look-ahead raycast: brake for anything in front. With blues on the buffer is shorter and we don't
          // wait at junctions (everyone else yields to us); hits on our own scene (the wreck, colleagues) don't count.
          if (seg >= 0 && e) {
            const a = r.nodes[seg];
            const b = r.nodes[seg + 1];
            const [lx, lz, lh] = lanePosition(a, b, u.cur.t);
            u.look.buffer = u.returning && !u.bluesHome ? DEFAULT_BUFFER : BLUES_BUFFER;
            u.look.scan(u.id, lx, lz, lh, u.speed, dt, view.sees(lx, lz));
            if (u.look.hitId) {
              const nb = u.returning && !u.bluesHome && seg + 1 < r.nodes.length - 1 ? getNode(b) : null;
              target = lookTarget(target, u.look, {
                scene,
                junction: nb ? { x: nb.x, z: nb.z, toLine: (1 - u.cur.t) * e.length - STOP_LINE - UNIT_SIZE[u.role].halfLength } : null,
              });
            }
          }
          u.speed = approachSpeed(u.speed, target, dt);
          const res = advance(r, u.cur, u.speed * dt, edgeLen, (a, b) => {
            const k = makeEdgeKey(a, b);
            if (!u.returning && k === scene.edgeKey) return true;
            return !(k in blocked);
          });
          if (res.arrived) {
            if (u.returning) {
              u.mode = "gone";
              listChanged = true;
            } else onArrive(u);
          } else if (res.blockedAt !== null) {
            u.speed = 0;
            const node = r.nodes[res.blockedAt];
            if (u.returning) planHome(u, now);
            else {
              u.anchor = node;
              planOut(u, scene, now);
            }
          }
        }
        if (scene.life.phase === "done" && scene.units.every((u) => u.mode === "gone")) {
          scenes.current.delete(scene.id);
          listChanged = true;
        }
      }
    }

    render(dt, now);
    if (listChanged) refreshList();
  }

  function render(dt: number, now: number) {
    const kPos = 1 - Math.exp(-10 * dt);
    const kRot = 1 - Math.exp(-8 * dt);
    let cone = 0;
    let light = 0;
    const cones = conesRef.current;
    const o = tmp.current;

    for (const scene of scenes.current.values()) {
      for (const u of scene.units) {
        const p = parts.current.get(u.id);
        const reg = entries.current.get(u.id)?.entry;
        const visible = u.departed && u.mode !== "gone";

        // target pose
        let tx = u.x;
        let tz = u.z;
        let th = u.heading;
        let from: string | null = null;
        let to: string | null = null;
        if (u.route && u.route.nodes.length >= 2) {
          const seg = Math.min(u.cur.seg, u.route.nodes.length - 2);
          from = u.route.nodes[seg];
          to = u.route.nodes[seg + 1];
          [tx, tz, th] = lanePosition(from, to, u.cur.t);
        } else {
          const n = getNode(u.anchor);
          tx = n.x;
          tz = n.z;
        }
        // police fend-off: angle across the lane towards the centre line
        if (u.role === "police") {
          const want = u.mode === "parked" && !u.returning ? 1 : 0;
          u.park += Math.max(-dt, Math.min(dt, want - u.park));
          if (u.park > 0) {
            const e = u.park * u.park * (3 - 2 * u.park);
            tx += -Math.cos(th) * 1.4 * e;
            tz += Math.sin(th) * 1.4 * e;
            th -= 0.6 * e;
          }
        }
        if (!u.placed && visible) {
          u.x = tx;
          u.z = tz;
          u.heading = th;
          u.placed = true;
        } else {
          u.x += (tx - u.x) * kPos;
          u.z += (tz - u.z) * kPos;
          u.heading += shortestAngle(u.heading, th) * kRot;
        }

        // registry (queueing traffic reads from/to/t)
        if (reg) {
          const moving = u.mode === "enroute" || u.mode === "returning" || u.mode === "parked";
          reg.from = visible && moving ? from : null;
          reg.to = visible && moving ? to : null;
          reg.edgeKey = reg.from && reg.to ? makeEdgeKey(reg.from, reg.to) : null;
          reg.t = u.cur.t;
          reg.speed = u.mode === "parked" ? 0 : u.speed;
          reg.stopped = u.mode !== "enroute" && u.mode !== "returning";
        }

        const lit = u.returning ? u.bluesHome && u.mode === "returning" : u.mode === "enroute" || u.mode === "parked" || u.mode === "waiting";
        const blues = visible && lit;
        if (p) {
          p.car.visible = visible;
          p.car.position.set(u.x, 0, u.z);
          p.car.rotation.y = u.heading;
          // light bars: alternate left/right with a quick double strobe
          const f = now * (u.role === "tow" ? 3 : 4.5) + u.flash;
          const sideL = Math.sin(f * Math.PI) > 0;
          const strobe = Math.sin(f * Math.PI * 6) > -0.2 ? 1 : 0.35;
          p.lightL.emissiveIntensity = blues ? (sideL ? 5 * strobe : 0.25) : 0.15;
          p.lightR.emissiveIntensity = blues ? (sideL ? 0.25 : 5 * strobe) : 0.15;
          // siren ring decal
          if (blues) {
            const ph = (now * 1.2 + u.flash) % 1;
            p.ring.visible = true;
            p.ring.scale.setScalar(1 + ph * 2.6);
            p.ringMat.opacity = (1 - ph) * 0.55;
          } else p.ring.visible = false;
          // one cheap point light per emergency vehicle (pooled, fixed count: no shader recompiles)
          if (blues && u.role !== "tow" && light < LIGHT_POOL) {
            const L = lightsRef.current[light++];
            if (L) {
              L.position.set(u.x, 3, u.z);
              L.intensity = 40 + 40 * Math.max(0, Math.sin(f * Math.PI * 2));
            }
          }
        }

        // paramedic (cyclist hit): walks to the rider, kneels, walks the stretcher back
        if (u.role === "ambulance" && p?.officer) {
          const m = scene.medic;
          const show = !!m && m.visible && visible;
          p.officer.visible = show;
          if (show && m) {
            const walking = m.phase === "walk" || m.phase === "carry";
            p.officer.position.set(m.x, walking ? Math.abs(Math.sin(now * 9)) * 0.06 : 0, m.z);
            p.officer.rotation.set(0.45 * m.kneel, m.h, 0, "YXZ");
            p.officer.scale.set(1, 1 - 0.35 * m.kneel, 1);
          }
        }

        // police officer and cones
        if (u.role === "police") {
          const deployed = u.mode === "parked" && !u.returning;
          const packing = u.returning && now < u.departAt;
          const wantOfficer = deployed ? 1 : 0;
          u.officer += Math.max(-dt / 1.2, Math.min(dt / 1.6, wantOfficer - u.officer));
          if (deployed && u.officer > 0.6) u.coneLevel = Math.min(CONES_PER_SCENE, u.coneLevel + dt * 1.8);
          else if (!deployed) u.coneLevel = Math.max(0, u.coneLevel - dt * (packing ? 3 : 8));
          if (p?.officer) {
            const ow = u.officer > 0.01 && visible;
            p.officer.visible = ow;
            if (ow) {
              const w = u.officer;
              p.officer.position.set(u.door[0] + (u.post[0] - u.door[0]) * w, Math.abs(Math.sin(now * 9)) * 0.08 * (w < 0.99 ? 1 : 0), u.door[1] + (u.post[1] - u.door[1]) * w);
              p.officer.rotation.y = u.heading + Math.PI * 0.5;
            }
          }
          if (cones) {
            for (let i = 0; i < CONES_PER_SCENE && cone < MAX_CONES; i++) {
              const sc = Math.min(1, Math.max(0, u.coneLevel - i));
              if (sc <= 0) continue;
              const pop = sc < 1 ? sc * (1.25 - 0.25 * sc) : 1;
              o.position.set(u.cones[i * 2], 0.03, u.cones[i * 2 + 1]);
              o.rotation.set(0, 0, 0);
              o.scale.setScalar(pop);
              o.updateMatrix();
              cones.setMatrixAt(cone++, o.matrix);
            }
          }
        }
      }
    }
    if (cones) {
      cones.count = cone;
      cones.instanceMatrix.needsUpdate = true;
    }
    for (let i = light; i < LIGHT_POOL; i++) {
      const L = lightsRef.current[i];
      if (L) L.intensity = 0;
    }
  }

  const shared = getShared();
  return (
    <group name="responders">
      {units.map((u) => (
        <UnitMesh key={u.id} id={u.id} role={u.role} onBind={onBind} />
      ))}
      <instancedMesh
        ref={conesRef}
        args={[shared.cone, shared.mats.cone as THREE.Material, MAX_CONES]}
        frustumCulled={false}
        castShadow={false}
      />
      {Array.from({ length: LIGHT_POOL }, (_, i) => (
        <pointLight
          key={i}
          ref={(l) => {
            lightsRef.current[i] = l;
          }}
          color="#3d6bff"
          intensity={0}
          distance={26}
          decay={2}
        />
      ))}
    </group>
  );
}
