"use client";
// Module: Shipping. The port's sea traffic: six named container ships (feeder, panamax, neo-panamax and a 24k TEU
// megamax) sail in from the horizon, wait at the anchorage, pick up a pilot, are met by tugs, turned and pushed
// alongside the Docks and ContainerTerminal quays, moored, worked by the crane modules (berths.ts contract: we
// write phase/pose/deck, they move boxes and set craneDone), unmoored, pulled off and sent back out to sea.
// Pure logic lives in ./Shipping/{harbour,lanes,tugs,deck,fleet}.ts (unit tested); geometry/effects are three.js.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { BERTHS, type BerthId, type DeckSlot } from "../berths";
import { WATER_X } from "../config";
import { useWorld } from "../store";
import { fillDeck } from "./Shipping/deck";
import { Foam, Puffs } from "./Shipping/effects";
import {
  BRANDS,
  CONTRACT_BAYS,
  CONTRACT_ROWS,
  CONTRACT_TIERS,
  HATCH_TOP,
  TIER_H,
  bayZ,
  brandIndex,
  rowX,
  type ShipLayout,
} from "./Shipping/fleet";
import {
  ATLAS_TILES,
  containerAtlas,
  containerGeometry,
  containerMaterial,
  decalGeometry,
  decalTexture,
  deckY,
  pilotGeometry,
  pontoonGeometry,
  shipGeometry,
  tugGeometry,
  windowGeometry,
} from "./Shipping/geometry";
import { Harbour, type Vessel } from "./Shipping/harbour";
import { TUG_BASE } from "./Shipping/lanes";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const MAX_LINES = 48;
const MAX_LIGHTS = 80;
const SEA_Y = -0.25;

function nightFactor(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 19 || h <= 5.5) return 1;
  if (h >= 17) return (h - 17) / 2;
  if (h < 7) return 1 - (h - 5.5) / 1.5;
  return 0;
}

interface DecoBox {
  m: THREE.Matrix4;
  c: THREE.Color;
  tile: number;
}

interface ShipView {
  v: Vessel;
  group: THREE.Group;
  boxes: THREE.InstancedMesh;
  tiles: THREE.InstancedBufferAttribute;
  deco: DecoBox[];
  snapSrc: DeckSlot[] | null;
  snapColor: (string | null)[];
  snapBrand: (string | undefined)[];
  lastHorn: number;
  /** emitter accumulators */
  eStern: number;
  eBow: number;
  eSmoke: number;
  /** ship-local light + emitter points */
  funnelTop: THREE.Vector3;
  whistle: THREE.Vector3;
  lights: { p: THREE.Vector3; c: THREE.Color }[];
  fairleads: { p: THREE.Vector3; dz: number }[];
  disposables: { dispose(): void }[];
}

const _m = new THREE.Matrix4();
const _tm = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, "YXZ");
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _col = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const SMOKE = new THREE.Color("#3a3c40");
const TUG_SMOKE = new THREE.Color("#26272a");
const STEAM = new THREE.Color("#f4f6f8");
const WHITE_L = new THREE.Color(3, 3, 2.7);
const RED_L = new THREE.Color(3.2, 0.25, 0.2);
const GREEN_L = new THREE.Color(0.25, 3.2, 0.6);

let rngState = 12345;
function jitter() {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296 - 0.5;
}

function lightsFor(L: ShipLayout): { p: THREE.Vector3; c: THREE.Color }[] {
  const fz = L.half - 14;
  const wz = L.house.z1 - 3.6;
  return [
    { p: new THREE.Vector3(0, deckY(L, fz) + 13.4, fz), c: WHITE_L }, // masthead
    { p: new THREE.Vector3(0, L.bridgeY + 10.6, wz - 1.5), c: WHITE_L }, // main mast
    { p: new THREE.Vector3(L.beam / 2 + 1.25, L.bridgeY + 1.6, wz), c: RED_L }, // port
    { p: new THREE.Vector3(-L.beam / 2 - 1.25, L.bridgeY + 1.6, wz), c: GREEN_L }, // starboard
    { p: new THREE.Vector3(0, deckY(L, -L.half) + 1.8, -L.half + 0.6), c: WHITE_L }, // stern
  ];
}

function fairleadsFor(L: ShipLayout) {
  // landward side when moored bow-north is ship-local +x (port). dz = where the line lands on the quay,
  // relative to the fairlead, in world z (bow is north = -z).
  const x = L.beam / 2 - 0.8;
  const pts: [number, number][] = [
    [L.half - 6, -24], [L.half - 9, -14], [L.half - 22, -3], [L.half * 0.42, 30],
    [-L.half * 0.42, -30], [-L.half + 20, 3], [-L.half + 7, 14], [-L.half + 4, 24],
  ];
  return pts.map(([z, dz]) => ({ p: new THREE.Vector3(x, deckY(L, z) + 0.9, z), dz }));
}

function buildShip(v: Vessel, shipMat: THREE.Material, windowMat: THREE.Material, boxMat: THREE.Material, boxGeo: THREE.BufferGeometry): ShipView {
  const L = v.layout;
  const liv = v.spec.livery;
  const group = new THREE.Group();
  group.name = `ship-${v.spec.name}`;
  group.rotation.order = "YXZ";
  const hullGeo = shipGeometry(v.cls, L, liv);
  const hull = new THREE.Mesh(hullGeo, shipMat);
  hull.castShadow = true;
  hull.receiveShadow = true;
  const winGeo = windowGeometry(v.cls, L);
  const win = new THREE.Mesh(winGeo, windowMat);
  const decalTex = decalTexture(v.spec.name, liv.brand, liv.text);
  const decalMat = new THREE.MeshStandardMaterial({ map: decalTex, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
  const decalGeo = decalGeometry(L, liv.brand.length);
  const decal = new THREE.Mesh(decalGeo, decalMat);
  decal.renderOrder = 1;
  // decorative (non-crane) bays: a static, seeded, nearly full stow
  const deco: DecoBox[] = [];
  if (L.decoBays.length) {
    const tiers = v.cls.decoTiers;
    const d = fillDeck(v.i * 97 + 11, { rows: CONTRACT_ROWS, bays: L.decoBays.length, tiers, min: 0.8, max: 0.95, homeBrand: v.spec.homeBrand });
    L.decoBays.forEach((z, bay) => {
      for (let row = 0; row < CONTRACT_ROWS; row++)
        for (let t = 0; t < tiers; t++) {
          const s = d[(bay * CONTRACT_ROWS + row) * tiers + t];
          if (!s.color) continue;
          deco.push({
            m: new THREE.Matrix4().makeTranslation(rowX(row), HATCH_TOP + 1.3 + t * TIER_H, z),
            c: new THREE.Color(s.color),
            tile: brandIndex(s.brand),
          });
        }
    });
  }
  const cap = CONTRACT_ROWS * CONTRACT_BAYS * CONTRACT_TIERS + deco.length;
  const geo = boxGeo.clone();
  const tiles = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
  tiles.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("aTile", tiles);
  const boxes = new THREE.InstancedMesh(geo, boxMat, cap);
  boxes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  boxes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  boxes.castShadow = true;
  boxes.receiveShadow = true;
  boxes.count = 0;
  group.add(hull, win, decal, boxes);
  const fTop = Math.max(L.bridgeY + 6.5, (L.funnel.onHouse ? 4.6 : 12.6) + 10);
  const fz = (L.funnel.z0 + L.funnel.z1) / 2 - (fTop - 4.6) * 0.12;
  return {
    v, group, boxes, tiles, deco, snapSrc: null,
    snapColor: new Array(CONTRACT_ROWS * CONTRACT_BAYS * CONTRACT_TIERS).fill(undefined),
    snapBrand: new Array(CONTRACT_ROWS * CONTRACT_BAYS * CONTRACT_TIERS).fill(undefined),
    lastHorn: v.hornAt, eStern: 0, eBow: 0, eSmoke: jitter() + 0.5,
    funnelTop: new THREE.Vector3(0, fTop + 0.5, fz),
    whistle: new THREE.Vector3(0, fTop - 1.2, L.funnel.z1 + 0.6 - (fTop - 5.6) * 0.12),
    lights: lightsFor(L),
    fairleads: fairleadsFor(L),
    disposables: [hullGeo, winGeo, decalTex, decalMat, decalGeo, geo, boxes],
  };
}

/** Rebuild a ship's deck instances if the deck grid changed (cranes take/put boxes). */
function syncDeck(sv: ShipView, deck: DeckSlot[]) {
  let dirty = sv.snapSrc !== deck;
  if (!dirty) {
    for (let i = 0; i < deck.length; i++) {
      const s = deck[i];
      if (s.color !== sv.snapColor[i] || s.brand !== sv.snapBrand[i]) {
        dirty = true;
        break;
      }
    }
  }
  if (!dirty) return;
  sv.snapSrc = deck;
  const mesh = sv.boxes;
  const tiles = sv.tiles.array as Float32Array;
  let n = 0;
  for (let bay = 0; bay < CONTRACT_BAYS; bay++)
    for (let row = 0; row < CONTRACT_ROWS; row++)
      for (let t = 0; t < CONTRACT_TIERS; t++) {
        const i = (bay * CONTRACT_ROWS + row) * CONTRACT_TIERS + t;
        const s = deck[i];
        sv.snapColor[i] = s?.color ?? null;
        sv.snapBrand[i] = s?.brand;
        if (!s?.color) continue;
        _m.makeTranslation(rowX(row), HATCH_TOP + 1.3 + t * TIER_H, bayZ(bay));
        mesh.setMatrixAt(n, _m);
        mesh.setColorAt(n, _col.set(s.color));
        tiles[n] = brandIndex(s.brand) % ATLAS_TILES;
        n++;
      }
  for (const d of sv.deco) {
    mesh.setMatrixAt(n, d.m);
    mesh.setColorAt(n, d.c);
    tiles[n] = d.tile;
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  sv.tiles.needsUpdate = true;
  mesh.computeBoundingSphere();
}

function lineMatrix(a: THREE.Vector3, b: THREE.Vector3) {
  _p.copy(b).sub(a);
  const len = Math.max(0.01, _p.length());
  _q.setFromUnitVectors(UP, _p.multiplyScalar(1 / len));
  _a.copy(a).add(b).multiplyScalar(0.5);
  _s.set(1, len, 1);
  return _m.compose(_a, _q, _s);
}

export default function Shipping() {
  const built = useMemo(() => {
    const harbour = new Harbour(7, 0); // phase timestamps are rebased onto performance.now() at mount
    const root = new THREE.Group();
    root.name = "shipping";
    const shipMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.72, metalness: 0.08 });
    const windowMat = new THREE.MeshStandardMaterial({ color: "#1d2733", emissive: new THREE.Color("#ffd08a"), emissiveIntensity: 0, roughness: 0.25, metalness: 0.2 });
    const atlas = containerAtlas(BRANDS.map((b) => b.name));
    const boxMat = containerMaterial(atlas);
    const boxGeo = containerGeometry();
    const ships = harbour.vessels.map((v) => buildShip(v, shipMat, windowMat, boxMat, boxGeo));
    for (const s of ships) root.add(s.group);

    const tugGeo = tugGeometry();
    const pilotGeo = pilotGeometry();
    const tugIdx = harbour.boats.map((_, i) => i).filter((i) => harbour.boats[i].kind === "tug");
    const pilotIdx = harbour.boats.map((_, i) => i).filter((i) => harbour.boats[i].kind === "pilot");
    const tugs = new THREE.InstancedMesh(tugGeo, shipMat, tugIdx.length);
    const pilots = new THREE.InstancedMesh(pilotGeo, shipMat, pilotIdx.length);
    for (const m of [tugs, pilots]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = true;
      root.add(m);
    }

    const ropeGeo = new THREE.CylinderGeometry(0.13, 0.13, 1, 5);
    const ropeMat = new THREE.MeshStandardMaterial({ color: "#3a3024", roughness: 0.9 });
    const lines = new THREE.InstancedMesh(ropeGeo, ropeMat, MAX_LINES);
    lines.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    lines.frustumCulled = false;
    lines.count = 0;
    root.add(lines);

    const lampGeo = new THREE.SphereGeometry(0.5, 8, 6);
    const lampMat = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false, fog: false });
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, MAX_LIGHTS);
    lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    lamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LIGHTS * 3), 3);
    lamps.frustumCulled = false;
    lamps.count = 0;
    root.add(lamps);

    const pontoonParts = [
      ...pontoonGeometry(TUG_BASE.docks[0], TUG_BASE.docks[1], WATER_X),
      ...pontoonGeometry(TUG_BASE.terminal[0], TUG_BASE.terminal[1], WATER_X),
    ];
    const pontoonGeo = mergeGeometries(pontoonParts, false)!;
    for (const p of pontoonParts) p.dispose();
    const pontoons = new THREE.Mesh(pontoonGeo, shipMat);
    pontoons.receiveShadow = true;
    root.add(pontoons);

    const foam = new Foam(1800, SEA_Y + 0.07);
    const puffs = new Puffs(900);
    root.add(foam.mesh, puffs.mesh);

    const disposables: { dispose(): void }[] = [
      shipMat, windowMat, atlas, boxMat, boxGeo, tugGeo, pilotGeo, tugs, pilots, ropeGeo, ropeMat, lines, lampGeo, lampMat,
      lamps, pontoonGeo, foam, puffs, ...ships.flatMap((s) => s.disposables),
    ];
    return {
      harbour, root, ships, tugs, pilots, tugIdx, pilotIdx, lines, lamps, foam, puffs, windowMat, disposables,
      night: -1, eBoat: harbour.boats.map(() => ({ wash: 0, smoke: jitter() + 0.5, bow: 0 })),
    };
  }, []);

  // per-frame state is mutated through a ref (never during render)
  const ref = useRef(built);

  useEffect(() => {
    const S = built;
    const h = S.harbour;
    h.rebaseClock(performance.now());
    const api = {
      berths: BERTHS,
      harbour: h,
      forceArrival: (b: BerthId) => h.forceArrival(b, performance.now()),
      forceDeparture: (b: BerthId) => h.forceDeparture(b, performance.now()),
      status: () =>
        h.vessels.map((v) => ({ name: v.spec.name, cls: v.cls.id, state: v.state, berth: v.berth, x: Math.round(v.x), z: Math.round(v.z) })),
    };
    (window as unknown as { __cityShips?: typeof api }).__cityShips = api;
    return () => {
      const w = window as unknown as { __cityShips?: typeof api };
      if (w.__cityShips === api) delete w.__cityShips;
      for (const d of S.disposables) d.dispose();
    };
  }, [built]);

  useFrame((_, rawDelta) => {
    const S = ref.current;
    const w = useWorld.getState();
    const dt = w.paused ? 0 : Math.min(rawDelta, 0.1);
    const h = S.harbour;
    const now = performance.now();
    if (dt > 0) h.step(dt, now);
    const T = h.time;
    S.foam.mat.uniforms.uTime.value = T;
    S.puffs.mat.uniforms.uTime.value = T;

    // night lighting, on change only
    const n = nightFactor(w.timeOfDay);
    if (Math.abs(n - S.night) > 0.01) {
      S.night = n;
      S.windowMat.emissiveIntensity = n * 1.9;
    }
    const lampScale = n > 0.03 ? 0.7 + 0.9 * n : 0;
    let li = 0;
    let ln = 0;

    // ---- ships
    for (const sv of S.ships) {
      const v = sv.v;
      const g = sv.group;
      g.visible = v.state !== "offstage";
      if (!g.visible) continue;
      g.position.set(v.x, v.bob, v.z);
      g.rotation.set(v.pitch, v.heading, v.roll);
      g.updateMatrix();
      g.matrixWorld.copy(g.matrix);
      syncDeck(sv, h.deckOf(v));

      // lights
      if (lampScale > 0) {
        for (const L of sv.lights) {
          if (li >= MAX_LIGHTS) break;
          _a.copy(L.p).applyMatrix4(g.matrixWorld);
          _s.setScalar(lampScale);
          S.lamps.setMatrixAt(li, _m.compose(_a, _q.identity(), _s));
          S.lamps.setColorAt(li, L.c);
          li++;
        }
      }

      // mooring lines (alongside), extending to / retracting from the quay bollards
      if (v.lines > 0.001 && h.isOwner(v)) {
        for (const f of sv.fairleads) {
          if (ln >= MAX_LINES) break;
          _a.copy(f.p).applyMatrix4(g.matrixWorld);
          _b.set(WATER_X - 0.6, 0.9, _a.z + f.dz);
          _b.lerpVectors(_a, _b, v.lines);
          S.lines.setMatrixAt(ln++, lineMatrix(_a, _b));
        }
      }

      if (dt <= 0) continue;
      const speed = Math.hypot(v.vx, v.vz);
      const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
      const L = v.layout;
      // wakes: turbulent stern wash, kelvin arms from the bow shoulders, bow cushion
      if (speed > 0.35) {
        sv.eStern += dt;
        const every = Math.max(0.09, 2.4 / speed);
        if (sv.eStern > every) {
          sv.eStern = 0;
          const sx = v.x - sh * (L.half - 3), sz = v.z - ch * (L.half - 3);
          S.foam.emit(sx + jitter() * 4, sz + jitter() * 4, T, 24 + speed, -sh, -ch, 0.5, L.beam * (0.32 + speed * 0.03), 1.3, 0.62);
          for (const side of [1, -1]) {
            // bow shoulder, spreading outward and astern
            const bx = v.x + sh * (L.half - 16) + ch * side * L.beam * 0.5;
            const bz = v.z + ch * (L.half - 16) - sh * side * L.beam * 0.5;
            const dx = ch * side * 0.62 - sh * 0.78, dz = -sh * side * 0.62 - ch * 0.78;
            S.foam.emit(bx, bz, T, 18, dx, dz, 0.9 + speed * 0.14, 3 + speed * 0.25, 0.8, 0.55);
          }
          if (speed > 1.5) S.foam.emit(v.x + sh * (L.half + 1), v.z + ch * (L.half + 1), T, 3.5, sh, ch, speed * 0.3, 5 + speed * 0.4, 1.6, 0.75);
        }
      }
      // funnel smoke; horn blast of steam
      sv.eSmoke += dt;
      const smokeEvery = speed > 1 ? 0.28 : 0.6;
      if (sv.eSmoke > smokeEvery) {
        sv.eSmoke = 0;
        _a.copy(sv.funnelTop).applyMatrix4(g.matrixWorld);
        S.puffs.emit(_a.x + jitter(), _a.y, _a.z + jitter(), T, v.vx * 0.6, 2.4 + speed * 0.1, v.vz * 0.6, speed > 1 ? 11 : 8, SMOKE, speed > 1 ? 2 : 1.4);
      }
      if (v.hornAt !== sv.lastHorn) {
        sv.lastHorn = v.hornAt;
        _a.copy(sv.whistle).applyMatrix4(g.matrixWorld);
        for (let k = 0; k < 18; k++) {
          S.puffs.emit(_a.x + jitter() * 0.6, _a.y, _a.z + jitter() * 0.6, T + k * 0.04, jitter() * 1.5 + sh * 2, 6 + k * 0.35 + jitter() * 2, jitter() * 1.5 + ch * 2, 3.2 + jitter(), STEAM, 1.1 + k * 0.03);
        }
      }
    }

    // ---- tugs + pilot boats
    const boats = h.boats;
    const setBoat = (mesh: THREE.InstancedMesh, k: number, i: number) => {
      const b = boats[i];
      const bob = Math.sin(T * 0.9 + i * 1.3) * 0.18;
      const roll = Math.sin(T * 0.7 + i) * 0.03 * (b.locked ? 0.5 : 1);
      const pitch = -Math.min(0.05, b.speed * 0.004) + Math.sin(T * 0.8 + i * 2) * 0.01;
      _e.set(pitch, b.heading, roll);
      _q.setFromEuler(_e);
      _p.set(b.x, SEA_Y + 0.3 + bob, b.z);
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(k, _m);
      return _m;
    };
    S.tugIdx.forEach((i, k) => {
      const b = boats[i];
      const mw = _tm.copy(setBoat(S.tugs, k, i));
      const sh = Math.sin(b.heading), ch = Math.cos(b.heading);
      // towline from the towing hook to the ship
      if (b.line && b.vessel >= 0 && ln < MAX_LINES) {
        const sv = S.ships[b.vessel];
        _a.set(0, 3.6, -12.3).applyMatrix4(mw);
        _b.set(b.line[0], deckY(sv.v.layout, b.line[1]) + 1, b.line[1]).applyMatrix4(sv.group.matrixWorld);
        S.lines.setMatrixAt(ln++, lineMatrix(_a, _b));
      }
      if (lampScale > 0 && li + 3 <= MAX_LIGHTS) {
        for (const [lx, ly, lz, c] of [[0, 12.2, 3, WHITE_L], [3.9, 7, 3, RED_L], [-3.9, 7, 3, GREEN_L]] as const) {
          _a.set(lx, ly, lz).applyMatrix4(mw);
          _s.setScalar(lampScale * 0.7);
          S.lamps.setMatrixAt(li, _m.compose(_a, _q.identity(), _s));
          S.lamps.setColorAt(li, c);
          li++;
        }
      }
      if (dt <= 0) return;
      const E = S.eBoat[i];
      // prop wash when working hard (pushing / pulling), bow wave + wake when running
      E.wash += dt;
      if (b.effort > 0.55 && E.wash > 0.11) {
        E.wash = 0;
        S.foam.emit(b.x - sh * 15 + jitter() * 2, b.z - ch * 15 + jitter() * 2, T, 4.5, -sh, -ch, 3.5 * b.effort, 2.6, 1, 0.8);
      }
      if (b.speed > 1.2) {
        E.bow += dt;
        if (E.bow > Math.max(0.08, 1.6 / b.speed)) {
          E.bow = 0;
          for (const side of [1, -1]) {
            const dx = ch * side * 0.7 - sh * 0.7, dz = -sh * side * 0.7 - ch * 0.7;
            S.foam.emit(b.x + sh * 11 + ch * side * 3.5, b.z + ch * 11 - sh * side * 3.5, T, 8, dx, dz, 1.2 + b.speed * 0.12, 1.6 + b.speed * 0.1, 0.8, 0.6);
          }
          S.foam.emit(b.x - sh * 14, b.z - ch * 14, T, 12, -sh, -ch, 0.4, 3 + b.speed * 0.15, 1.2, 0.6);
        }
      }
      E.smoke += dt;
      const every = 0.32 / (0.35 + b.effort);
      if (E.smoke > every) {
        E.smoke = 0;
        for (const sx of [1.8, -1.8]) {
          _a.set(sx, 9.8, -1.6).applyMatrix4(mw);
          S.puffs.emit(_a.x, _a.y, _a.z, T, sh * b.speed * 0.5, 2.5 + 3.5 * b.effort, ch * b.speed * 0.5, 5 + 2 * b.effort, TUG_SMOKE, 0.55 + 0.6 * b.effort);
        }
      }
    });
    S.pilotIdx.forEach((i, k) => {
      const b = boats[i];
      setBoat(S.pilots, k, i);
      if (dt <= 0 || b.speed < 2) return;
      const E = S.eBoat[i];
      const sh = Math.sin(b.heading), ch = Math.cos(b.heading);
      E.bow += dt;
      if (E.bow > 0.1) {
        E.bow = 0;
        for (const side of [1, -1]) {
          const dx = ch * side * 0.75 - sh * 0.66, dz = -sh * side * 0.75 - ch * 0.66;
          S.foam.emit(b.x + sh * 5 + ch * side * 2, b.z + ch * 5 - sh * side * 2, T, 7, dx, dz, 1.5, 1.4, 0.8, 0.6);
        }
        S.foam.emit(b.x - sh * 9, b.z - ch * 9, T, 9, -sh, -ch, 0.6, 2.4, 1.2, 0.7);
      }
    });

    S.tugs.instanceMatrix.needsUpdate = true;
    S.pilots.instanceMatrix.needsUpdate = true;
    S.lines.count = ln;
    if (ln) S.lines.instanceMatrix.needsUpdate = true;
    S.lamps.count = li;
    if (li) {
      S.lamps.instanceMatrix.needsUpdate = true;
      if (S.lamps.instanceColor) S.lamps.instanceColor.needsUpdate = true;
    }
    S.foam.flush();
    S.puffs.flush();
  });

  return <primitive object={built.root} />;
}
