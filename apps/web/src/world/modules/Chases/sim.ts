// Chases simulation: police pursuits (getaway, 2-3 police cars, helicopter, the odd roadblock), night
// street races and speed cameras. Imperative three.js objects built once and pooled; per-frame state
// lives here, the store is only touched for closed roads (crash incident, roadblock).
// Physics: every chase vehicle looks ahead with physics.obstacleAhead() (falling back to the lane
// queue in the registry), brakes or swerves, and never drives through what it sees. When the getaway
// can't avoid something it hits it: momentum is exchanged (dynamics.collide), the other vehicle is
// crashed via its crash() hook, and the getaway slides and spins as a rigid body until friction stops it.
import * as THREE from "three";
import { emit, on } from "../../bus";
import { obstacleAhead } from "../../physics";
import { allVehicles, getVehicle, nextId, type VehicleEntry } from "../../registry";
import { PLACES, ROAD_NODES, edgeKey, findPath, getEdge, getNode, neighbours } from "../../roads";
import { signalFor } from "../../signals";
import { blockedSet, useWorld } from "../../store";
import { blockageT, poseAt, replanPath, type Pose } from "../Traffic/driving";
import {
  MASS,
  canStop,
  collide,
  interceptHorizon,
  pitChance,
  pitContact,
  pitImpulse,
  predictNode,
  roadblockSite,
  stepBody,
  type Body,
  type PitContact,
} from "./dynamics";
import {
  boxSlots,
  cameraSites,
  chooseTurn,
  escapeNode,
  isMotorwayEdge,
  isNight,
  isReckless,
  newChase,
  nextChaseDelay,
  pitAllowed,
  pursuitTarget,
  raceStrip,
  racerLaunch,
  rollEnding,
  speedingHit,
  stepChase,
  straightAhead,
  turnKind,
  type CameraSite,
  type ChaseAction,
  type ChaseState,
  type Slot,
} from "./logic";
import {
  buildCameras,
  buildFigure,
  buildGetaway,
  buildHeli,
  buildLamppost,
  buildPolice,
  buildRacer,
  buildSparks,
  disposeKit,
  type CarParts,
  type Figure,
  type HeliParts,
  type PoliceParts,
  type Sparks,
} from "./meshes";
import { KERB_LAT, Mover, OVERTAKE_LAT } from "./mover";

const rand = Math.random;
const between = (a: number, b: number) => a + rand() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (u: number) => {
  const c = clamp(u, 0, 1);
  return c * c * (3 - 2 * c);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const GETAWAY_FACTOR = 1.7;
const POLICE_FACTOR = 1.95;
const POLICE_GIVEUP_FACTOR = 1.45;
const HELI_Y = 46;
const FIRST_CHASE_S: [number, number] = [25, 40];
const RACE_EVERY_S: [number, number] = [40, 75];
const WRECK_SAFETY_S = 150;
const SITE_COOL_S = 1.1;
const BRAKE = 11; // hard braking, m/s²
const IMPACT_MIN = 3; // closing speed (m/s) below which contact is just a nudge, not a crash
const UNAVOIDABLE = 12; // a careful getaway only crashes when it meets something at this closing speed
const PIT_SIDE = 2.3; // lateral offset police take up for a PIT
const PIT_ALONG = -2.6; // police centre this far behind the getaway centre
const ROADBLOCK_CHANCE = 0.35;
const ROADBLOCK_S = 26;
const PATROL = 3; // pursuit units; two more in the pool are for roadblocks

type PoliceMode = "idle" | "waiting" | "pursue" | "hold" | "box" | "parked" | "block" | "leave";

interface Police {
  parts: PoliceParts;
  mv: Mover;
  role: number;
  mode: PoliceMode;
  spawnAt: number; // chase time to leave
  start: string;
  slot: Slot | null;
  boxFrom: Pose;
  boxU: number;
  boxDur: number;
  flash: number;
  checkIn: number;
  manT: number; // overtake timer
  pitCool: number; // seconds until the next PIT attempt
}

interface Car {
  parts: CarParts;
  mv: Mover;
}

interface Racer extends Car {
  accel: number;
  top: number;
  manT: number;
  smokeT: number;
}

type RacePhase = "idle" | "staging" | "racing";

interface CamState {
  site: CameraSite;
  cool: number;
  lastId: string;
  flashT: number; // seconds since the flash started (Infinity = idle)
}

/** What a look-ahead probe found: bumper-to-bumper gap and the obstacle's speed. */
interface Probe {
  gap: number;
  speed: number;
  id: string;
  kind: VehicleEntry["kind"];
}

interface Impact {
  x: number;
  z: number;
  ids: string[];
  note: string;
}

export class ChaseSim {
  readonly root = new THREE.Group();
  private police: Police[] = [];
  private getaways: Record<"saloon" | "van", Car>;
  private g: Car | null = null;
  private heli: HeliParts;
  private heliActive = false;
  private heliPos = new THREE.Vector3();
  private heliVel = new THREE.Vector3();
  private heliOrbit = 0;
  private heliLeaveT = 0;
  private officers: Figure[];
  private suspect: Figure;
  private lamppost: THREE.Group;
  private lampFall = -1; // seconds since knocked (-1 = standing/hidden)
  private racers: Racer[];
  private race: RacePhase = "idle";
  private raceSawRed = false;
  private raceWait = 0;
  private raceTimer = between(...RACE_EVERY_S);
  private raceEnd = 0; // path index where the strip ends
  private cams: CamState[];
  private camFlash: THREE.InstancedMesh;
  private sparks: Sparks;
  private lights: THREE.PointLight[] = [];
  private materials: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];

  private chase: ChaseState | null = null;
  private chaseTimer = between(...FIRST_CHASE_S);
  private escapeDest: string | null = null;
  private escapeRouted = false;
  private gaveUpAt = 0;
  private manT = 0; // getaway manoeuvre timer
  private prevH = 0;
  // getaway rigid body (spins and crashes)
  private body: Body | null = null;
  private rested = false;
  private restedAt = 0;
  private boxed = false;
  // per-frame events for the state machine
  private pitHit = false;
  private collided = false;
  private impact: Impact | null = null;
  // roadblock
  private roadblock: { key: string; until: number } | null = null;
  private roadblockTried = false;
  private arrestT = -1;
  private arrestCops: Police[] = [];
  private wreck: { incidentId: string; at: number; smokeT: number } | null = null;
  private suspectFrom = { x: 0, z: 0 };
  private officerFrom: [number, number][] = [
    [0, 0],
    [0, 0],
  ];

  private blocked = new Set<string>();
  private blockedDirty = true;
  private cleanup: (() => void)[] = [];
  private night = false;
  private sim = 0;
  private tmpV = new THREE.Vector3();
  private tmpU = new THREE.Vector3();
  private o = new THREE.Object3D();
  private up = new THREE.Vector3(0, 1, 0);
  private scratchPose: Pose = { x: 0, z: 0, h: 0 };

  constructor() {
    this.root.name = "chases";
    for (let i = 0; i < PATROL + 2; i++) {
      const parts = buildPolice();
      this.root.add(parts.root);
      this.materials.push(...parts.own);
      this.police.push({
        parts, mv: new Mover(parts.root, "police", 2.2), role: i, mode: "idle", spawnAt: 0, start: "",
        slot: null, boxFrom: { x: 0, z: 0, h: 0 }, boxU: 0, boxDur: 2, flash: rand() * 10, checkIn: 0, manT: 0, pitCool: 0,
      });
    }
    const saloon = buildGetaway("saloon");
    const van = buildGetaway("van");
    this.getaways = { saloon: { parts: saloon, mv: new Mover(saloon.root, "car", 2.35) }, van: { parts: van, mv: new Mover(van.root, "van", 2.6) } };
    this.root.add(saloon.root, van.root);
    this.materials.push(...saloon.own, ...van.own);

    this.heli = buildHeli();
    this.root.add(this.heli.root, this.heli.cone, this.heli.spot);
    this.materials.push(...this.heli.own);
    this.geos.push(...this.heli.geos);

    this.officers = [buildFigure("officer"), buildFigure("officer")];
    this.suspect = buildFigure("suspect");
    for (const f of [...this.officers, this.suspect]) this.root.add(f.root);
    this.lamppost = buildLamppost();
    this.root.add(this.lamppost);

    const neon: [string, string][] = [
      ["#1d6bff", "#19e6ff"],
      ["#e8e8ea", "#ff2bd6"],
      ["#ffd21a", "#4dff6a"],
      ["#c8141c", "#9d4dff"],
    ];
    this.racers = [0, 1].map((i) => {
      const [paint, glow] = neon[(i * 2 + Math.floor(rand() * 2)) % neon.length];
      const parts = buildRacer(paint, glow);
      this.root.add(parts.root);
      this.materials.push(...parts.own);
      return { parts, mv: new Mover(parts.root, "car", 2.2), accel: 7, top: 32, manT: 0, smokeT: 0 };
    });

    const sites = cameraSites();
    this.cams = sites.map((site) => ({ site, cool: 0, lastId: "", flashT: Infinity }));
    const cams = buildCameras(sites);
    this.camFlash = cams.flash;
    this.materials.push(...cams.own);
    for (const m of cams.meshes) this.root.add(m);

    this.sparks = buildSparks();
    this.root.add(this.sparks.mesh);

    for (let i = 0; i < 2; i++) {
      const L = new THREE.PointLight("#3d6bff", 0, 26, 2);
      this.lights.push(L);
      this.root.add(L);
    }
  }

  start() {
    this.blocked = blockedSet();
    this.cleanup.push(
      useWorld.subscribe((s, p) => {
        if (s.blocked !== p.blocked) this.blockedDirty = true;
      }),
      on((e) => {
        if (e.type === "incident:cleared" && this.wreck?.incidentId === e.incidentId) this.removeWreck();
      }),
    );
  }

  stop() {
    for (const c of this.cleanup) c();
    this.cleanup = [];
    if (this.wreck) this.clearWreckIncident();
    this.liftRoadblock();
    for (const p of this.police) p.mv.despawn();
    for (const c of Object.values(this.getaways)) c.mv.despawn();
    for (const r of this.racers) r.mv.despawn();
  }

  dispose() {
    for (const m of this.materials) m.dispose();
    for (const g of this.geos) g.dispose();
    disposeKit();
  }

  /** Dev/demo hooks: start a chase / race now. */
  triggerChase() {
    if (!this.chase && !this.wreck) this.startChase();
  }
  triggerRace() {
    if (this.race === "idle") this.stageRace();
  }

  // --- per frame ----------------------------------------------------------------------------

  step(rawDt: number) {
    const dt = Math.min(rawDt, 0.1);
    const world = useWorld.getState();
    if (world.paused || dt <= 0) return;
    this.sim += dt;
    const now = performance.now();
    this.night = isNight(world.timeOfDay);
    if (this.blockedDirty) {
      this.blocked = blockedSet();
      this.blockedDirty = false;
    }

    if (!this.chase) {
      this.chaseTimer -= dt;
      if (this.chaseTimer <= 0 && !this.wreck) this.startChase();
    } else this.stepChase(dt);

    this.stepWreck(dt);
    this.stepRace(dt, now);
    this.stepCameras(dt);
    this.sparks.step(dt);
    this.renderPolice();
  }

  // --- look-ahead ---------------------------------------------------------------------------

  /**
   * Nearest obstacle ahead of `mv` in the lane at lateral offset `lat` (0 = own lane, OVERTAKE_LAT = oncoming,
   * KERB_LAT = pavement), within `range` metres. Uses the physics ray, plus the registry lane queue for the
   * lane we're actually in (so it works before physics.ts is implemented). `ignore` is skipped (e.g. the getaway
   * for police).
   */
  private probe(mv: Mover, lat: number, range: number, ignore = ""): Probe | null {
    const h = mv.pose.h;
    const x = mv.pose.x - Math.cos(h) * lat;
    const z = mv.pose.z + Math.sin(h) * lat;
    let best: Probe | null = null;
    const hit = obstacleAhead(mv.entry.id, x, z, h, range + mv.half, 1.1);
    if (hit && hit.id !== ignore) {
      const v = getVehicle(hit.id);
      best = { gap: hit.dist - mv.half, speed: v ? this.speedAlong(v, h) : 0, id: hit.id, kind: hit.kind };
    }
    if (Math.abs(lat) < 1.5) {
      // own lane: the registry's lane queue (works even without the physics ray)
      const l = mv.lead();
      if (l.v && l.v.id !== ignore && l.gap < range && (!best || l.gap < best.gap))
        best = { gap: l.gap, speed: l.speed, id: l.v.id, kind: l.v.kind };
    }
    if (lat >= 2 && (!best || best.gap > range * 0.6) && mv.oncoming(range)) {
      // something coming the other way in the oncoming lane: treat as a head-on obstacle
      best = { gap: range * 0.6, speed: -10, id: "", kind: "car" };
    }
    return best;
  }

  /** Another vehicle's speed along heading h (negative when it comes towards us). */
  private speedAlong(v: VehicleEntry, h: number) {
    const vh = v.object.rotation.y;
    return v.speed * (Math.sin(vh) * Math.sin(h) + Math.cos(vh) * Math.cos(h));
  }

  /** Speed at which we can still stop `gap` metres ahead behind something doing `speed`. */
  private safeSpeed(gap: number, speed: number, margin = 1.5) {
    return Math.max(0, speed) + Math.sqrt(2 * BRAKE * 0.8 * Math.max(0, gap - margin));
  }

  // --- chase lifecycle ------------------------------------------------------------------------

  private startChase() {
    const blocked = this.blocked;
    // start on a downtown street, away from the police station
    let path: string[] | null = null;
    for (let attempt = 0; attempt < 12 && !path; attempt++) {
      const i = Math.floor(between(-3, 4));
      const j = Math.floor(between(-3, 4));
      const a = `g_${i}_${j}`;
      if (!ROAD_NODES.has(a) || a === PLACES.policeStation) continue;
      const opts = neighbours(a).filter((n) => !blocked.has(edgeKey(a, n)));
      if (!opts.length) continue;
      const b = opts[Math.floor(rand() * opts.length)];
      poseAt([a, b], 0, 0.3, this.scratchPose);
      if (!this.isFree(this.scratchPose.x, this.scratchPose.z, 9)) continue;
      path = [a, b];
    }
    if (!path) {
      this.chaseTimer = 5;
      return;
    }
    this.g = rand() < 0.25 ? this.getaways.van : this.getaways.saloon;
    const g = this.g;
    g.mv.spawn(path, 0, 0.3, 3, "getaway");
    this.extendGetaway();
    g.parts.hazard.color.set("#5a3300");
    g.parts.body.rotation.set(0, 0, 0);
    g.parts.body.position.set(0, 0, 0);
    this.prevH = g.mv.pose.h;
    const ending = rollEnding(rand());
    this.chase = newChase(ending, rand);
    this.escapeDest = ending === "escape" ? escapeNode(getNode(path[0]), rand) : null;
    this.escapeRouted = false;
    this.manT = 0;
    this.arrestT = -1;
    this.lampFall = -1;
    this.lamppost.visible = false;
    this.body = null;
    this.rested = false;
    this.boxed = false;
    this.pitHit = this.collided = false;
    this.impact = null;
    this.roadblockTried = ending === "escape" || rand() > ROADBLOCK_CHANCE;

    // police: one from the station, the rest are patrol cars from nearby streets
    const startNode = getNode(path[0]);
    const nearby = [...ROAD_NODES.values()]
      .filter((n) => n.id.startsWith("g_") && n.id !== PLACES.policeStation && n.id !== path![0] && n.id !== path![1])
      .filter((n) => {
        const d = Math.hypot(n.x - startNode.x, n.z - startNode.z);
        return d > 80 && d < 200;
      })
      .sort(() => rand() - 0.5);
    const count = rand() < 0.55 ? 3 : 2;
    const starts = [PLACES.policeStation, ...nearby.map((n) => n.id)];
    this.police.forEach((p, i) => {
      p.mode = i < count ? "waiting" : "idle";
      p.spawnAt = i === 0 ? 1.2 : 2.2 + i * 1.4;
      p.start = starts[i] ?? PLACES.policeStation;
      p.slot = null;
      p.role = i;
      p.pitCool = 0;
    });

    // helicopter scrambles from over the station
    const st = getNode(PLACES.policeStation);
    this.heliPos.set(st.x - 60, HELI_Y + 30, st.z + 40);
    this.heliVel.set(0, 0, 0);
    this.heliActive = true;
    this.heliLeaveT = 0;
    this.heli.root.visible = true;
  }

  private stepChase(dt: number) {
    const s = this.chase!;
    const g = this.g!;

    for (const p of this.police) if (p.mode === "waiting" && s.t >= p.spawnAt && s.phase === "fleeing") this.spawnPolice(p);
    if (!this.roadblockTried && s.phase === "fleeing" && s.t > 8) this.tryRoadblock();
    if (this.roadblock && (this.sim > this.roadblock.until || s.phase === "leaving")) this.liftRoadblock();

    // inputs for the state machine
    let gap = Infinity;
    for (const p of this.police) {
      if (!p.mv.active || p.mode !== "pursue") continue;
      const d = Math.hypot(p.mv.object.position.x - g.mv.object.position.x, p.mv.object.position.z - g.mv.object.position.z);
      if (d < gap) gap = d;
    }
    const onMotorway = g.mv.active && !g.mv.free && isMotorwayEdge(g.mv.from, g.mv.to);
    const allHome = this.police.every((p) => !p.mv.active) && !this.heliActive && (!g.mv.active || !!this.wreck);
    const settled = this.rested && this.sim - this.restedAt > 2.2;
    const act = stepChase(s, { gap, pit: this.pitHit, collided: this.collided, settled, onMotorway, allHome }, dt);
    this.pitHit = this.collided = false;
    if (act) this.onAction(act);

    // vehicles
    if (g.mv.active) {
      const escaping = s.ending === "escape" && (s.phase === "escaped" || s.phase === "leaving");
      if (this.body) this.stepGetawayBody(dt);
      else if (s.phase === "fleeing" || escaping) this.driveGetaway(dt);
      else if (s.phase === "leaving") this.driveHome(g.mv, dt, 1);
      else g.mv.update(0);
    }
    for (const p of this.police) {
      if (!p.mv.active) continue;
      if (p.mode === "pursue") this.drivePolice(p, dt);
      else if (p.mode === "hold") this.holdPolice(p, dt);
      else if (p.mode === "box") this.boxPolice(p, dt);
      else if (p.mode === "leave") this.driveHome(p.mv, dt, 1.05);
      else p.mv.update(0);
    }
    if (this.rested && !this.boxed) this.startBoxIn();
    if (this.arrestT >= 0) this.stepArrest(dt);
    if (this.lampFall >= 0) {
      this.lampFall += dt;
      this.lamppost.rotation.x = 1.42 * Math.min(1, (this.lampFall / 1.1) ** 2);
    }
    this.stepHeli(dt);

    if (s.phase === "done") this.endChase();
  }

  private onAction(act: ChaseAction) {
    const g = this.g!;
    switch (act) {
      case "spin":
        // the body was already set up by the PIT contact; the rest of the units pull up
        for (const p of this.police) if (p.mv.active && p.mode === "pursue") p.mode = "hold";
        return;
      case "crash":
        this.startCrash();
        return;
      case "give_up":
        for (const p of this.police) if (p.mv.active) this.sendHome(p);
        this.liftRoadblock();
        this.gaveUpAt = this.chase!.t;
        this.heliLeaveT = 0.01;
        return;
      case "start_arrest":
        this.startArrest();
        return;
      case "release":
        this.arrestT = -1;
        for (const f of [...this.officers, this.suspect]) f.root.visible = false;
        for (const p of this.police) if (p.mv.active && p.mode !== "leave") this.sendHome(p);
        if (this.chase!.ending === "pit" && g.mv.active && !this.wreck) {
          this.body = null;
          this.rejoinHome(g.mv);
        }
        this.heliLeaveT = 0.01;
        return;
      case "finish":
        return;
    }
  }

  private endChase() {
    for (const p of this.police) {
      p.mv.despawn();
      p.mode = "idle";
    }
    this.liftRoadblock();
    if (this.g && !this.wreck) this.g.mv.despawn();
    this.body = null;
    this.heliActive = false;
    this.heli.root.visible = false;
    this.heli.cone.visible = false;
    this.heli.spot.visible = false;
    for (const f of [...this.officers, this.suspect]) f.root.visible = false;
    this.chase = null;
    this.chaseTimer = nextChaseDelay(rand);
  }

  // --- getaway ----------------------------------------------------------------------------

  /** Keep a few junctions of random route planned ahead (police predict it; roadblocks go on it). */
  private extendGetaway() {
    const mv = this.g!.mv;
    while (mv.idx + 6 >= mv.path.length) {
      const last = mv.path[mv.path.length - 1];
      const prev = mv.path[mv.path.length - 2];
      const next = chooseTurn(prev, last, this.blocked, rand);
      if (!next) return;
      mv.path.push(next);
    }
  }

  /** A road ahead just closed (roadblock): cut the planned route before it and pick again. */
  private rerouteGetaway() {
    const mv = this.g!.mv;
    for (let k = mv.idx + 1; k + 1 < mv.path.length; k++) {
      if (this.blocked.has(edgeKey(mv.path[k], mv.path[k + 1]))) {
        mv.path.length = k + 1;
        break;
      }
    }
    if (this.escapeRouted) this.routeEscape();
    else this.extendGetaway();
  }

  private routeEscape() {
    const mv = this.g!.mv;
    if (!this.escapeDest) return;
    const r = replanPath(mv.path, mv.idx, this.escapeDest, this.blocked);
    if (r) {
      mv.path = r.path;
      mv.idx = r.idx;
      this.escapeRouted = true;
    }
  }

  private driveGetaway(dt: number) {
    const s = this.chase!;
    const mv = this.g!.mv;
    // escape: head for the motorway once the chase has run a while; afterwards keep going along it
    if (s.ending === "escape" && !this.escapeRouted && s.t > s.minFleeS * 0.5) this.routeEscape();
    if (s.phase === "leaving" && s.t - this.gaveUpAt > 30) {
      mv.despawn(); // gone: lost on the motorway
      return;
    }
    if (this.escapeRouted && mv.idx + 2 >= mv.path.length) {
      this.escapeDest = escapeNode(getNode(mv.to), rand);
      this.routeEscape();
    }
    if (!this.escapeRouted) this.extendGetaway();
    if (mv.idx + 1 >= mv.path.length) return;

    const fleeing = s.phase === "fleeing";
    const reckless = isReckless(s);
    let v0 = mv.limit * (fleeing ? GETAWAY_FACTOR : 1.35);
    v0 = Math.min(v0, this.turnCap(mv, 9));

    // look ahead in the lane we're in (or heading for)
    const range = 10 + mv.speed * 1.5;
    const lane = mv.latTarget;
    const hit = this.probe(mv, lane, range);
    const blocking = hit && hit.speed < mv.speed - 1;
    if (blocking && !reckless) {
      const kind = getEdge(mv.from, mv.to)?.kind;
      const straight = straightAhead(mv.path, mv.idx, mv.t) > 28;
      if (lane === 0 && straight && !this.probe(mv, OVERTAKE_LAT, range + 30) && this.sideClear(mv, OVERTAKE_LAT)) {
        mv.latTarget = OVERTAKE_LAT; // wrong side of the road
        this.manT = 0;
      } else if (lane === 0 && (kind === "street" || kind === "country") && !this.probe(mv, KERB_LAT, range) && this.sideClear(mv, KERB_LAT)) {
        mv.latTarget = KERB_LAT; // up on the pavement
        this.manT = 0;
      } else if (lane !== 0 && !this.probe(mv, 0, Math.min(range, 18)) && this.sideClear(mv, 0)) {
        mv.latTarget = 0; // duck back in
      } else v0 = Math.min(v0, this.safeSpeed(hit.gap, hit.speed)); // nowhere to go: brake hard
    } else if (blocking && reckless && hit.gap < 25) {
      v0 = Math.max(v0, mv.speed); // foot down: it's going to hit it
    }
    // whatever lane we're physically in right now (mid lane change too): never drive into it
    const curLane = mv.lat > 2 ? OVERTAKE_LAT : mv.lat < -1.4 ? KERB_LAT : 0;
    if (!reckless && curLane !== lane) {
      const cur = this.probe(mv, curLane, range);
      if (cur && cur.speed < mv.speed - 1) v0 = Math.min(v0, this.safeSpeed(cur.gap, cur.speed));
    }
    if (mv.latTarget !== 0) {
      this.manT += dt;
      const nearJunction = mv.remaining < 10 && mv.idx + 2 < mv.path.length && turnKind(mv.from, mv.to, mv.path[mv.idx + 2]) !== 0;
      if ((this.manT > 1.2 && this.laneClear(mv, 9) && !this.probe(mv, 0, 12) && this.sideClear(mv, 0)) || nearJunction) mv.latTarget = 0;
      if (mv.latTarget === KERB_LAT || mv.lat < -1) v0 = Math.min(v0, 13);
    }
    // kerb: bounce and lean
    const onKerb = mv.lat < -1.4;
    mv.lift += ((onKerb ? 0.16 + Math.abs(Math.sin(this.sim * 23)) * 0.05 : 0) - mv.lift) * Math.min(1, dt * 12);
    this.accelerate(mv, v0, dt, 7, BRAKE + 1);

    // contact: never drive through what's in front; at speed it's a crash
    let ds = mv.speed * dt;
    const now = this.probe(mv, mv.lat > 2 ? OVERTAKE_LAT : mv.lat < -1.4 ? KERB_LAT : 0, ds + 2);
    if (now && now.gap > -1 && now.gap - ds <= 0.3) {
      const closing = mv.speed - now.speed;
      if ((reckless && closing > IMPACT_MIN) || (closing > UNAVOIDABLE && !canStop(mv.speed, now.speed, now.gap))) {
        this.collideGetaway(now, Math.max(0, now.gap - 0.2));
        return;
      }
      ds = Math.max(0, now.gap - 0.3);
      mv.speed = Math.min(mv.speed, Math.max(0, now.speed));
    }
    const entered = mv.move(ds);
    if (entered && !this.escapeRouted) this.extendGetaway();

    // body roll from turning
    const dh = wrap(mv.pose.h - this.prevH);
    this.prevH = mv.pose.h;
    const rollTarget = clamp((-dh / Math.max(dt, 1e-3)) * 0.05, -0.12, 0.12) + (onKerb ? 0.05 : 0);
    mv.roll += (rollTarget - mv.roll) * Math.min(1, dt * 6);
    mv.update(dt);
  }

  private turnCap(mv: Mover, vTurn: number) {
    if (mv.idx + 2 >= mv.path.length) return Math.max(3, mv.remaining * 0.8);
    const tk = turnKind(mv.from, mv.to, mv.path[mv.idx + 2]);
    if (tk === 0) return Infinity;
    const vt = tk === 2 ? 4 : vTurn;
    return vt + Math.max(0, mv.remaining - 6) * 0.55;
  }

  private accelerate(mv: Mover, v0: number, dt: number, up: number, down: number) {
    mv.speed = Math.max(0, mv.speed + clamp(v0 - mv.speed, -down * dt, up * dt));
  }

  /** No vehicle on our own lane within `m` metres of us (so we can pull back in). */
  private laneClear(mv: Mover, m: number) {
    const len = mv.edgeLen;
    const mine = mv.t * len;
    for (const v of allVehicles()) {
      if (v.id === mv.entry.id || v.from !== mv.from || v.to !== mv.to) continue;
      if (Math.abs(v.t * len - mine) < m) return false;
    }
    return true;
  }

  /** Nothing beside us (within a car length) in the lane at offset `lat`: safe to move across. */
  private sideClear(mv: Mover, lat: number) {
    const h = mv.pose.h;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const x = mv.pose.x - fz * lat;
    const z = mv.pose.z + fx * lat;
    for (const v of allVehicles()) {
      if (v.id === mv.entry.id) continue;
      const dx = v.object.position.x - x;
      const dz = v.object.position.z - z;
      if (Math.abs(dx * fx + dz * fz) < 6.5 && Math.abs(-dx * fz + dz * fx) < 1.9) return false;
    }
    return true;
  }

  private burst(x: number, y: number, z: number, sparks: number, puffs: number) {
    for (let i = 0; i < sparks; i++) {
      const a = rand() * Math.PI * 2;
      const sp = between(3, 9);
      this.sparks.emit(x, y, z, Math.cos(a) * sp, between(2, 7), Math.sin(a) * sp, between(0.3, 0.7), between(0.07, 0.12), 1, between(0.6, 0.9), 0.3);
    }
    for (let i = 0; i < puffs; i++) {
      const a = rand() * Math.PI * 2;
      this.sparks.emit(x, 0.6, z, Math.cos(a) * 1.5, between(0.6, 1.5), Math.sin(a) * 1.5, between(1.6, 2.6), between(0.5, 0.9), 0.4, 0.4, 0.42);
    }
  }

  // --- physics: collisions and the rigid body -------------------------------------------------

  /** Bake the lane offset into the pose and switch to scripted motion. */
  private freeze(mv: Mover) {
    const h = mv.pose.h;
    mv.pose.x -= Math.cos(h) * mv.lat;
    mv.pose.z += Math.sin(h) * mv.lat;
    mv.lat = mv.latTarget = mv.latVel = 0;
    mv.lift = 0;
    mv.free = true;
  }

  /** Hand the getaway over to the rigid-body integrator with this body. */
  private startBody(b: Body) {
    const mv = this.g!.mv;
    this.freeze(mv);
    mv.yaw = 0;
    this.body = b;
    this.rested = false;
  }

  /** The getaway hits `hit` after moving `ds`: momentum transfer, the other car crashes, both slide. */
  private collideGetaway(hit: Probe, ds: number) {
    const mv = this.g!.mv;
    mv.move(ds);
    mv.update(0);
    this.freeze(mv);
    const h = mv.pose.h;
    const victim = hit.id ? getVehicle(hit.id) : undefined;
    const m1 = MASS[mv.entry.kind] ?? 1500;
    const m2 = victim ? (MASS[victim.kind] ?? 1500) : 1500;
    const [v1] = collide(m1, mv.speed, m2, hit.speed, 0.25);
    const ids = [mv.entry.id];
    if (victim?.crash && victim.crash()) ids.push(victim.id); // its owner plays the shove / spin
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const closing = mv.speed - hit.speed;
    const side = rand() < 0.5 ? -1 : 1; // offset impact: the rear swings round
    this.startBody({
      x: mv.pose.x, z: mv.pose.z, h,
      vx: fx * v1 - fz * side * closing * 0.12,
      vz: fz * v1 + fx * side * closing * 0.12,
      w: side * Math.min(4, 0.6 + closing * 0.12),
    });
    const x = mv.pose.x + fx * 2.3;
    const z = mv.pose.z + fz * 2.3;
    this.burst(x, 0.7, z, 30, 8);
    this.impact = { x, z, ids, note: `Police chase ends in a crash: getaway car smashed into a ${victim?.kind ?? "car"}` };
    this.collided = true;
  }

  /** Integrate the getaway body (PIT spin, crash slide); stop against anything it slides into. */
  private stepGetawayBody(dt: number) {
    const b = this.body!;
    const mv = this.g!.mv;
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0.5) {
      const dir = Math.atan2(b.vx, b.vz);
      const hit = obstacleAhead(mv.entry.id, b.x, b.z, dir, sp * dt + 2.4, 1.0);
      if (hit && hit.dist < sp * dt + 2.4) {
        const v = getVehicle(hit.id);
        const [v1] = collide(MASS[mv.entry.kind] ?? 1500, sp, v ? (MASS[v.kind] ?? 1500) : 1500, v ? this.speedAlong(v, dir) : 0, 0.3);
        const k = Math.max(0, v1) / sp;
        b.vx *= k;
        b.vz *= k;
        b.w *= 0.5;
        this.burst(b.x + Math.sin(dir) * 2, 0.6, b.z + Math.cos(dir) * 2, 12, 2);
        if (v?.crash && sp > 6 && v.crash()) {
          if (!this.wreck) this.openIncident({ x: b.x, z: b.z, ids: [mv.entry.id, v.id], note: "Police chase: spinning getaway car hit another vehicle" });
        }
      }
    }
    // lamppost fallback: it stops dead against the post
    if (this.lamppost.visible && this.lampFall < 0 && Math.hypot(this.lamppost.position.x - b.x, this.lamppost.position.z - b.z) < 2.6) {
      b.vx = b.vz = 0;
      b.w *= 0.3;
      this.lampFall = 0;
      this.burst(this.lamppost.position.x, 0.8, this.lamppost.position.z, 30, 8);
    }
    const rested = stepBody(b, dt);
    mv.pose.x = b.x;
    mv.pose.z = b.z;
    mv.pose.h = b.h;
    mv.yaw = 0;
    mv.speed = Math.hypot(b.vx, b.vz);
    mv.roll = clamp(b.w * 0.03, -0.1, 0.1);
    if (!rested && sp > 2 && rand() < 0.6) {
      // tyre smoke from the rear
      this.sparks.emit(b.x - Math.sin(b.h) * 2, 0.3, b.z - Math.cos(b.h) * 2, 0, 0.8, 0, 1.4, 0.45, 0.75, 0.75, 0.78);
    }
    if (rested && !this.rested) {
      this.rested = true;
      this.restedAt = this.sim;
      mv.roll = 0;
      mv.speed = 0;
    }
    mv.update(0);
  }

  /** When the getaway comes to rest, the nearest units park around it. */
  private startBoxIn() {
    this.boxed = true;
    const g = this.g!.mv;
    const slots = boxSlots(g.pose.x, g.pose.z, g.pose.h, 3);
    const units = this.police
      .filter((p) => p.mv.active && (p.mode === "pursue" || p.mode === "hold"))
      .sort((a, b) => this.distTo(a.mv, g) - this.distTo(b.mv, g));
    units.slice(0, slots.length).forEach((p, i) => this.startBox(p, slots[i]));
  }

  private distTo(a: Mover, b: Mover) {
    return Math.hypot(a.object.position.x - b.object.position.x, a.object.position.z - b.object.position.z);
  }

  private startCrash() {
    const mv = this.g!.mv;
    for (const p of this.police) if (p.mv.active && p.mode === "pursue") p.mode = "hold";
    if (this.impact) {
      this.openIncident(this.impact);
      this.impact = null;
      return;
    }
    // never hit anything: it loses control into a lamppost on the kerb
    this.freeze(mv);
    const h = mv.pose.h;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const lx = Math.cos(h); // left of travel
    const lz = -Math.sin(h);
    const ahead = clamp(mv.speed * 0.7, 7, 14);
    const px = mv.pose.x + fx * ahead + lx * 3.2;
    const pz = mv.pose.z + fz * ahead + lz * 3.2;
    this.lamppost.position.set(px, 0, pz);
    this.lamppost.rotation.set(0, h, 0, "YXZ");
    this.lamppost.visible = true;
    this.lampFall = -1;
    const dx = px - mv.pose.x;
    const dz = pz - mv.pose.z;
    const d = Math.hypot(dx, dz) || 1;
    const v = Math.max(mv.speed, 9);
    this.startBody({ x: mv.pose.x, z: mv.pose.z, h, vx: (dx / d) * v, vz: (dz / d) * v, w: 0.6 });
    this.openIncident({ x: px, z: pz, ids: [mv.entry.id], note: "Police chase ends in a crash: getaway car hit a lamppost" });
  }

  /** car_crash incident on the getaway's road: closes it so Responders come and traffic reroutes. */
  private openIncident(imp: Impact) {
    const mv = this.g!.mv;
    const key = mv.path.length >= 2 ? edgeKey(mv.from, mv.to) : (mv.entry.edgeKey ?? "");
    if (!key || this.wreck) return;
    const incidentId = nextId("INC");
    this.wreck = { incidentId, at: this.sim, smokeT: 0 };
    const w = useWorld.getState();
    try {
      w.addIncident({ id: incidentId, kind: "car_crash", edgeKey: key, x: imp.x, z: imp.z, status: "active", createdAt: performance.now(), note: imp.note });
      w.blockEdge(key, imp.note);
      emit({ type: "incident:created", incidentId });
      emit({ type: "road:blocked", edgeKey: key, reason: imp.note });
      for (const vehicleId of imp.ids) emit({ type: "vehicle:crashed", vehicleId, incidentId });
    } catch (err) {
      console.warn("[Chases] incident failed", err);
    }
  }

  private stepWreck(dt: number) {
    const w = this.wreck;
    if (!w || !this.g) return;
    const mv = this.g.mv;
    const age = this.sim - w.at;
    this.g.parts.hazard.color.set(Math.floor(this.sim * 2.6) % 2 ? "#ffb020" : "#5a3300");
    w.smokeT -= dt;
    if (w.smokeT <= 0) {
      w.smokeT = 0.35;
      const h = mv.pose.h + mv.yaw;
      this.sparks.emit(mv.pose.x + Math.sin(h) * 1.6, 1.0, mv.pose.z + Math.cos(h) * 1.6, between(-0.3, 0.3), 1.2, between(-0.3, 0.3), 2.4, 0.5, 0.33, 0.33, 0.35);
    }
    if (!this.chase) {
      if (this.lampFall >= 0) {
        this.lampFall += dt;
        this.lamppost.rotation.x = 1.42 * Math.min(1, (this.lampFall / 1.1) ** 2);
      }
      mv.update(0);
    }
    // safety net: nobody cleared it
    if (age > WRECK_SAFETY_S) this.clearWreckIncident();
  }

  private clearWreckIncident() {
    const w = this.wreck;
    if (!w) return;
    const st = useWorld.getState();
    const inc = st.incidents.find((i) => i.id === w.incidentId);
    if (inc && inc.status !== "cleared") {
      st.updateIncident(inc.id, { status: "cleared" });
      st.unblockEdge(inc.edgeKey);
      emit({ type: "incident:cleared", incidentId: inc.id });
      emit({ type: "road:reopened", edgeKey: inc.edgeKey });
    }
    this.removeWreck();
  }

  private removeWreck() {
    if (!this.wreck) return;
    this.wreck = null;
    this.lamppost.visible = false;
    this.lampFall = -1;
    if (this.g && (!this.chase || this.chase.phase === "leaving" || this.chase.phase === "done")) {
      this.g.mv.despawn();
      this.body = null;
    }
  }

  // --- roadblock --------------------------------------------------------------------------

  /** Rarely: two cars parked across a junction on the getaway's predicted route, and that road closed. */
  private tryRoadblock() {
    this.roadblockTried = true;
    const g = this.g!.mv;
    const site = roadblockSite(g.path, g.idx, g.t, 70, 240);
    if (!site) return;
    const key = edgeKey(site.node, site.exit);
    if (this.blocked.has(key)) return;
    const units = this.police.slice(PATROL).filter((p) => !p.mv.active);
    if (units.length < 2) return;
    units.forEach((p, i) => {
      const slot = site.slots[i];
      p.mv.spawn([site.node, site.exit], 0, 0.2, 0, "police");
      this.freeze(p.mv);
      p.mv.pose.x = slot.x;
      p.mv.pose.z = slot.z;
      p.mv.pose.h = slot.h;
      p.mv.speed = 0;
      p.mv.update(0);
      p.mode = "block";
    });
    const reason = "Police roadblock";
    try {
      useWorld.getState().blockEdge(key, reason);
      emit({ type: "road:blocked", edgeKey: key, reason });
    } catch (err) {
      console.warn("[Chases] roadblock failed", err);
    }
    this.blocked.add(key);
    this.roadblock = { key, until: this.sim + ROADBLOCK_S };
    this.rerouteGetaway();
  }

  private liftRoadblock() {
    const rb = this.roadblock;
    if (!rb) return;
    this.roadblock = null;
    try {
      const st = useWorld.getState();
      if (st.blocked[rb.key] === "Police roadblock") {
        st.unblockEdge(rb.key);
        emit({ type: "road:reopened", edgeKey: rb.key });
      }
    } catch (err) {
      console.warn("[Chases] roadblock lift failed", err);
    }
    for (const p of this.police.slice(PATROL)) if (p.mv.active && p.mode === "block") this.sendHome(p);
  }

  // --- police -----------------------------------------------------------------------------

  private spawnPolice(p: Police) {
    const g = this.g!.mv;
    const tgt = pursuitTarget(p.role, { from: g.from, to: g.to, path: g.path, idx: g.idx }, "", this.predicted(p));
    let path = findPath(p.start, tgt, this.blocked);
    if (!path || path.length < 2) {
      const nb = neighbours(p.start).find((n) => !this.blocked.has(edgeKey(p.start, n)));
      if (!nb) return;
      path = [p.start, nb];
    }
    p.mv.spawn(path, 0, 0.05, 6, "police");
    p.mode = "pursue";
    p.checkIn = 0.5;
    p.manT = 0;
  }

  /** Where the getaway will be by the time this unit could get there. */
  private predicted(p: Police) {
    const g = this.g!.mv;
    const from = p.mv.active ? p.mv.object.position : getNode(p.start);
    const d = Math.hypot(g.object.position.x - from.x, g.object.position.z - from.z);
    const vPolice = (getEdge(g.from, g.to)?.speedLimit ?? 11) * POLICE_FACTOR;
    return predictNode(g.path, g.idx, g.t, g.speed, interceptHorizon(d, vPolice));
  }

  private drivePolice(p: Police, dt: number) {
    const mv = p.mv;
    const g = this.g!.mv;
    const s = this.chase!;
    // on the getaway's road behind it: share its route exactly
    if (mv.from === g.from && mv.to === g.to && !g.free) {
      if (mv.path[mv.idx + 2] !== g.path[g.idx + 2] || mv.path.length - mv.idx !== g.path.length - g.idx) {
        const prev = mv.idx > 0 ? mv.path[mv.idx - 1] : null;
        mv.path = prev ? [prev, ...g.path.slice(g.idx)] : g.path.slice(g.idx);
        mv.idx = prev ? 1 : 0;
      }
    } else {
      p.checkIn -= dt;
      if (p.checkIn <= 0 || mv.idx + 2 >= mv.path.length) {
        p.checkIn = 1.5;
        this.repath(p);
      }
    }
    if (mv.idx + 1 >= mv.path.length) return;

    const factor = s.ending === "escape" && s.t > s.minFleeS * 0.5 ? POLICE_GIVEUP_FACTOR : POLICE_FACTOR;
    let v0 = Math.min(mv.limit * factor, this.turnCap(mv, 8.5));

    // the getaway's actual position, relative to us
    const gh = g.pose.h;
    const dx = g.object.position.x - mv.object.position.x;
    const dz = g.object.position.z - mv.object.position.z;
    const d = Math.hypot(dx, dz);
    const sameWay = Math.sin(mv.pose.h) * Math.sin(gh) + Math.cos(mv.pose.h) * Math.cos(gh) > 0.5;
    const along = -(dx * Math.sin(gh) + dz * Math.cos(gh)); // our position along its heading (negative = behind)
    const closeBehind = sameWay && d < 50 && along < 0;
    if (d < 25) p.role = 0; // in contact: everyone tails
    // coming at it head-on (an interceptor): slow right down and pull in to the kerb to let it by,
    // then the next re-path turns us round
    const headOn = !sameWay && d < 35 && along > 0 && Math.sin(mv.pose.h) * dx + Math.cos(mv.pose.h) * dz > 0;
    if (headOn && !pitAllowed(s)) {
      v0 = Math.min(v0, 3);
      if (mv.latTarget === 0 && getEdge(mv.from, mv.to)?.kind === "street" && this.sideClear(mv, KERB_LAT)) mv.latTarget = KERB_LAT;
    } else if (mv.latTarget === KERB_LAT && !headOn) mv.latTarget = 0;
    // a unit that ended up in front eases off so the getaway blasts past and it can drop in behind
    if (sameWay && d < 40 && along > 2) v0 = Math.min(v0, g.speed * 0.7);

    // PIT: pull alongside its rear quarter, then make contact
    p.pitCool -= dt;
    const pitting = pitAllowed(s) && closeBehind && d < 22 && !g.free && straightAhead(mv.path, mv.idx, mv.t) > 10;
    if (pitting) {
      if (mv.latTarget === 0 || Math.abs(mv.latTarget) !== PIT_SIDE) {
        const side = mv.oncoming(35) ? -PIT_SIDE : PIT_SIDE;
        if (this.sideClear(mv, side)) mv.latTarget = side;
      }
      v0 = Math.min(mv.limit * factor * 1.1, g.speed + clamp((PIT_ALONG - along) * 2.2, -5, 7));
      const c = pitContact(this.carState(g), this.carState(mv));
      if (c.alongside && p.pitCool <= 0) this.attemptPit(p, c);
    } else {
      if (closeBehind) v0 = Math.min(v0, g.speed + (d - 8) * 0.9); // close the gap on its real position, then hold 8 m
      // obstacles (anything but the getaway): overtake if the other side is clear, else brake
      const range = 8 + mv.speed * 1.4;
      const hit = this.probe(mv, mv.latTarget, range, g.entry.id);
      if (mv.latTarget === 0) {
        if (hit && hit.speed < mv.speed - 1) {
          if (straightAhead(mv.path, mv.idx, mv.t) > 28 && !this.probe(mv, OVERTAKE_LAT, range + 25, g.entry.id) && this.sideClear(mv, OVERTAKE_LAT)) {
            mv.latTarget = OVERTAKE_LAT;
            p.manT = 0;
          } else v0 = Math.min(v0, this.safeSpeed(hit.gap, hit.speed, 2.5));
        }
      } else {
        p.manT += dt;
        const nearJunction = mv.remaining < 10 && mv.idx + 2 < mv.path.length && turnKind(mv.from, mv.to, mv.path[mv.idx + 2]) !== 0;
        if ((p.manT > 1.2 && this.laneClear(mv, 9) && !this.probe(mv, 0, 12, g.entry.id) && this.sideClear(mv, 0)) || nearJunction) mv.latTarget = 0;
        if (hit) v0 = Math.min(v0, this.safeSpeed(hit.gap, hit.speed, 2.5));
      }
    }
    this.accelerate(mv, Math.max(0, v0), dt, 7.5, BRAKE + 1);
    const entered = mv.move(this.limitStep(mv, mv.speed * dt, pitting ? g.entry.id : ""));
    if (entered) this.repath(p);
    mv.update(dt);
  }

  /** Don't move into what's in front (the PIT car may touch the getaway: `allow`). */
  private limitStep(mv: Mover, ds: number, allow = "") {
    const lat = mv.lat > 2 ? OVERTAKE_LAT : mv.lat < -1.4 ? KERB_LAT : mv.lat > 1 ? PIT_SIDE : 0;
    const hit = this.probe(mv, lat, ds + 2, allow);
    if (hit && hit.gap - ds <= 0.4) {
      mv.speed = Math.min(mv.speed, Math.max(0, hit.speed));
      return Math.max(0, hit.gap - 0.4);
    }
    return ds;
  }

  private carState(mv: Mover) {
    return { x: mv.object.position.x, z: mv.object.position.z, h: mv.object.rotation.y, speed: mv.speed };
  }

  /** Bump the getaway's rear quarter; on success it spins out (rigid body), else both just jolt. */
  private attemptPit(p: Police, c: PitContact) {
    p.pitCool = 1.2;
    const g = this.g!.mv;
    const gx = g.object.position.x;
    const gz = g.object.position.z;
    this.burst((gx + p.mv.object.position.x) / 2, 0.6, (gz + p.mv.object.position.z) / 2, 10, 0);
    if (rand() >= pitChance(c)) {
      p.mv.speed *= 0.85; // glanced off
      g.yaw = (c.side > 0 ? -1 : 1) * 0.08;
      return;
    }
    this.startBody(pitImpulse(this.carState(g), c));
    p.mv.latTarget = 0;
    this.pitHit = true;
  }

  /** Re-path to the pursuit target (each junction, and every couple of seconds). */
  private repath(p: Police) {
    const mv = p.mv;
    const g = this.g!.mv;
    const tgt = pursuitTarget(p.role, { from: g.from, to: g.to, path: g.path, idx: g.idx }, mv.to, this.predicted(p));
    const r = replanPath(mv.path, mv.idx, tgt, this.blocked);
    if (r) {
      mv.path = r.path;
      mv.idx = r.idx;
    } else if (mv.idx + 2 >= mv.path.length) {
      const next = chooseTurn(mv.from, mv.to, this.blocked, rand);
      if (next) mv.path.push(next);
    }
  }

  /** After the getaway spins or crashes: pull up (brake to a stop, never into anything). */
  private holdPolice(p: Police, dt: number) {
    const mv = p.mv;
    if (mv.idx + 1 >= mv.path.length || mv.free) return mv.update(0);
    mv.latTarget = 0;
    this.accelerate(mv, 0, dt, 0, 8);
    mv.move(this.limitStep(mv, mv.speed * dt));
    mv.update(dt);
  }

  private startBox(p: Police, slot: Slot | undefined) {
    if (!slot) return;
    p.slot = slot;
    p.mode = "box";
    p.boxU = 0;
    p.boxDur = 0;
  }

  /** Drive towards the scene, then glide into the box-in slot and stop. */
  private boxPolice(p: Police, dt: number) {
    const mv = p.mv;
    const slot = p.slot!;
    const d = Math.hypot(slot.x - mv.pose.x, slot.z - mv.pose.z);
    if (p.boxDur === 0) {
      const stuck = mv.idx + 2 >= mv.path.length && mv.t >= 0.99;
      if (d > 45 && !mv.free && !stuck) {
        // still far: keep driving towards the getaway's node, then box
        const g = this.g!.mv;
        if (mv.idx + 2 >= mv.path.length) {
          const r = replanPath(mv.path, mv.idx, g.to !== mv.to ? g.to : g.from, new Set());
          if (r) {
            mv.path = r.path;
            mv.idx = r.idx;
          }
        }
        let v0 = Math.min(mv.limit * 1.6, this.turnCap(mv, 8));
        const hit = this.probe(mv, 0, 8 + mv.speed * 1.4);
        if (hit) v0 = Math.min(v0, this.safeSpeed(hit.gap, hit.speed, 2.5));
        this.accelerate(mv, v0, dt, 7, BRAKE);
        mv.move(this.limitStep(mv, mv.speed * dt));
        mv.update(dt);
        return;
      }
      this.freeze(mv);
      p.boxFrom = { x: mv.pose.x, z: mv.pose.z, h: mv.pose.h + mv.yaw };
      mv.yaw = 0;
      p.boxDur = clamp(d / 7, 1.4, 3.5);
    }
    p.boxU = Math.min(1, p.boxU + dt / p.boxDur);
    const e = smooth(p.boxU);
    mv.pose.x = p.boxFrom.x + (slot.x - p.boxFrom.x) * e;
    mv.pose.z = p.boxFrom.z + (slot.z - p.boxFrom.z) * e;
    mv.pose.h = p.boxFrom.h + wrap(slot.h - p.boxFrom.h) * e;
    mv.speed = p.boxU < 1 ? d / Math.max(0.3, p.boxDur * (1 - p.boxU)) : 0;
    mv.pitch = p.boxU > 0.85 && p.boxU < 1 ? 0.04 : 0;
    if (p.boxU >= 1) {
      mv.speed = 0;
      mv.pitch = 0;
      p.mode = "parked";
    }
    mv.update(0);
  }

  private sendHome(p: Police) {
    p.mode = "leave";
    this.rejoinHome(p.mv);
  }

  /** From wherever the vehicle is (maybe off-lane after a box-in), rejoin the road and head to the station. */
  private rejoinHome(mv: Mover) {
    const ref = mv.free && this.g ? this.g.mv : mv;
    let a = ref.path[ref.idx] ?? mv.from;
    let b = ref.path[ref.idx + 1] ?? mv.to;
    if (mv.free) {
      // drive off in whichever direction the car is pointing
      const na = getNode(a);
      const nb = getNode(b);
      const h = mv.pose.h + mv.yaw;
      if (Math.sin(h) * (nb.x - na.x) + Math.cos(h) * (nb.z - na.z) < 0) [a, b] = [b, a];
    }
    const t = mv.free ? clamp(blockageT(a, b, mv.pose.x, mv.pose.z), 0.02, 0.95) : mv.t;
    const others = new Set(this.blocked);
    others.delete(edgeKey(a, b));
    const tail = findPath(b, PLACES.policeStation, others) ?? [b];
    mv.speed = Math.min(mv.speed, 4);
    mv.rejoin(a, b, t, tail);
  }

  private driveHome(mv: Mover, dt: number, factor: number) {
    if (mv.idx + 1 >= mv.path.length || (mv.idx + 2 >= mv.path.length && mv.t > 0.85)) {
      mv.despawn();
      return;
    }
    let v0 = Math.min(mv.limit * factor, this.turnCap(mv, 7));
    const range = 6 + mv.speed * 1.4;
    const hit = this.probe(mv, mv.latTarget, range);
    if (mv.latTarget === 0) {
      if (hit && hit.gap < 14 && hit.speed < 0.5 && !this.probe(mv, OVERTAKE_LAT, 35) && this.sideClear(mv, OVERTAKE_LAT)) mv.latTarget = OVERTAKE_LAT; // round a wreck or a queue
      else if (hit) v0 = Math.min(v0, this.safeSpeed(hit.gap, hit.speed, 3));
    } else {
      if (hit) v0 = Math.min(v0, this.safeSpeed(hit.gap, hit.speed, 3));
      if ((this.laneClear(mv, 9) && !this.probe(mv, 0, 10) && this.sideClear(mv, 0)) || mv.remaining < 8) mv.latTarget = 0;
    }
    // safety net: still stuck after a while, just pull away out of shot
    mv.stuck = mv.speed < 0.3 ? mv.stuck + dt : 0;
    if (mv.stuck > 8) {
      mv.despawn();
      return;
    }
    this.accelerate(mv, Math.max(0, v0), dt, 3.5, 9);
    mv.move(this.limitStep(mv, mv.speed * dt));
    mv.update(dt);
  }

  private isFree(x: number, z: number, r: number) {
    for (const v of allVehicles()) if (Math.hypot(v.object.position.x - x, v.object.position.z - z) < r) return false;
    return true;
  }

  // --- arrest -----------------------------------------------------------------------------

  private startArrest() {
    const g = this.g!.mv;
    const h = g.pose.h + g.yaw;
    // UK cars: the driver gets out on the right
    this.suspectFrom = { x: g.pose.x - Math.cos(h) * 1.5, z: g.pose.z + Math.sin(h) * 1.5 };
    const cops = this.police
      .filter((p) => p.mv.active && p.mode !== "block")
      .sort((a, b) => (a.mode === "parked" ? 0 : 1) - (b.mode === "parked" ? 0 : 1) || this.distTo(a.mv, g) - this.distTo(b.mv, g))
      .slice(0, 2);
    this.arrestCops = cops;
    cops.forEach((p, i) => {
      const ph = p.mv.pose.h;
      this.officerFrom[i] = [p.mv.pose.x - Math.cos(ph) * 1.4, p.mv.pose.z + Math.sin(ph) * 1.4];
    });
    this.officers.forEach((f, i) => {
      f.root.visible = i < cops.length;
      f.root.position.set(this.officerFrom[i][0], 0, this.officerFrom[i][1]);
    });
    this.arrestT = 0;
  }

  private walk(f: Figure, ax: number, az: number, bx: number, bz: number, u: number) {
    const e = smooth(u);
    f.root.position.set(ax + (bx - ax) * e, u > 0 && u < 1 ? Math.abs(Math.sin(this.sim * 9)) * 0.07 : 0, az + (bz - az) * e);
    if (Math.hypot(bx - ax, bz - az) > 0.3 && u < 1) f.root.rotation.y = Math.atan2(bx - ax, bz - az);
  }

  private stepArrest(dt: number) {
    this.arrestT += dt;
    const T = this.arrestT;
    const g = this.g!.mv;
    const h = g.pose.h + g.yaw;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const door = this.suspectFrom;
    const cops = this.arrestCops;
    const car0 = cops[0]?.mv;
    // the suspect is put in the back of the first police car, on its left
    const cellX = car0 ? car0.pose.x + Math.cos(car0.pose.h) * 1.5 - Math.sin(car0.pose.h) * 0.6 : door.x;
    const cellZ = car0 ? car0.pose.z - Math.sin(car0.pose.h) * 1.5 - Math.cos(car0.pose.h) * 0.6 : door.z;
    const posts: [number, number][] = [
      [door.x + fx * 1.1, door.z + fz * 1.1],
      [door.x - fx * 1.1 - Math.cos(h) * 0.6, door.z - fz * 1.1 + Math.sin(h) * 0.6],
    ];
    this.officers.forEach((f, i) => {
      if (i >= cops.length) return;
      const [ox, oz] = this.officerFrom[i];
      const [px, pz] = posts[i];
      if (T < 2.5) this.walk(f, ox, oz, px, pz, T / 2.5);
      else if (T < 3.6) f.root.rotation.y = Math.atan2(door.x - f.root.position.x, door.z - f.root.position.z);
      else if (T < 8.6) {
        // escort: officer 0 walks beside the suspect, officer 1 follows
        const u = (T - 3.6) / 5;
        const sx = cellX + (i === 0 ? fz * 0.7 : -fx * 1.4);
        const sz = cellZ + (i === 0 ? -fx * 0.7 : -fz * 1.4);
        this.walk(f, px, pz, sx, sz, u);
      } else if (T < 11.6) {
        const sx = cellX + (i === 0 ? fz * 0.7 : -fx * 1.4);
        const sz = cellZ + (i === 0 ? -fx * 0.7 : -fz * 1.4);
        this.walk(f, sx, sz, ox, oz, (T - 8.6) / 3);
      } else f.root.visible = false;
    });
    const sus = this.suspect.root;
    if (T < 2.6) sus.visible = false;
    else if (T < 3.6) {
      sus.visible = true;
      sus.position.set(door.x, 0, door.z);
      sus.rotation.y = h - Math.PI / 2;
    } else if (T < 8.6) this.walk(this.suspect, door.x, door.z, cellX, cellZ, (T - 3.6) / 5);
    else sus.visible = false;
  }

  // --- helicopter -------------------------------------------------------------------------

  private stepHeli(dt: number) {
    if (!this.heliActive) return;
    const heli = this.heli;
    const g = this.g?.mv;
    let tx: number;
    let tz: number;
    let ty = HELI_Y;
    if (this.heliLeaveT > 0) {
      this.heliLeaveT += dt;
      const st = getNode(PLACES.policeStation);
      tx = st.x - 500;
      tz = st.z - 700;
      ty = HELI_Y + 50;
      if (this.heliLeaveT > 22) {
        this.heliActive = false;
        heli.root.visible = heli.cone.visible = heli.spot.visible = false;
        return;
      }
    } else if (g && (g.active || this.wreck)) {
      this.heliOrbit += dt * 0.3;
      const lead = g.free ? 0 : Math.min(18, g.speed * 0.8);
      tx = g.pose.x + Math.sin(g.pose.h) * lead + Math.cos(this.heliOrbit) * 22;
      tz = g.pose.z + Math.cos(g.pose.h) * lead + Math.sin(this.heliOrbit) * 22;
    } else {
      tx = this.heliPos.x;
      tz = this.heliPos.z;
    }
    // critically-damped-ish follow with a speed cap
    const ax = (tx - this.heliPos.x) * 1.1 - this.heliVel.x * 1.6;
    const ay = (ty - this.heliPos.y) * 1.1 - this.heliVel.y * 1.6;
    const az = (tz - this.heliPos.z) * 1.1 - this.heliVel.z * 1.6;
    this.heliVel.x += ax * dt;
    this.heliVel.y += ay * dt;
    this.heliVel.z += az * dt;
    const sp = Math.hypot(this.heliVel.x, this.heliVel.z);
    if (sp > 34) {
      this.heliVel.x *= 34 / sp;
      this.heliVel.z *= 34 / sp;
    }
    this.heliPos.addScaledVector(this.heliVel, dt);
    const r = heli.root;
    r.position.copy(this.heliPos);
    const wantH = sp > 2 ? Math.atan2(this.heliVel.x, this.heliVel.z) : r.rotation.y;
    r.rotation.order = "YXZ";
    r.rotation.y += wrap(wantH - r.rotation.y) * Math.min(1, dt * 1.5);
    r.rotation.x = clamp(sp * 0.008, 0, 0.22);
    heli.rotor.rotation.y += dt * 30;
    heli.tailRotor.rotation.x += dt * 40;
    heli.beacon.visible = Math.floor(this.sim * 1.6) % 2 === 0;

    // searchlight at night: cone from the pod down to the getaway
    const showBeam = this.night && this.heliLeaveT === 0 && !!g && (g.active || !!this.wreck);
    heli.cone.visible = heli.spot.visible = showBeam;
    if (showBeam && g) {
      const gx = g.pose.x + Math.sin(this.sim * 0.9) * 1.5;
      const gz = g.pose.z + Math.cos(this.sim * 0.7) * 1.5;
      const top = this.tmpV.set(this.heliPos.x, this.heliPos.y - 1.3, this.heliPos.z);
      const dir = this.tmpU.set(top.x - gx, top.y, top.z - gz);
      const len = dir.length();
      dir.divideScalar(len || 1);
      heli.cone.position.set((top.x + gx) / 2, top.y / 2, (top.z + gz) / 2);
      heli.cone.quaternion.setFromUnitVectors(this.up, dir);
      heli.cone.scale.set(5.5, len, 5.5);
      heli.coneMat.uniforms.uOpacity.value = 0.55;
      heli.spot.position.set(gx, 0.12, gz);
      heli.spotMat.opacity = 0.9;
    }
  }

  // --- police visuals ---------------------------------------------------------------------

  private renderPolice() {
    let light = 0;
    const t = this.sim;
    for (const p of this.police) {
      const blues = p.mv.active && p.mode !== "leave";
      const { lightL, lightR, ring, ringMat } = p.parts;
      if (!p.mv.active) continue;
      const f = t * 4.5 + p.flash;
      const sideL = Math.sin(f * Math.PI) > 0;
      const strobe = Math.sin(f * Math.PI * 6) > -0.2 ? 1 : 0.35;
      lightL.emissiveIntensity = blues ? (sideL ? 5 * strobe : 0.25) : 0.15;
      lightR.emissiveIntensity = blues ? (sideL ? 0.25 : 5 * strobe) : 0.15;
      if (blues) {
        const ph = (t * 1.2 + p.flash) % 1;
        ring.visible = true;
        ring.scale.setScalar(1.6 * (1 + ph * 2.6));
        ringMat.opacity = (1 - ph) * 0.55;
        if (light < this.lights.length) {
          const L = this.lights[light++];
          L.position.set(p.mv.pose.x, 3, p.mv.pose.z);
          L.intensity = 40 + 40 * Math.max(0, Math.sin(f * Math.PI * 2));
        }
      } else ring.visible = false;
    }
    for (let i = light; i < this.lights.length; i++) this.lights[i].intensity = 0;
  }

  // --- street racers ----------------------------------------------------------------------

  private stageRace() {
    const row = [-3, 0, 3][Math.floor(rand() * 3)];
    const east = rand() < 0.5;
    const strip = raceStrip(row, east);
    if (strip.length < 4) return;
    for (let i = 0; i + 1 < strip.length; i++) if (this.blocked.has(edgeKey(strip[i], strip[i + 1]))) return;
    const len = getEdge(strip[0], strip[1])!.length;
    const t = clamp(1 - (5.2 + 2.2 + 0.6) / len, 0.2, 0.9);
    const p: Pose = { x: 0, z: 0, h: 0 };
    poseAt(strip, 0, t, p);
    if (!this.isFree(p.x, p.z, 9)) return;
    // a ring tail so they blast off up the ramp and away
    const ringEnd = strip[strip.length - 1];
    const tail = ringEnd.startsWith("h_") ? this.ringTail(ringEnd, strip[strip.length - 2]) : [];
    const path = [...strip, ...tail];
    this.raceEnd = strip.length - 2;
    this.racers.forEach((r, i) => {
      r.mv.spawn(path.slice(), 0, t, 0, "racer");
      r.mv.lat = r.mv.latTarget = i === 1 ? OVERTAKE_LAT : 0;
      r.accel = between(6.2, 7.8);
      r.top = between(30, 35);
      r.manT = 0;
      r.smokeT = 0;
      r.mv.update(0);
    });
    this.race = "staging";
    this.raceSawRed = false;
    this.raceWait = 0;
  }

  private ringTail(ringNode: string, from: string): string[] {
    // continue a few nodes around the ring, away from where we came from
    const out: string[] = [];
    let prev = from;
    let cur = ringNode;
    for (let k = 0; k < 3; k++) {
      const next = neighbours(cur).find((n) => n.startsWith("h_") && n !== prev);
      if (!next) break;
      out.push(next);
      prev = cur;
      cur = next;
    }
    return out;
  }

  private stepRace(dt: number, now: number) {
    if (this.race === "idle") {
      if (!this.night) return;
      this.raceTimer -= dt;
      if (this.raceTimer <= 0) {
        this.raceTimer = between(...RACE_EVERY_S);
        this.stageRace();
      }
      return;
    }
    const glowOn = this.night;
    for (const r of this.racers) {
      if (!r.mv.active) continue;
      r.parts.glow!.visible = glowOn;
      r.parts.glowMat!.opacity = 0.75 + 0.25 * Math.sin(this.sim * 7 + r.accel);
    }

    if (this.race === "staging") {
      this.raceWait += dt;
      const a = this.racers[0].mv;
      const st = racerLaunch(this.raceSawRed, signalFor(a.path[1], a.path[0], now));
      this.raceSawRed = st.sawRed;
      for (const r of this.racers) {
        // revving: the body shakes
        r.parts.body.rotation.x = Math.sin(this.sim * 40 + r.accel) * 0.012;
        r.mv.update(0);
      }
      if (st.go || this.raceWait > 22) {
        this.race = "racing";
        for (const r of this.racers) r.smokeT = 1.1;
      }
      return;
    }

    // racing
    let anyActive = false;
    for (const [i, r] of this.racers.entries()) {
      const mv = r.mv;
      if (!mv.active) continue;
      anyActive = true;
      r.parts.body.rotation.x = 0;
      if (mv.idx + 2 >= mv.path.length && mv.t > 0.8) {
        mv.despawn();
        continue;
      }
      const finished = mv.idx >= this.raceEnd;
      let v0 = finished ? mv.limit * 1.15 : r.top;
      if (mv.idx + 2 < mv.path.length && turnKind(mv.from, mv.to, mv.path[mv.idx + 2]) !== 0) v0 = Math.min(v0, 8 + Math.max(0, mv.remaining - 6) * 0.6);
      // the one in the oncoming lane tucks in when something comes the other way, then goes again
      if (i === 1) {
        if (mv.latTarget !== 0 && (mv.oncoming(70) || finished)) {
          mv.latTarget = 0;
          r.manT = 0;
        } else if (mv.latTarget === 0 && !finished) {
          r.manT += dt;
          if (r.manT > 1.5 && !mv.oncoming(110) && straightAhead(mv.path, mv.idx, mv.t) > 60) mv.latTarget = OVERTAKE_LAT;
        }
      }
      // obey what's ahead in whichever lane it's in (the ray sees cross traffic too)
      const hit = this.probe(mv, mv.latTarget, 10 + mv.speed * 1.5);
      if (hit) v0 = Math.min(v0, this.safeSpeed(hit.gap, hit.speed, 3));
      this.accelerate(mv, Math.max(0, v0), dt, r.accel, BRAKE);
      mv.pitch = mv.speed < r.top * 0.6 && !finished ? -0.035 : 0; // nose up on launch
      mv.move(this.limitStep(mv, mv.speed * dt));
      mv.update(dt);
      if (r.smokeT > 0) {
        r.smokeT -= dt;
        const h = mv.pose.h;
        if (rand() < 0.6)
          this.sparks.emit(mv.object.position.x - Math.sin(h) * 2.3, 0.3, mv.object.position.z - Math.cos(h) * 2.3, between(-0.5, 0.5), 0.6, between(-0.5, 0.5), 1.6, 0.5, 0.8, 0.8, 0.82);
      }
    }
    if (!anyActive) this.race = "idle";
  }

  // --- speed cameras ----------------------------------------------------------------------

  private stepCameras(dt: number) {
    let dirty = false;
    for (const c of this.cams) {
      c.cool -= dt;
      if (c.flashT !== Infinity) c.flashT += dt;
    }
    for (const v of allVehicles()) {
      if (!v.edgeKey) continue;
      for (const c of this.cams) {
        if (v.edgeKey !== c.site.key) continue;
        if (c.cool > 0 && c.lastId === v.id) continue;
        if (c.cool > 0.6) continue;
        if (!speedingHit(c.site, v)) continue;
        c.cool = SITE_COOL_S;
        c.lastId = v.id;
        c.flashT = 0;
      }
    }
    const o = this.o;
    this.cams.forEach((c, i) => {
      // double flash: two quick pops
      const f = c.flashT;
      let k = 0;
      if (f < 0.09) k = 1 - f / 0.09;
      else if (f > 0.2 && f < 0.29) k = 1 - (f - 0.2) / 0.09;
      if (f > 0.3 && f !== Infinity) c.flashT = Infinity;
      if (k > 0 || f === 0) dirty = true;
      o.position.set(c.site.x, 3.9, c.site.z);
      o.rotation.set(0, 0, 0);
      o.scale.setScalar(k > 0 ? (this.night ? 3.6 : 2.4) * k : 0);
      o.updateMatrix();
      this.camFlash.setMatrixAt(i, o.matrix);
    });
    if (dirty || this.camsWereLit) this.camFlash.instanceMatrix.needsUpdate = true;
    this.camsWereLit = dirty;
  }
  private camsWereLit = false;
}
