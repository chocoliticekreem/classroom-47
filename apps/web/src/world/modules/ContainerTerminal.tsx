"use client";
// Module: ContainerTerminal. The south-east container terminal (ZONES.containerTerminal): a gate complex with
// truck check-in lanes, a customs X-ray shed, a huge stacking yard served by three rail-mounted gantry cranes,
// reefer stacks with blinking power lights, straddle carriers and reach stackers, two ship-to-shore cranes
// working a second container ship, light masts, and the star: 12 container lorries on a loop. Each one checks
// in, parks under an RMG, gets a box lowered onto its skeletal trailer and drives out over the public road
// network to industry / the depot / air cargo / the lorry park / anywhere, drops it and comes back. A third of
// the drivers are maniacs (speeding, red-light running, overtaking, swerving); now and then one rolls a box over
// in a bend: incident + blocked road + spilled cargo, until responders clear it.
// Pure logic (yard, cranes, routes, drivers, wreck physics, the lorry sim) lives in ./ContainerTerminal/*.ts.
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { on } from "../bus";
import { CT_GATE_X } from "../districts/containerTerminal";
import { allVehicles } from "../registry";
import { useWorld } from "../store";
import {
  REACH,
  newReachState,
  reachAt,
  reachDefs,
  type ReachState,
} from "./ContainerTerminal/cranes";
import {
  barrierArmGeometry,
  cabGeometry,
  cableGeometry,
  hullGeometry,
  lampHeadGeometry,
  reachBodyGeometry,
  reachBoomGeometry,
  rmgFrameGeometry,
  rmgTrolleyGeometry,
  shipWindowGeometry,
  siteGeometry,
  spreaderXGeometry,
  straddleGeometry,
  stsBoomGeometry,
  spreaderLampGeometry,
  STS_HINGE_X,
  STS_BOOM_LEN,
  stsFrameGeometry,
  stsTrolleyGeometry,
  superstructureGeometry,
  trailerGeometry,
} from "./ContainerTerminal/geometry";
import {
  APRON_Y,
  CONTAINER,
  CT_LANE_Z,
  CUSTOMS,
  GATE,
  LIGHT_MASTS,
  RMG,
  RMG_COUNT,
  SHIP,
  SHIP_BAYS,
  SHIP_ROWS,
  STS,
  STS_CRANES,
  TINTS,
  TRAILER_BED_Y,
  nightFactor,
  rmgLegs,
  shipBayZ,
  shipBob,
  shipRoll,
  shipRowX,
  yardSpecs,
} from "./ContainerTerminal/layout";
import {
  blinkMaterial,
  containerAtlas,
  containerGeometry,
  containerMaterial,
  hazardTexture,
  hullNameTexture,
  signTexture,
  withBrandAttribute,
} from "./ContainerTerminal/textures";
import { CAB_COLORS, TruckSim, rigRoll } from "./ContainerTerminal/trucks";
import { STRADDLE_COUNT, STS_COUNT } from "./ContainerTerminal/quay";
import { ViewCheck } from "./DeliveryFleet/lookahead";
import { CARGO_PER_WRECK, rollPivotOffset } from "./ContainerTerminal/wreck";
import { MAX_TIER, instanceIndex, mulberry32 } from "./ContainerTerminal/yard";

const H = CONTAINER.h;
const TRUCKS = 12;
const MAX_WRECKS = 3;
const MOVERS = 72; // RMG 3 + STS 3 + reach 2 + straddles + apron + trucks + dropped 16
const M_RMG = 0;
const M_STS = 3;
const M_REACH = M_STS + STS_COUNT;
const M_STRAD = M_REACH + 2;
const M_PAD = M_STRAD + STRADDLE_COUNT;
const N_PAD = 12;
const M_TRUCK = M_PAD + N_PAD;
const M_DROP = M_TRUCK + TRUCKS + 2;
const BOOM_UP = 1.32; // radians the outreach boom swings up when the berth is idle
const CARGO_COLORS = ["#b98a56", "#a87943", "#c99b62", "#ff6a1a", "#e9e4d8", "#8d6a43"];
const GATES = CT_GATE_X.length;

// ---------- scratch (no per-frame allocation) ----------
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, "YXZ");
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function compose(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(pitch, yaw, roll, "YXZ");
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return _m.compose(_p, _q, _s);
}
function matrixOf(x: number, y: number, z: number, yaw = 0) {
  return compose(x, y, z, yaw).clone();
}

function std(color: string, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, ...extra });
}

/** Static instanced mesh filled once. */
function Static({
  geometry, material, matrices, colors, cast = false, receive = false,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrices: THREE.Matrix4[];
  colors?: THREE.Color[];
  cast?: boolean;
  receive?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    if (colors) colors.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices, colors]);
  if (!matrices.length) return null;
  return <instancedMesh ref={ref} args={[geometry, material, matrices.length]} castShadow={cast} receiveShadow={receive} />;
}

// Camera frustum check so off-screen lorries only raycast every 4th frame.
const view = new ViewCheck();

export default function ContainerTerminal() {
  // ---------------------------------------------------------------- resources
  const R = useMemo(() => {
    const atlas = containerAtlas();
    const boxMat = containerMaterial(atlas);
    const uTime = { value: 0 };
    const vc = std("#ffffff", { vertexColors: true, flatShading: true });
    const cabMat = std("#ffffff", { vertexColors: true, flatShading: true, roughness: 0.55, metalness: 0.15 });
    const cargoMat = std("#ffffff", { roughness: 0.9 });
    const steel = std("#59606a", { metalness: 0.4, roughness: 0.55 });
    const lamp = std("#fff4d6", { emissive: new THREE.Color("#ffd58a"), emissiveIntensity: 0.2 });
    const pool = new THREE.MeshBasicMaterial({
      color: "#ffcf8a", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const beaconRed = blinkMaterial("#ff3b2f", uTime, 0.9);
    const beaconAmber = blinkMaterial("#ffb020", uTime, 1.6);
    const reeferLed = blinkMaterial("#39ff7a", uTime, 0.55);
    const windows = std("#22303f", { emissive: new THREE.Color("#ffcf7a"), emissiveIntensity: 0, roughness: 0.3 });
    const hullLow = std("#9e2f28");
    const hullBoot = std("#f2f0ea");
    const hullTop = std("#24427f");
    const deck = std("#4a5a52");
    const nameMap = hullNameTexture("MAERLIN ENDURANCE");
    const hullName = std("#ffffff", { map: nameMap, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    const hazardMap = hazardTexture();
    hazardMap.repeat.set(4, 1);
    const hazard = std("#ffffff", { map: hazardMap });
    const signMaps = [
      signTexture("HAMYWAY CONTAINER TERMINAL", "#1f2e4a", "#ffffff", 2048, 128, "GATE IN  ·  LANES 1–4  ·  HAVE YOUR BOOKING REF READY"),
      signTexture("HM CUSTOMS · X-RAY", "#24427f", "#ffffff", 1024, 128),
      signTexture("OUT-GATE", "#ff6a1a", "#ffffff", 512, 128),
    ];
    const signMats = signMaps.map((m) => std("#ffffff", { map: m, emissiveMap: m, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.05 }));
    const disposables: { dispose(): void }[] = [
      atlas, boxMat, vc, cabMat, cargoMat, steel, lamp, pool, beaconRed, beaconAmber, reeferLed, windows, hullLow, hullBoot, hullTop,
      deck, nameMap, hullName, hazardMap, hazard, ...signMaps, ...signMats,
    ];
    return {
      boxMat, uTime, vc, cabMat, cargoMat, steel, lamp, pool, beaconRed, beaconAmber, reeferLed, windows, hullLow, hullBoot,
      hullTop, deck, hullName, hazard, signMats, disposables,
    };
  }, []);

  const specs = useMemo(() => yardSpecs(), []);
  const G = useMemo(() => {
    const base = containerGeometry();
    const g = {
      base,
      yardBox: withBrandAttribute(base, specs.length * MAX_TIER),
      moverBox: withBrandAttribute(base, MOVERS),
      shipBox: withBrandAttribute(base, SHIP_BAYS * SHIP_ROWS * 7),
      rmgFrame: rmgFrameGeometry(),
      rmgTrolley: rmgTrolleyGeometry(),
      spreader: spreaderXGeometry(),
      cable: cableGeometry(),
      stsFrame: stsFrameGeometry(),
      stsTrolley: stsTrolleyGeometry(),
      straddle: straddleGeometry(),
      stsBoom: stsBoomGeometry(),
      spreaderLamp: spreaderLampGeometry(),
      reachBody: reachBodyGeometry(),
      reachBoom: reachBoomGeometry(),
      cab: cabGeometry(),
      trailer: trailerGeometry(),
      cargo: new THREE.BoxGeometry(1, 1, 1),
      site: siteGeometry(),
      barrier: barrierArmGeometry(),
      lampHead: lampHeadGeometry(),
      pool: new THREE.CircleGeometry(16, 24).rotateX(-Math.PI / 2),
      beacon: new THREE.SphereGeometry(0.55, 8, 6),
      led: new THREE.BoxGeometry(0.12, 0.28, 0.28),
      hullLow: hullGeometry(SHIP.keelY, 0.45),
      hullBoot: hullGeometry(0.45, 0.85),
      hullTop: hullGeometry(0.85, SHIP.deckY),
      superstructure: superstructureGeometry(),
      shipWindows: shipWindowGeometry(),
      hullNameL: new THREE.PlaneGeometry(56, 3.6).rotateY(-Math.PI / 2).translate(-SHIP.beam / 2 - 0.06, 3.1, SHIP.zBow + 46),
      hullNameR: new THREE.PlaneGeometry(56, 3.6).rotateY(Math.PI / 2).translate(SHIP.beam / 2 + 0.06, 3.1, SHIP.zBow + 46),
      portal: new THREE.BoxGeometry(11.2, 0.5, 1.4),
      sign: new THREE.PlaneGeometry(1, 1),
    };
    return g;
  }, [specs]);

  useEffect(
    () => () => {
      for (const d of R.disposables) d.dispose();
      for (const g of Object.values(G)) if (g instanceof THREE.BufferGeometry) g.dispose();
    },
    [R, G],
  );

  // ---------------------------------------------------------------- static instance layouts
  const L = useMemo(() => {
    // ship deck containers (ship-local x)
    const ship: { m: THREE.Matrix4[]; c: THREE.Color[]; brand: number[] } = { m: [], c: [], brand: [] };
    const r = mulberry32(77);
    const col = new THREE.Color();
    for (let k = 0; k < SHIP_BAYS; k++)
      for (let i = 0; i < SHIP_ROWS; i++) {
        const sts = STS_CRANES.find((c) => c.bay === k);
        let n = 2 + Math.floor(r() * (i === 0 || i === SHIP_ROWS - 1 ? 2.5 : 4.6));
        if (sts && i === STS.slotRow) n = sts.shipStack;
        if (sts && (i === 1 || i === 7)) n = 2;
        for (let t = 0; t < n; t++) {
          ship.m.push(matrixOf(shipRowX(i) - SHIP.x, SHIP.deckY + t * H + H / 2, shipBayZ(k)));
          const p = r();
          const brand = p < 0.42 ? 2 : p < 0.5 ? 1 : p < 0.58 ? 3 : p < 0.64 ? 4 : 0;
          ship.brand.push(brand);
          ship.c.push(col.set(brand ? "#ffffff" : TINTS[Math.floor(r() * TINTS.length)]).clone());
        }
      }
    const stsFrames = STS_CRANES.map((c) => matrixOf(0, 0, c.z));
    const masts = LIGHT_MASTS.map(([x, z], i) => matrixOf(x, 0, z, (i * 0.9) % Math.PI));
    const pools = LIGHT_MASTS.map(([x, z]) => matrixOf(x, 0.1, z));
    // reefer power LEDs on the machinery end of every reefer box (static block)
    const leds: THREE.Matrix4[] = [];
    specs.forEach((s) => {
      if (!s.reefer) return;
      for (let t = 0; t < s.initial; t++) leds.push(matrixOf(s.x + CONTAINER.l / 2 + 0.07, APRON_Y + t * H + H * 0.72, s.z + 0.6));
    });
    const amber: THREE.Matrix4[] = [
      matrixOf(CUSTOMS.laneX - 5.4, 8.6, CUSTOMS.portalZ),
      matrixOf(CUSTOMS.laneX + 5.4, 8.6, CUSTOMS.portalZ),
      ...CT_GATE_X.map((x) => matrixOf(x + 5.5, GATE.booth.h + 0.75, GATE.barrierZ - 4)),
    ];
    return { ship, stsFrames, masts, pools, leds, amber };
  }, [specs]);

  // ship container brands go into the ship box geometry's attribute once
  useLayoutEffect(() => {
    const a = G.shipBox.getAttribute("aBrand") as THREE.InstancedBufferAttribute;
    L.ship.brand.forEach((b, i) => a.setX(i, b));
    a.needsUpdate = true;
  }, [G, L]);

  // ---------------------------------------------------------------- simulation (created on mount so StrictMode re-mounts stay clean)
  const simRef = useRef<TruckSim | null>(null);
  const yardFull = useRef(true);
  useEffect(() => {
    const sim = new TruckSim({ count: TRUCKS });
    sim.sees = view.sees;
    simRef.current = sim;
    yardFull.current = true;
    const off = on((e) => sim.onEvent(e));
    return () => {
      off();
      sim.dispose();
      simRef.current = null;
    };
  }, []);

  const reach = useMemo(() => reachDefs(), []);
  const S = useRef({
    t: 0,
    night: -1,
    colors: new Map<string, THREE.Color>(),
    reaches: reach.map(() => newReachState()) as ReachState[],
    barriers: new Array(GATES + 1).fill(0) as number[],
    angles: new Array(GATES + 1).fill(0) as number[],
    blockedObj: null as Record<string, string> | null,
    blocked: new Set<string>() as ReadonlySet<string>,
    tint: TINTS.map((c) => new THREE.Color(c)),
    white: new THREE.Color("#ffffff"),
    cargo: CARGO_COLORS.map((c) => new THREE.Color(c)),
    cabs: CAB_COLORS.map((c) => new THREE.Color(c)),
  });

  // ---------------------------------------------------------------- animated refs
  const yard = useRef<THREE.InstancedMesh>(null);
  const movers = useRef<THREE.InstancedMesh>(null);
  const rmgFrames = useRef<THREE.InstancedMesh>(null);
  const rmgTrolleys = useRef<THREE.InstancedMesh>(null);
  const stsTrolleys = useRef<THREE.InstancedMesh>(null);
  const stsFrames = useRef<THREE.InstancedMesh>(null);
  const stsBooms = useRef<THREE.InstancedMesh>(null);
  const spreaderLamps = useRef<THREE.InstancedMesh>(null);
  const spreaderPools = useRef<THREE.InstancedMesh>(null);
  const spreaders = useRef<THREE.InstancedMesh>(null);
  const cables = useRef<THREE.InstancedMesh>(null);
  const straddles = useRef<THREE.InstancedMesh>(null);
  const reachBodies = useRef<THREE.InstancedMesh>(null);
  const reachBooms = useRef<THREE.InstancedMesh>(null);
  const cabs = useRef<THREE.InstancedMesh>(null);
  const trailers = useRef<THREE.InstancedMesh>(null);
  const cargo = useRef<THREE.InstancedMesh>(null);
  const beacons = useRef<THREE.InstancedMesh>(null);
  const barriers = useRef<THREE.InstancedMesh>(null);
  const ship = useRef<THREE.Group>(null);

  const N_SPREAD = RMG_COUNT + STS_COUNT + reach.length;
  const N_CABLE = (RMG_COUNT + STS_COUNT) * 4;
  const N_BEACON = RMG_COUNT + STS_COUNT * 2;
  const N_LAMP = RMG_COUNT + STS_COUNT;

  const mats = useRef(R); // materials are tweaked per frame (time, night) through the ref
  useFrame(({ camera }, rawDt) => {
    const sim = simRef.current;
    const M = mats.current;
    view.update(camera);
    const st = S.current;
    const w = useWorld.getState();
    const dt = Math.min(rawDt, 0.1);
    const nowMs = performance.now();
    M.uTime.value = nowMs / 1000;
    if (!w.paused) st.t += dt;
    const t = st.t;

    // night lighting (materials touched only when it changes)
    const n = nightFactor(w.timeOfDay);
    if (Math.abs(n - st.night) > 0.01) {
      st.night = n;
      M.lamp.emissiveIntensity = 0.2 + n * 3.2;
      M.windows.emissiveIntensity = n * 1.6;
      M.pool.opacity = n * 0.22;
      M.pool.visible = n > 0.02;
      for (const m of M.signMats) m.emissiveIntensity = 0.05 + n * 0.75;
    }

    if (!sim) return;
    if (w.blocked !== st.blockedObj) {
      st.blockedObj = w.blocked;
      st.blocked = new Set(Object.keys(w.blocked));
    }
    if (!w.paused) sim.update(dt, nowMs, st.blocked);

    const boxColor = (brand: number, tint: number, color?: string) => {
      if (brand) return st.white;
      if (!color) return st.tint[tint % st.tint.length];
      let c = st.colors.get(color);
      if (!c) st.colors.set(color, (c = new THREE.Color(color)));
      return c;
    };
    // ---- yard stacks (only the stacks that changed)
    const ym = yard.current;
    if (ym) {
      const brandAttr = G.yardBox.getAttribute("aBrand") as THREE.InstancedBufferAttribute;
      const ids: Iterable<number> = yardFull.current ? sim.yard.stacks.map((s) => s.id) : sim.yard.dirty;
      let any = false;
      for (const id of ids) {
        const s = sim.yard.stacks[id];
        for (let tier = 0; tier < MAX_TIER; tier++) {
          const k = instanceIndex(id, tier);
          const b = s.tiers[tier];
          if (!b) {
            ym.setMatrixAt(k, ZERO);
            continue;
          }
          ym.setMatrixAt(k, compose(s.x, APRON_Y + tier * H + H / 2, s.z, Math.PI / 2));
          ym.setColorAt(k, boxColor(b.brand, b.tint, b.color));
          brandAttr.setX(k, b.brand);
        }
        any = true;
      }
      sim.yard.dirty.clear();
      if (any) {
        ym.instanceMatrix.needsUpdate = true;
        if (ym.instanceColor) ym.instanceColor.needsUpdate = true;
        brandAttr.needsUpdate = true;
        yardFull.current = false;
      }
    }

    const mv = movers.current;
    const moverBrand = G.moverBox.getAttribute("aBrand") as THREE.InstancedBufferAttribute;
    const setBox = (
      i: number, x: number, y: number, z: number, yaw: number, brand: number, tint: number, roll = 0, pitch = 0, scale = 1, color?: string,
    ) => {
      if (!mv) return;
      mv.setMatrixAt(i, compose(x, y, z, yaw, pitch, roll, scale, scale, scale));
      mv.setColorAt(i, boxColor(brand, tint, color));
      moverBrand.setX(i, brand);
    };
    const hideBox = (i: number) => mv?.setMatrixAt(i, ZERO);

    // ---- RMG cranes
    const fr = rmgFrames.current;
    const tr = rmgTrolleys.current;
    const sp = spreaders.current;
    const cb = cables.current;
    const bc = beacons.current;
    for (let k = 0; k < RMG_COUNT; k++) {
      const m = sim.rmgs[k];
      const p = m.pose;
      const lz = CT_LANE_Z[k];
      fr?.setMatrixAt(k, compose(p.gx, 0, lz));
      tr?.setMatrixAt(k, compose(p.gx, RMG.girderY + 2.2, p.tz));
      const hang = RMG.girderY - p.sy;
      const sx = p.gx + Math.sin(p.sway) * hang;
      sp?.setMatrixAt(k, compose(sx, p.sy, p.tz, 0, 0, p.sway));
      let c = 0;
      const clen = Math.max(0.1, RMG.girderY + 1.0 - (p.sy + 1.2));
      for (const ox of [-1.2, 1.2])
        for (const oz of [-0.9, 0.9]) cb?.setMatrixAt(k * 4 + c++, compose(sx + ox, p.sy + 1.2, p.tz + oz, 0, 0, p.sway, 1, clen, 1));
      const j = m.job;
      if (j && p.carrying && j.box) setBox(M_RMG + k, sx, p.sy - H / 2, p.tz, Math.PI / 2, j.box.brand, j.box.tint, p.sway);
      else hideBox(M_RMG + k);
      const [za] = rmgLegs(k);
      bc?.setMatrixAt(k, compose(p.gx, RMG.girderY + 5, za - 0.5));
      spreaderLamps.current?.setMatrixAt(k, compose(sx, p.sy, p.tz));
      spreaderPools.current?.setMatrixAt(k, compose(sx, 0.12, p.tz, 0, 0, 0, 0.45, 1, 0.45));
    }

    // ---- STS cranes working the berthed ship, straddle carriers, apron boxes
    const q = sim.quay;
    const sts = stsTrolleys.current;
    const sf = stsFrames.current;
    const sb = stsBooms.current;
    const sd = straddles.current;
    const sl = spreaderLamps.current;
    const spool = spreaderPools.current;
    const by = STS.boomY + 1.1;
    q.cranes.forEach((c, i) => {
      sf?.setMatrixAt(i, compose(0, 0, c.z));
      const ang = BOOM_UP * (c.boom * c.boom * (3 - 2 * c.boom));
      sb?.setMatrixAt(i, compose(STS_HINGE_X, by, c.z, 0, 0, ang));
      sts?.setMatrixAt(i, compose(c.trolleyX, 0, c.z));
      const si = RMG_COUNT + i;
      const hang = STS.boomY - 1.6 - c.spreaderY;
      const sx = c.trolleyX + Math.sin(c.sway) * hang;
      sp?.setMatrixAt(si, compose(sx, c.spreaderY, c.z, Math.PI / 2, 0, c.sway));
      const len = Math.max(0.1, STS.boomY - 2.4 - c.spreaderY);
      let k = 0;
      for (const ox of [-0.8, 0.8])
        for (const oz of [-1.2, 1.2]) cb?.setMatrixAt(si * 4 + k++, compose(sx + ox, c.spreaderY + 1.2, c.z + oz, 0, 0, c.sway, 1, len, 1));
      sl?.setMatrixAt(si, compose(sx, c.spreaderY, c.z, Math.PI / 2));
      spool?.setMatrixAt(si, compose(sx, 0.12, c.z, 0, 0, 0, 0.45, 1, 0.45));
      const box = q.carried(c);
      if (box) setBox(M_STS + i, sx, c.spreaderY - H / 2, c.z, 0, box.brand, box.tint, c.sway, 0, 1, box.color);
      else hideBox(M_STS + i);
      // beacons: boom tip (follows the boom) and the A-frame apex
      const tipX = STS_HINGE_X + Math.cos(ang) * STS_BOOM_LEN;
      const tipY = by + Math.sin(ang) * STS_BOOM_LEN + 2.4;
      bc?.setMatrixAt(RMG_COUNT + i * 2, compose(tipX, tipY, c.z));
      bc?.setMatrixAt(RMG_COUNT + i * 2 + 1, compose((STS.legX[0] + STS.legX[1]) / 2, 51.5, c.z));
    });
    q.straddles.forEach((u, i) => {
      sd?.setMatrixAt(i, compose(u.x, APRON_Y, u.z, u.h));
      if (u.box) setBox(M_STRAD + i, u.x, u.lift + H / 2, u.z, u.h, u.box.brand, u.box.tint, 0, 0, 1, u.box.color);
      else hideBox(M_STRAD + i);
    });
    for (let k = 0; k < N_PAD; k++) {
      const p = q.pads[k];
      if (p) setBox(M_PAD + k, p.x, 0.03 + p.tier * H + H / 2, p.z, 0, p.box.brand, p.box.tint, 0, 0, 1, p.box.color);
      else hideBox(M_PAD + k);
    }

    // ---- reach stackers
    const rb = reachBodies.current;
    const rm = reachBooms.current;
    reach.forEach((d, i) => {
      const o = reachAt(t, d, st.reaches[i]);
      rb?.setMatrixAt(i, compose(o.x, 0, o.z, o.h));
      const px = o.x - Math.sin(o.h) * REACH.pivotBack;
      const pz = o.z - Math.cos(o.h) * REACH.pivotBack;
      rm?.setMatrixAt(i, compose(px, REACH.pivotY, pz, o.h, -o.boomAngle, 0, 1, 1, o.boomLen));
      const tipY = REACH.pivotY + Math.sin(o.boomAngle) * o.boomLen;
      const sy = tipY - 1.5;
      const sx = px + Math.sin(o.h) * Math.cos(o.boomAngle) * o.boomLen;
      const sz = pz + Math.cos(o.h) * Math.cos(o.boomAngle) * o.boomLen;
      sp?.setMatrixAt(RMG_COUNT + STS_CRANES.length + i, compose(sx, sy, sz, o.h + Math.PI / 2));
      setBox(M_REACH + i, o.boxX, o.boxY + H / 2, o.boxZ, o.boxH, i === 0 ? 4 : 0, 2 + i * 5);
    });

    // ---- lorries
    const cm = cabs.current;
    const tm = trailers.current;
    const cg = cargo.current;
    let wrecks = 0;
    sim.trucks.forEach((tk, i) => {
      if (!tk || tk.phase === "gone") {
        cm?.setMatrixAt(i, ZERO);
        tm?.setMatrixAt(i, ZERO);
        hideBox(M_TRUCK + i);
        return;
      }
      const sc = tk.fade;
      const roll = rigRoll(tk);
      const wr = tk.wreck;
      if (wr) {
        const [ox, oy] = rollPivotOffset(roll, 1.25);
        const cx = wr.x + ox * Math.cos(wr.h);
        const cz = wr.z - ox * Math.sin(wr.h);
        cm?.setMatrixAt(i, compose(cx, oy, cz, wr.h, 0, roll, sc, sc, sc));
        tm?.setMatrixAt(i, compose(cx, oy, cz, wr.h, 0, roll, sc, sc, sc));
        if (tk.box) setBox(M_TRUCK + i, wr.bx, wr.by, wr.bz, wr.bh, tk.box.brand, tk.box.tint, wr.broll, 0, sc);
        else hideBox(M_TRUCK + i);
        if (cg && tk.box && wrecks < MAX_WRECKS) {
          const base = wrecks * CARGO_PER_WRECK;
          for (let c = 0; c < CARGO_PER_WRECK; c++) {
            const cbx = wr.cargo[c];
            if (!cbx) {
              cg.setMatrixAt(base + c, ZERO);
              continue;
            }
            cg.setMatrixAt(base + c, compose(cbx.x, cbx.y, cbx.z, cbx.ry, cbx.rx, 0, cbx.s * sc, cbx.s * 0.8 * sc, cbx.s * 1.1 * sc));
            cg.setColorAt(base + c, st.cargo[cbx.color % st.cargo.length]);
          }
          wrecks++;
        }
        return;
      }
      cm?.setMatrixAt(i, compose(tk.cab.x, 0, tk.cab.z, tk.cab.h, 0, roll));
      tm?.setMatrixAt(i, compose(tk.trailer.x, 0, tk.trailer.z, tk.trailer.h, 0, roll * 0.6));
      if (tk.box) {
        const lift = (1 - tk.boxLock) * 0.35;
        setBox(M_TRUCK + i, tk.boxPose.x, TRAILER_BED_Y + H / 2 + lift, tk.boxPose.z, tk.trailer.h, tk.box.brand, tk.box.tint, tk.sway);
      } else hideBox(M_TRUCK + i);
      cm?.setColorAt(i, st.cabs[tk.color % st.cabs.length]);
    });
    if (cg) {
      for (let k = wrecks * CARGO_PER_WRECK; k < MAX_WRECKS * CARGO_PER_WRECK; k++) cg.setMatrixAt(k, ZERO);
      cg.instanceMatrix.needsUpdate = true;
      if (cg.instanceColor) cg.instanceColor.needsUpdate = true;
    }
    // dropped boxes at destinations
    for (let k = 0; k < 16; k++) {
      const d = sim.dropped[k];
      if (d) setBox(M_DROP + k, d.x, H / 2 + 0.02, d.z, d.h, d.box.brand, d.box.tint);
      else hideBox(M_DROP + k);
    }

    // ---- barriers: up while a vehicle rolls through (or a lorry has just been checked in)
    const want = st.barriers;
    for (let k = 0; k <= GATES; k++) want[k] = 0;
    for (const v of allVehicles()) {
      const vx = v.object.position.x;
      const vz = v.object.position.z;
      if (vz > 104 && vz < 134) {
        for (let k = 0; k < GATES; k++) if (Math.abs(vx - (CT_GATE_X[k] + 2)) < 2.4 && (v.speed > 0.4 || vz > GATE.barrierZ - 3)) want[k] = 1;
      } else if (Math.abs(vz - 334) < 2.6 && vx > GATE.outGate.x - 14 && vx < GATE.outGate.x + 6 && v.speed > 0.3) want[GATES] = 1;
    }
    for (const tk of sim.trucks) if (tk && tk.phase === "checkin" && tk.timer < 1.1) want[tk.gate] = 1;
    const bm = barriers.current;
    for (let k = 0; k <= GATES; k++) {
      const cur = st.angles[k];
      const next = cur + Math.max(-dt * 1.6, Math.min(dt * 1.6, (want[k] ? 1.35 : 0) - cur));
      st.angles[k] = next;
      if (!bm) continue;
      if (k < GATES) bm.setMatrixAt(k, compose(CT_GATE_X[k] + 4.6, 1.25, GATE.barrierZ, 0, 0, -next));
      else bm.setMatrixAt(k, compose(GATE.outGate.x, 1.25, GATE.outGate.z + 2.6, Math.PI / 2, 0, -next));
    }
    if (bm) bm.instanceMatrix.needsUpdate = true;

    // ---- ship
    if (ship.current) {
      ship.current.position.y = shipBob(t);
      ship.current.rotation.z = shipRoll(t);
    }

    for (const m of [fr, tr, sts, sf, sb, sl, spool, sp, cb, sd, rb, rm, cm, tm, bc]) if (m) m.instanceMatrix.needsUpdate = true;
    if (cm?.instanceColor) cm.instanceColor.needsUpdate = true;
    if (mv) {
      mv.instanceMatrix.needsUpdate = true;
      if (mv.instanceColor) mv.instanceColor.needsUpdate = true;
      moverBrand.needsUpdate = true;
    }
  });

  // initial colours / hidden slots so nothing renders at the origin before the first frame
  useLayoutEffect(() => {
    const hideAll = (m: THREE.InstancedMesh | null, color?: THREE.Color) => {
      if (!m) return;
      for (let i = 0; i < m.count; i++) {
        m.setMatrixAt(i, ZERO);
        if (color) m.setColorAt(i, color);
      }
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    const white = new THREE.Color("#ffffff");
    hideAll(yard.current, white);
    hideAll(movers.current, white);
    hideAll(cabs.current, white);
    hideAll(cargo.current, white);
    hideAll(trailers.current);
    hideAll(barriers.current);
    for (const m of [stsFrames.current, stsBooms.current, stsTrolleys.current, straddles.current, spreaderLamps.current, spreaderPools.current]) hideAll(m);
    // these meshes move anywhere in the zone; give them a zone-sized bound and let culling work
    const zoneSphere = new THREE.Sphere(new THREE.Vector3(290, 10, 220), 160);
    for (const m of [yard.current, rmgFrames.current, rmgTrolleys.current, stsTrolleys.current, straddles.current, reachBodies.current, reachBooms.current, barriers.current, beacons.current])
      if (m) m.boundingSphere = zoneSphere.clone();
  }, []);

  const C = CUSTOMS;
  return (
    <group name="container-terminal">
      {/* static site: rails, gate canopy + booths, customs shed + portal, fences, reefer racks, mast poles */}
      <mesh geometry={G.site} material={R.vc} castShadow receiveShadow />
      <mesh geometry={G.portal} material={R.hazard} position={[C.laneX, 6.6, C.portalZ + 0.01]} />
      <mesh geometry={G.sign} material={R.signMats[0]} position={[(GATE.canopyX[0] + GATE.canopyX[1]) / 2, GATE.canopyY + 0.2, GATE.canopyZ[0] - 0.24]} rotation={[0, Math.PI, 0]} scale={[GATE.canopyX[1] - GATE.canopyX[0] - 1, 1.1, 1]} />
      <mesh geometry={G.sign} material={R.signMats[1]} position={[(C.x0 + C.x1) / 2, C.h - 0.8, C.z1 + 0.66]} scale={[C.x1 - C.x0, 0.95, 1]} />
      <mesh geometry={G.sign} material={R.signMats[2]} position={[GATE.outGate.x, 3.0, GATE.outGate.z + 1.25]} scale={[1.6, 0.4, 1]} />
      <Static geometry={G.beacon} material={R.beaconAmber} matrices={L.amber} />

      {/* the yard: one instance slot per stack tier (hidden when empty) */}
      <instancedMesh ref={yard} args={[G.yardBox, R.boxMat, specs.length * MAX_TIER]} castShadow receiveShadow />
      <Static geometry={G.led} material={R.reeferLed} matrices={L.leds} />
      {/* boxes on the move: cranes, straddles, reach stackers, lorries, drops */}
      <instancedMesh ref={movers} args={[G.moverBox, R.boxMat, MOVERS]} frustumCulled={false} castShadow />

      {/* RMG cranes */}
      <instancedMesh ref={rmgFrames} args={[G.rmgFrame, R.vc, RMG_COUNT]} castShadow />
      <instancedMesh ref={rmgTrolleys} args={[G.rmgTrolley, R.vc, RMG_COUNT]} />
      <instancedMesh ref={spreaders} args={[G.spreader, R.vc, N_SPREAD]} frustumCulled={false} castShadow />
      <instancedMesh ref={cables} args={[G.cable, R.steel, N_CABLE]} frustumCulled={false} />
      <instancedMesh ref={beacons} args={[G.beacon, R.beaconRed, N_BEACON]} />

      {/* STS cranes, straddle carriers, reach stackers */}
      <instancedMesh ref={stsFrames} args={[G.stsFrame, R.vc, STS_COUNT]} frustumCulled={false} castShadow />
      <instancedMesh ref={stsBooms} args={[G.stsBoom, R.vc, STS_COUNT]} frustumCulled={false} castShadow />
      <instancedMesh ref={stsTrolleys} args={[G.stsTrolley, R.vc, STS_COUNT]} frustumCulled={false} />
      <instancedMesh ref={straddles} args={[G.straddle, R.vc, STRADDLE_COUNT]} frustumCulled={false} castShadow />
      <instancedMesh ref={spreaderLamps} args={[G.spreaderLamp, R.lamp, N_LAMP]} frustumCulled={false} />
      <instancedMesh ref={spreaderPools} args={[G.pool, R.pool, N_LAMP]} frustumCulled={false} />
      <instancedMesh ref={reachBodies} args={[G.reachBody, R.vc, reach.length]} castShadow />
      <instancedMesh ref={reachBooms} args={[G.reachBoom, R.vc, reach.length]} />

      {/* lorries */}
      <instancedMesh ref={cabs} args={[G.cab, R.cabMat, TRUCKS]} frustumCulled={false} castShadow />
      <instancedMesh ref={trailers} args={[G.trailer, R.vc, TRUCKS]} frustumCulled={false} castShadow />
      <instancedMesh ref={cargo} args={[G.cargo, R.cargoMat, MAX_WRECKS * CARGO_PER_WRECK]} frustumCulled={false} castShadow />
      <instancedMesh ref={barriers} args={[G.barrier, R.vc, GATES + 1]} />

      {/* light masts */}
      <Static geometry={G.lampHead} material={R.lamp} matrices={L.masts} />
      <Static geometry={G.pool} material={R.pool} matrices={L.pools} />

      {/* ship hull + deck cargo are drawn by the Shipping module (berths.ts BERTHS.terminal) */}
    </group>
  );
}
