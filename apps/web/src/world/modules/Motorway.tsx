"use client";
// Module: Motorway. Roadside furniture for the "M25" outer orbital (the road surface itself is drawn by Roads from
// districts/motorway.ts): lighting columns that glow at night, blue junction sign gantries, smart-motorway speed
// signs that show "40" in a red ring while any incident is on the motorway, SOS phones, marker posts, grass
// embankments with trees, the river viaduct on the west side, and a service area (fuel forecourt, food court,
// car park, lorry park). Placement logic lives in ./Motorway/layout.ts (unit tested).
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MW_JUNCTIONS } from "../districts/motorway";
import { useWorld } from "../store";
import {
  COLUMNS,
  JUNCTION_GANTRIES,
  LEG_OFFSET,
  MARKERS,
  PARKED_CARS,
  PARKED_LORRIES,
  SERVICES,
  SOS,
  TREES,
  VERGES,
  VIADUCT,
  VMS_GANTRIES,
  nightFactor,
  rng,
  type GantrySite,
  type Panel,
} from "./Motorway/layout";
import { atlasCell, junctionSignAtlas, servicesSignTexture, totemTexture, vmsTexture } from "./Motorway/textures";

// ---------------------------------------------------------------------------------------------------------
// helpers

const _o = new THREE.Object3D();
_o.rotation.order = "YZX";
function mat(x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1, roll = 0) {
  _o.position.set(x, y, z);
  _o.rotation.set(0, yaw, roll);
  _o.scale.set(sx, sy, sz);
  _o.updateMatrix();
  return _o.matrix.clone();
}

interface Item {
  m: THREE.Matrix4;
  c?: THREE.Color;
}

function Inst({
  geometry,
  material,
  items,
  cast = false,
  receive = false,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  items: Item[];
  cast?: boolean;
  receive?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      if (it.c) mesh.setColorAt(i, it.c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
  }, [items]);
  if (items.length === 0) return null;
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow={cast} receiveShadow={receive} />;
}

function std(color: string, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, ...extra });
}

const unitBox = () => new THREE.BoxGeometry(1, 1, 1);
const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;

/** A plane facing +z (rotated by panel.yaw), optionally showing a sub-rectangle of a texture. */
function panelGeometry(p: Panel, w: number, h: number, uv?: [number, number, number, number]) {
  const g = new THREE.PlaneGeometry(w, h);
  if (uv) {
    const a = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * (uv[2] - uv[0]), uv[1] + a.getY(i) * (uv[3] - uv[1]));
  }
  g.rotateY(p.yaw);
  g.translate(p.x, p.y, p.z);
  return g;
}

function isMotorwayKey(key: string) {
  return key.split("|").some((id) => id.startsWith("mw_"));
}
function motorwayIncident(s: ReturnType<typeof useWorld.getState>) {
  if (s.incidents.some((i) => i.status !== "cleared" && isMotorwayKey(i.edgeKey))) return true;
  return Object.keys(s.blocked).some(isMotorwayKey);
}

const SIGN_W = 6.4;
const SIGN_H = 3.2;
const VMS_S = 2.6;

// ---------------------------------------------------------------------------------------------------------

export default function Motorway() {
  const R = useMemo(() => {
    const atlas = junctionSignAtlas(MW_JUNCTIONS);
    const vmsOff = vmsTexture(false);
    const vmsOn = vmsTexture(true);
    const totemMap = totemTexture();
    const foodMap = servicesSignTexture("SERVICES  ·  FOOD COURT  ·  COFFEE  ·  WC");
    const kioskMap = servicesSignTexture("FUEL  ·  SHOP  ·  24 HRS", "#ff6a1a");
    const mats = {
      metal: std("#9aa3ab", { metalness: 0.5, roughness: 0.5 }),
      dark: std("#2a2f36", { roughness: 0.7 }),
      lampHead: std("#f3ead2", { emissive: new THREE.Color("#ffcf7a"), emissiveIntensity: 0.1 }),
      pool: new THREE.MeshBasicMaterial({
        color: "#ffcf8a",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }),
      sign: std("#ffffff", { map: atlas, emissiveMap: atlas, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.12, roughness: 0.5 }),
      vmsOff: std("#ffffff", { map: vmsOff, emissiveMap: vmsOff, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.2 }),
      vmsOn: std("#ffffff", { map: vmsOn, emissiveMap: vmsOn, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 1.6 }),
      lantern: std("#4a3a12", { emissive: new THREE.Color("#ffb020"), emissiveIntensity: 0 }),
      sos: std("#ff7a00", { roughness: 0.6 }),
      white: std("#f4f4f0"),
      blue: std("#1c4fa0"),
      grass: std("#ffffff", { flatShading: true, roughness: 0.95 }),
      trunk: std("#6b4a2f"),
      leaves: std("#ffffff", { flatShading: true }),
      concrete: std("#b3afa6", { roughness: 0.9 }),
      tarmac: std("#ffffff", { roughness: 0.95 }),
      canopy: std("#f6f6f2"),
      orange: std("#ff6a1a", { emissive: new THREE.Color("#ff6a1a"), emissiveIntensity: 0.15 }),
      canopyLight: std("#ffffff", { emissive: new THREE.Color("#fff6e0"), emissiveIntensity: 0.1 }),
      glass: std("#2a3d4f", { emissive: new THREE.Color("#ffd89a"), emissiveIntensity: 0, roughness: 0.25, metalness: 0.2 }),
      building: std("#d9d3c7"),
      roof: std("#59606a"),
      totem: std("#ffffff", { map: totemMap, emissiveMap: totemMap, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.1 }),
      foodSign: std("#ffffff", { map: foodMap, emissiveMap: foodMap, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.1 }),
      kioskSign: std("#ffffff", { map: kioskMap, emissiveMap: kioskMap, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.1 }),
      paint: std("#ffffff", { flatShading: true, roughness: 0.5, metalness: 0.2 }),
      cabin: std("#1d2733", { roughness: 0.3, metalness: 0.3 }),
    };
    const textures = [atlas, vmsOff, vmsOn, totemMap, foodMap, kioskMap];
    return { mats, textures };
  }, []);

  const G = useMemo(() => {
    const geos = {
      box: unitBox(),
      pole: merge([
        new THREE.CylinderGeometry(0.16, 0.26, 12, 6).translate(0, 6, 0),
        new THREE.BoxGeometry(0.18, 0.18, 8.8).translate(0, 12, 0),
      ]),
      heads: merge([
        new THREE.BoxGeometry(0.5, 0.22, 1.3).translate(0, 11.88, 4.2),
        new THREE.BoxGeometry(0.5, 0.22, 1.3).translate(0, 11.88, -4.2),
      ]),
      pool: new THREE.CircleGeometry(6.5, 20).rotateX(-Math.PI / 2),
      trunk: new THREE.CylinderGeometry(0.22, 0.32, 2.6, 5).translate(0, 1.3, 0),
      crown: new THREE.IcosahedronGeometry(2.4, 0).scale(1, 1.2, 1).translate(0, 4.3, 0),
      cone: new THREE.ConeGeometry(2, 6.5, 6).translate(0, 5, 0),
      pier: new THREE.CylinderGeometry(1, 1.2, 9, 8).translate(0, -4.5, 0),
    };

    // ----- lighting columns + night pools
    const poles: Item[] = [];
    const pools: Item[] = [];
    for (const c of COLUMNS) {
      const yaw = Math.atan2(c.rx, c.rz); // arm across the road
      poles.push({ m: mat(c.x, 0, c.z, yaw) });
      for (const s of [1, -1]) pools.push({ m: mat(c.x + c.rx * 3.4 * s, 0.075, c.z + c.rz * 3.4 * s) });
    }

    // ----- gantries (junction signs + speed signs)
    const metal: Item[] = [];
    const backs: Item[] = [];
    const gantry = (g: GantrySite) => {
      const yaw = Math.atan2(g.rx, g.rz);
      for (const s of [1, -1]) metal.push({ m: mat(g.x + g.rx * LEG_OFFSET * s, 4.6, g.z + g.rz * LEG_OFFSET * s, yaw, 0.55, 9.2, 0.55) });
      for (const y of [8.8, 6.0]) metal.push({ m: mat(g.x, y, g.z, yaw, 0.45, 0.45, LEG_OFFSET * 2 + 0.6) });
    };
    const signGeos: THREE.BufferGeometry[] = [];
    for (const g of JUNCTION_GANTRIES) {
      gantry(g);
      const cell = atlasCell(MW_JUNCTIONS.indexOf(g.junction!));
      for (const p of g.panels) {
        signGeos.push(panelGeometry(p, SIGN_W, SIGN_H, cell));
        backs.push({ m: mat(p.x - Math.sin(p.yaw) * 0.12, p.y, p.z - Math.cos(p.yaw) * 0.12, p.yaw, SIGN_W + 0.2, SIGN_H + 0.2, 0.18) });
      }
    }
    const vmsGeos: THREE.BufferGeometry[] = [];
    const lanterns: Item[] = [];
    for (const g of VMS_GANTRIES) {
      gantry(g);
      for (const p of g.panels) {
        vmsGeos.push(panelGeometry(p, VMS_S, VMS_S));
        const nx = Math.sin(p.yaw), nz = Math.cos(p.yaw);
        const ax = Math.cos(p.yaw), az = -Math.sin(p.yaw); // panel's local +x
        backs.push({ m: mat(p.x - nx * 0.12, p.y, p.z - nz * 0.12, p.yaw, VMS_S + 1.3, VMS_S + 0.9, 0.2) });
        for (const sx of [1, -1])
          for (const sy of [1, -1])
            lanterns.push({ m: mat(p.x + ax * sx * 1.75 + nx * 0.02, p.y + sy * 1.05, p.z + az * sx * 1.75 + nz * 0.02, p.yaw, 0.32, 0.32, 0.12) });
      }
    }

    // ----- roadside
    const sos = SOS.map((p) => ({ m: mat(p.x, 0.6, p.z, p.yaw, 0.55, 1.2, 0.4) }));
    const markerPosts = MARKERS.map((p) => ({ m: mat(p.x, 0.5, p.z, p.yaw, 0.12, 1.0, 0.1) }));
    const markerPlates = MARKERS.map((p) => ({ m: mat(p.x, 0.92, p.z, p.yaw, 0.16, 0.22, 0.12) }));
    const r = rng(41);
    const grassA = new THREE.Color("#6f9e4f"), grassB = new THREE.Color("#86ad57");
    const verges = VERGES.map((v) => ({
      m: mat(v.x, -0.18, v.z, v.yaw, 8.5, 1, v.len, v.side * 0.085),
      c: grassA.clone().lerp(grassB, r()),
    }));
    const leafPal = ["#3f7d3a", "#4f8f3f", "#5f9b45", "#6aa64c", "#3a6e3d", "#7aa84f"].map((c) => new THREE.Color(c));
    const trunks: Item[] = [];
    const crowns: Item[] = [];
    const cones: Item[] = [];
    for (const t of TREES) {
      const yaw = t.c * 6.28;
      trunks.push({ m: mat(t.x, 0, t.z, 0, t.s, t.s, t.s) });
      const c = leafPal[Math.floor(t.c * leafPal.length) % leafPal.length];
      (t.c < 0.28 ? cones : crowns).push({ m: mat(t.x, 0, t.z, yaw, t.s, t.s, t.s), c });
    }

    // ----- viaduct
    const deck: Item[] = [];
    const parapets: Item[] = [];
    const piers: Item[] = [];
    for (const s of VIADUCT) {
      const yaw = Math.atan2(s.dx, s.dz);
      const mx = (s.ax + s.bx) / 2, mz = (s.az + s.bz) / 2;
      deck.push({ m: mat(mx, -0.68, mz, yaw, 16.5, 1.42, s.len + 2) });
      for (const side of [1, -1]) {
        parapets.push({ m: mat(mx + s.rx * 8 * side, 0.5, mz + s.rz * 8 * side, yaw, 0.45, 1.1, s.len + 2) });
        piers.push({ m: mat(mx + s.rx * 5 * side, -1.3, mz + s.rz * 5 * side) });
      }
    }

    // ----- service area
    const S = SERVICES;
    const tarmacItems: Item[] = [];
    const tarmacCol = new THREE.Color("#3c4046");
    const rect = (b: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
      tarmacItems.push({ m: mat((b.minX + b.maxX) / 2, 0.012, (b.minZ + b.maxZ) / 2, 0, b.maxX - b.minX, 0.024, b.maxZ - b.minZ), c: tarmacCol });
    rect(S.carPark);
    rect(S.lorryPark);
    rect({ minX: S.canopy.x - S.canopy.w / 2 - 4, maxX: S.canopy.x + S.canopy.w / 2 + 4, minZ: 386, maxZ: S.canopy.z + S.canopy.d / 2 + 3 });
    // bay lines
    const lines: Item[] = [];
    for (let x = -741.7; x <= -652; x += 3.4) for (const z of [468.5, 487.5]) lines.push({ m: mat(x, 0.03, z, 0, 0.12, 0.02, 5) });
    for (let x = -779.75; x <= -688; x += 7.5) for (const z of [514, 543]) lines.push({ m: mat(x, 0.03, z, 0.35, 0.15, 0.02, 15) });

    const C = S.canopy;
    const canopyRoof = [{ m: mat(C.x, C.h + 0.45, C.z, 0, C.w, 0.9, C.d) }];
    const canopyBand = [
      { m: mat(C.x, C.h + 0.45, C.z + C.d / 2 + 0.06, 0, C.w + 0.1, 0.5, 0.12) },
      { m: mat(C.x, C.h + 0.45, C.z - C.d / 2 - 0.06, 0, C.w + 0.1, 0.5, 0.12) },
      { m: mat(C.x + C.w / 2 + 0.06, C.h + 0.45, C.z, 0, 0.12, 0.5, C.d + 0.1) },
      { m: mat(C.x - C.w / 2 - 0.06, C.h + 0.45, C.z, 0, 0.12, 0.5, C.d + 0.1) },
    ];
    const canopyLight = [{ m: mat(C.x, C.h - 0.02, C.z, 0, C.w - 2, 0.04, C.d - 2) }];
    const pillars: Item[] = [];
    for (const px of [-1, 1]) for (const pz of [-1, 1]) pillars.push({ m: mat(C.x + px * (C.w / 2 - 3), C.h / 2, C.z + pz * (C.d / 2 - 2.5), 0, 0.6, C.h, 0.6) });
    const islands = S.pumps.map((p) => ({ m: mat(p.x, 0.1, p.z, 0, 1.6, 0.2, 4) }));
    const pumps = S.pumps.flatMap((p) => [-1, 1].map((d) => ({ m: mat(p.x, 1.0, p.z + d * 1.1, 0, 0.8, 1.8, 0.6) })));
    const K = S.kiosk;
    const F = S.foodCourt;
    const buildings = [
      { m: mat(K.x, K.h / 2, K.z, 0, K.w, K.h, K.d) },
      { m: mat(F.x, F.h / 2, F.z, 0, F.w, F.h, F.d) },
      { m: mat(F.x + F.w / 2 - 5, F.h + 1.5, F.z, 0, 6, 3, 6) }, // plant room
      { m: mat(S.totem.x, 4, S.totem.z, 0, 2.2, 8, 0.6) },
    ];
    const roofs = [
      { m: mat(K.x, K.h + 0.2, K.z, 0, K.w + 1, 0.4, K.d + 1) },
      { m: mat(F.x, F.h + 0.25, F.z + 1.5, 0, F.w + 2, 0.5, F.d + 5) }, // overhang over the entrance
    ];
    const glass = [
      { m: mat(F.x, 2.9, F.z + F.d / 2 + 0.05, 0, F.w - 4, 4.4, 0.1) },
      { m: mat(K.x, 1.8, K.z + K.d / 2 + 0.05, 0, K.w - 3, 2.8, 0.1) },
    ];
    const signGeosS = [
      panelGeometry({ x: F.x, y: F.h - 1.2, z: F.z + F.d / 2 + 0.12, yaw: 0 }, 28, 1.9),
    ];
    const kioskSign = [panelGeometry({ x: K.x, y: K.h - 0.6, z: K.z + K.d / 2 + 0.12, yaw: 0 }, 14, 1.1)];
    const totemFaces = [
      panelGeometry({ x: S.totem.x, y: 4.2, z: S.totem.z + 0.32, yaw: 0 }, 2, 5),
      panelGeometry({ x: S.totem.x, y: 4.2, z: S.totem.z - 0.32, yaw: Math.PI }, 2, 5),
    ];

    // parked vehicles
    const carPal = ["#e6e6e2", "#2b2b2b", "#c0392b", "#2e6fb7", "#8a9199", "#1f3b5c", "#d4a017", "#ffffff"].map((c) => new THREE.Color(c));
    const rv = rng(12);
    const carBodies: Item[] = [];
    const carCabins: Item[] = [];
    for (const p of PARKED_CARS) {
      const c = carPal[Math.floor(rv() * carPal.length)];
      carBodies.push({ m: mat(p.x, 0.55, p.z, p.yaw, 1.8, 0.75, 4.2), c });
      carCabins.push({ m: mat(p.x, 1.2, p.z - Math.cos(p.yaw) * 0.2, p.yaw, 1.6, 0.6, 2.2) });
    }
    const lorryPal = ["#ffffff", "#ff6a1a", "#2e6fb7", "#c0392b", "#3f8f4f", "#e0b52c"].map((c) => new THREE.Color(c));
    const trailers: Item[] = [];
    const cabs: Item[] = [];
    for (const p of PARKED_LORRIES) {
      const sx = Math.sin(p.yaw), sz = Math.cos(p.yaw);
      trailers.push({ m: mat(p.x - sx * 1.5, 2.15, p.z - sz * 1.5, p.yaw, 2.5, 3.5, 12.5), c: lorryPal[Math.floor(rv() * lorryPal.length)] });
      cabs.push({ m: mat(p.x + sx * 6.3, 1.7, p.z + sz * 6.3, p.yaw, 2.5, 2.8, 2.4), c: lorryPal[Math.floor(rv() * lorryPal.length)] });
    }
    // night light pools in the service area
    for (const p of S.pumps) pools.push({ m: mat(p.x, 0.075, p.z) });
    for (let x = -735; x <= -660; x += 25) pools.push({ m: mat(x, 0.075, 478) });
    for (let x = -770; x <= -700; x += 30) pools.push({ m: mat(x, 0.075, 528) });

    const merged = {
      signs: signGeos.length ? merge(signGeos) : null,
      vms: vmsGeos.length ? merge(vmsGeos) : null,
      foodSign: merge(signGeosS),
      kioskSign: merge(kioskSign),
      totem: merge(totemFaces),
    };
    return {
      geos, merged,
      items: {
        poles, pools, metal, backs, lanterns, sos, markerPosts, markerPlates, verges, trunks, crowns, cones, deck, parapets,
        piers, tarmacItems, lines, canopyRoof, canopyBand, canopyLight, pillars, islands, pumps, buildings, roofs, glass,
        carBodies, carCabins, trailers, cabs,
      },
    };
  }, []);

  useEffect(
    () => () => {
      Object.values(G.geos).forEach((g) => g.dispose());
      Object.values(G.merged).forEach((g) => g?.dispose());
      Object.values(R.mats).forEach((m) => m.dispose());
      R.textures.forEach((t) => t.dispose());
    },
    [G, R],
  );

  const live = useRef(R); // materials are tweaked after render (night, VMS, lantern blink) through the ref

  // ----- night: update materials only when the light level changes
  useEffect(() => {
    const M = live.current.mats;
    let last = -1;
    const apply = (hour: number) => {
      const n = Math.round(nightFactor(hour) * 50) / 50;
      if (n === last) return;
      last = n;
      M.lampHead.emissiveIntensity = 0.1 + n * 2.6;
      M.pool.opacity = n * 0.3;
      M.pool.visible = n > 0;
      M.sign.emissiveIntensity = 0.12 + n * 0.35;
      M.canopyLight.emissiveIntensity = 0.1 + n * 1.8;
      M.glass.emissiveIntensity = n * 1.1;
      M.totem.emissiveIntensity = 0.1 + n * 0.8;
      M.foodSign.emissiveIntensity = 0.1 + n * 0.9;
      M.kioskSign.emissiveIntensity = 0.1 + n * 0.9;
      M.orange.emissiveIntensity = 0.15 + n * 0.8;
    };
    apply(useWorld.getState().timeOfDay);
    return useWorld.subscribe((s) => apply(s.timeOfDay));
  }, [R]);

  // ----- smart motorway: "40" + flashing lanterns while an incident is on the motorway
  const vmsRef = useRef<THREE.Mesh>(null);
  const active = useRef(false);
  useEffect(() => {
    const apply = (on: boolean) => {
      active.current = on;
      const M = live.current.mats;
      if (vmsRef.current) vmsRef.current.material = on ? M.vmsOn : M.vmsOff;
      if (!on) M.lantern.emissiveIntensity = 0;
    };
    apply(motorwayIncident(useWorld.getState()));
    return useWorld.subscribe((s, p) => {
      if (s.incidents === p.incidents && s.blocked === p.blocked) return;
      const on = motorwayIncident(s);
      if (on !== active.current) apply(on);
    });
  }, [R]);

  const flash = useRef(-1);
  useFrame(() => {
    if (!active.current || useWorld.getState().paused) return;
    const phase = Math.floor(performance.now() / 450) % 2;
    if (phase === flash.current) return;
    flash.current = phase;
    live.current.mats.lantern.emissiveIntensity = phase ? 3 : 0.2;
  });

  const M = R.mats;
  const I = G.items;
  const g = G.geos;
  return (
    <group name="Motorway">
      {/* lighting */}
      <Inst geometry={g.pole} material={M.metal} items={I.poles} />
      <Inst geometry={g.heads} material={M.lampHead} items={I.poles} />
      <Inst geometry={g.pool} material={M.pool} items={I.pools} />

      {/* gantries */}
      <Inst geometry={g.box} material={M.metal} items={I.metal} cast />
      <Inst geometry={g.box} material={M.dark} items={I.backs} />
      {G.merged.signs && <mesh geometry={G.merged.signs} material={M.sign} />}
      {G.merged.vms && <mesh ref={vmsRef} geometry={G.merged.vms} material={M.vmsOff} />}
      <Inst geometry={g.box} material={M.lantern} items={I.lanterns} />

      {/* roadside */}
      <Inst geometry={g.box} material={M.sos} items={I.sos} />
      <Inst geometry={g.box} material={M.white} items={I.markerPosts} />
      <Inst geometry={g.box} material={M.blue} items={I.markerPlates} />
      <Inst geometry={g.box} material={M.grass} items={I.verges} receive />
      <Inst geometry={g.trunk} material={M.trunk} items={I.trunks} />
      <Inst geometry={g.crown} material={M.leaves} items={I.crowns} />
      <Inst geometry={g.cone} material={M.leaves} items={I.cones} />

      {/* viaduct over the river */}
      <Inst geometry={g.box} material={M.concrete} items={I.deck} receive />
      <Inst geometry={g.box} material={M.concrete} items={I.parapets} />
      <Inst geometry={g.pier} material={M.concrete} items={I.piers} />

      {/* service area */}
      <Inst geometry={g.box} material={M.tarmac} items={I.tarmacItems} receive />
      <Inst geometry={g.box} material={M.white} items={I.lines} />
      <Inst geometry={g.box} material={M.canopy} items={I.canopyRoof} cast />
      <Inst geometry={g.box} material={M.orange} items={I.canopyBand} />
      <Inst geometry={g.box} material={M.canopyLight} items={I.canopyLight} />
      <Inst geometry={g.box} material={M.white} items={I.pillars} />
      <Inst geometry={g.box} material={M.concrete} items={I.islands} />
      <Inst geometry={g.box} material={M.orange} items={I.pumps} />
      <Inst geometry={g.box} material={M.building} items={I.buildings} cast receive />
      <Inst geometry={g.box} material={M.roof} items={I.roofs} />
      <Inst geometry={g.box} material={M.glass} items={I.glass} />
      <mesh geometry={G.merged.foodSign} material={M.foodSign} />
      <mesh geometry={G.merged.kioskSign} material={M.kioskSign} />
      <mesh geometry={G.merged.totem} material={M.totem} />
      <Inst geometry={g.box} material={M.paint} items={I.carBodies} />
      <Inst geometry={g.box} material={M.cabin} items={I.carCabins} />
      <Inst geometry={g.box} material={M.paint} items={I.trailers} cast />
      <Inst geometry={g.box} material={M.paint} items={I.cabs} />
    </group>
  );
}
