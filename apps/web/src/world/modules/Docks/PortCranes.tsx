"use client";
// Docks: the working container operation at berth "docks". Renders the three STS cranes (hinged
// booms, trolleys, spreaders, hoist ropes), the two quay straddle carriers, every box in motion or
// in the quay buffer blocks, lashing crews, spreader / boom / quay lights. Simulation: ./portOps.ts.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { BERTHS } from "../../berths";
import { WATER_X } from "../../config";
import { useWorld } from "../../store";
import { spreaderGeometry, straddleGeometry, trolleyGeometry } from "./geometry";
import {
  APEX,
  BOOM_LEN,
  BOOM_RAISED,
  BOOM_Y,
  HINGE_X,
  boomGeometry,
  coneGeometry,
  craneFixedGeometry,
  crewBodyGeometry,
  crewVestGeometry,
  quayLampGeometry,
  quayPostGeometry,
  spreaderLampGeometry,
} from "./craneGeometry";
import { CRANE_BOOM_Y, nightFactor } from "./layout";
import {
  APRON_Y,
  BLOCK_COLS,
  BLOCK_Z,
  BOX_H,
  DECK_Y,
  HOME_X,
  createPortOps,
  stepPortOps,
  type Box,
  type PortOps,
} from "./portOps";
import { BRANDS } from "./textures";

export interface PortCranesProps {
  containerGeo: THREE.BufferGeometry;
  genericMat: THREE.Material;
  brandMats: THREE.Material[];
  vc: THREE.Material;
  lamp: THREE.Material;
  red: THREE.Material;
  steel: THREE.Material;
}

const N = 3; // cranes
const MAX_BOXES = 48;
const QUAY_POSTS = Array.from({ length: 8 }, (_, i) => -73.5 + i * 21);
const TROLLEY_Y = CRANE_BOOM_Y - 1.6; // trolley underside, where the hoist ropes start

// scratch (no per-frame allocation)
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _d = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
function setM(x: number, y: number, z: number, yaw = 0, rz = 0, sy = 1) {
  _e.set(0, yaw, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(1, sy, 1);
  return _m.compose(_p, _q, _s);
}
/** Unit (base-at-origin, +y) beam from a to b. */
function beamM(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  _d.set(bx - ax, by - ay, bz - az);
  const len = _d.length();
  _q.setFromUnitVectors(_up, _d.multiplyScalar(1 / len));
  _p.set(ax, ay, az);
  _s.set(1, len, 1);
  return _m.compose(_p, _q, _s);
}

const BRAND_INDEX = new Map(BRANDS.map((b, i) => [b.name, i]));

export default function PortCranes(props: PortCranesProps) {
  const { containerGeo, genericMat, brandMats, vc, lamp, red, steel } = props;

  const G = useMemo(
    () => ({
      fixed: craneFixedGeometry(),
      boom: boomGeometry(),
      trolley: trolleyGeometry(),
      spreader: spreaderGeometry(),
      spreaderLamp: spreaderLampGeometry(),
      rope: new THREE.BoxGeometry(0.1, 1, 0.1).translate(0, 0.5, 0),
      stay: new THREE.BoxGeometry(0.3, 1, 0.3).translate(0, 0.5, 0),
      flood: new THREE.BoxGeometry(1.2, 0.5, 1.2),
      beacon: new THREE.SphereGeometry(0.6, 8, 6),
      carrier: straddleGeometry().scale(1, 1.5, 1),
      cone: coneGeometry(5),
      crewBody: crewBodyGeometry(),
      crewVest: crewVestGeometry(),
      post: quayPostGeometry(),
      postLamp: quayLampGeometry(),
      pool: new THREE.CircleGeometry(8, 20).rotateX(-Math.PI / 2),
    }),
    [],
  );
  const M = useMemo(
    () => ({
      vest: new THREE.MeshStandardMaterial({
        color: "#c8f02a", roughness: 0.6, emissive: new THREE.Color("#d6ff3a"), emissiveIntensity: 0.15,
      }),
      cone: new THREE.MeshBasicMaterial({
        color: "#fff1c9", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }),
      pool: new THREE.MeshBasicMaterial({
        color: "#ffd9a0", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const g of Object.values(G)) g.dispose();
      for (const m of Object.values(M)) m.dispose();
    },
    [G, M],
  );

  const sim = useRef<{ ops: PortOps; night: number; t: number; mats: typeof M }>({
    ops: createPortOps(),
    night: -1,
    t: 0,
    mats: M,
  });

  const fixed = useRef<THREE.InstancedMesh>(null);
  const boom = useRef<THREE.InstancedMesh>(null);
  const stays = useRef<THREE.InstancedMesh>(null);
  const floods = useRef<THREE.InstancedMesh>(null);
  const beacons = useRef<THREE.InstancedMesh>(null);
  const trolleys = useRef<THREE.InstancedMesh>(null);
  const spreaders = useRef<THREE.InstancedMesh>(null);
  const sLamps = useRef<THREE.InstancedMesh>(null);
  const ropes = useRef<THREE.InstancedMesh>(null);
  const cones = useRef<THREE.InstancedMesh>(null);
  const carriers = useRef<THREE.InstancedMesh>(null);
  const cSpreaders = useRef<THREE.InstancedMesh>(null);
  const generic = useRef<THREE.InstancedMesh>(null);
  const brands = useRef<(THREE.InstancedMesh | null)[]>([]);
  const crewB = useRef<THREE.InstancedMesh>(null);
  const crewV = useRef<THREE.InstancedMesh>(null);
  const posts = useRef<THREE.InstancedMesh>(null);
  const postLamps = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);

  // static quay lights
  useEffect(() => {
    const ps = posts.current, ls = postLamps.current, pl = pools.current;
    if (!ps || !ls || !pl) return;
    QUAY_POSTS.forEach((z, i) => {
      ps.setMatrixAt(i, setM(WATER_X - 0.3, 0, z));
      ls.setMatrixAt(i, setM(WATER_X - 0.3, 0, z));
      pl.setMatrixAt(i, setM(WATER_X - 3.5, 0.09, z));
    });
    for (const m of [ps, ls, pl]) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
    // create the colour buffer up front so the generic box material compiles with instance colours
    generic.current?.setColorAt(0, _c.set("#ffffff"));
  }, []);

  useFrame((_, delta) => {
    const S = sim.current;
    const w = useWorld.getState();
    const b = BERTHS.docks;
    const dt = Math.min(delta, 0.1);
    if (!w.paused) {
      S.t += dt;
      stepPortOps(S.ops, b, dt);
    }
    const ops = S.ops;
    const t = S.t;

    const n = nightFactor(w.timeOfDay);
    if (Math.abs(n - S.night) > 0.01) {
      S.night = n;
      S.mats.vest.emissiveIntensity = 0.15 + n * 1.4;
      S.mats.cone.opacity = n * 0.07;
      S.mats.cone.visible = n > 0.02;
      S.mats.pool.opacity = n * 0.2;
      S.mats.pool.visible = n > 0.02;
    }

    const fx = fixed.current, bm = boom.current, st = stays.current, fl = floods.current, bc = beacons.current;
    const tr = trolleys.current, sp = spreaders.current, sl = sLamps.current, rp = ropes.current, cn = cones.current;
    if (!fx || !bm || !st || !fl || !bc || !tr || !sp || !sl || !rp || !cn) return;

    // ---- boxes: write into the generic (tinted) or brand mesh ----
    const gm = generic.current;
    const bms = brands.current;
    if (!gm) return;
    let gi = 0;
    const bi = [0, 0, 0, 0];
    const putBox = (box: Box, x: number, y: number, z: number, yaw = 0, rz = 0) => {
      const k = box.brand ? BRAND_INDEX.get(box.brand) : undefined;
      const mesh = k !== undefined ? bms[k] : null;
      if (mesh && bi[k!] < MAX_BOXES) {
        mesh.setMatrixAt(bi[k!]++, setM(x, y, z, yaw, rz));
      } else if (gi < MAX_BOXES) {
        gm.setMatrixAt(gi, setM(x, y, z, yaw, rz));
        gm.setColorAt(gi++, _c.set(box.color));
      }
    };

    ops.cranes.forEach((c, i) => {
      const a = c.boom * BOOM_RAISED;
      const ca = Math.cos(a), sa = Math.sin(a);
      fx.setMatrixAt(i, setM(0, 0, c.z));
      bm.setMatrixAt(i, setM(HINGE_X, BOOM_Y, c.z, 0, a));
      // stays from the apex to the boom (tip + mid), both sides
      let si = i * 4;
      for (const lx of [BOOM_LEN - 1, 17.4])
        for (const sz of [-1, 1]) {
          const bx = HINGE_X + lx * ca - 1 * sa, by = BOOM_Y + lx * sa + 1 * ca;
          st.setMatrixAt(si++, beamM(APEX[0], APEX[1], c.z + sz * 1.2, bx, by, c.z + sz * 1.7));
        }
      // floods: three under the boom, two under the backreach
      let fi = i * 5;
      for (const lx of [10, 25, 40]) fl.setMatrixAt(fi++, setM(HINGE_X + lx * ca + 1.35 * sa, BOOM_Y + lx * sa - 1.35 * ca, c.z, 0, a));
      fl.setMatrixAt(fi++, setM(314, CRANE_BOOM_Y - 0.25, c.z));
      fl.setMatrixAt(fi++, setM(HOME_X, CRANE_BOOM_Y - 0.25, c.z));
      bc.setMatrixAt(i * 2, setM(HINGE_X + BOOM_LEN * ca - 2 * sa, BOOM_Y + BOOM_LEN * sa + 2 * ca, c.z));
      bc.setMatrixAt(i * 2 + 1, setM(APEX[0], APEX[1] + 1.6, c.z));

      tr.setMatrixAt(i, setM(c.trolleyX, 0, c.z));
      const hang = TROLLEY_Y - c.spreaderY;
      const sx = c.trolleyX + Math.sin(c.sway) * hang;
      sp.setMatrixAt(i, setM(sx, c.spreaderY, c.z, 0, c.sway));
      sl.setMatrixAt(i, setM(sx, c.spreaderY, c.z, 0, c.sway));
      const len = Math.max(0.1, hang - 1.6);
      let k = i * 4;
      for (const ox of [-0.8, 0.8]) for (const oz of [-1.2, 1.2]) rp.setMatrixAt(k++, setM(sx + ox, c.spreaderY + 1.6, c.z + oz, 0, c.sway, len));
      const coneLen = Math.max(0.1, Math.min(c.spreaderY - (c.box ? BOX_H : 0), 26));
      cn.setMatrixAt(i, setM(sx, c.spreaderY - (c.box ? BOX_H : 0), c.z, 0, 0, coneLen));
      if (c.box) putBox(c.box, sx, c.spreaderY - BOX_H / 2, c.z, 0, c.sway);
      if (c.spot.box) putBox(c.spot.box, HOME_X, APRON_Y + BOX_H / 2, c.spot.z);
    });

    // straddle carriers + their spreaders + carried boxes
    const cr = carriers.current, cs = cSpreaders.current;
    if (cr && cs) {
      ops.carriers.forEach((k, i) => {
        cr.setMatrixAt(i, setM(k.x, APRON_Y, k.z, k.yaw));
        cs.setMatrixAt(i, setM(k.x, k.boxY + BOX_H, k.z, k.yaw));
        if (k.box) putBox(k.box, k.x, k.boxY + BOX_H / 2, k.z, k.yaw);
      });
      cr.instanceMatrix.needsUpdate = true;
      cs.instanceMatrix.needsUpdate = true;
    }
    // quay buffer blocks
    for (const side of [-1, 1] as const)
      ops.blocks[side].forEach((col, ci) =>
        col.forEach((box, tier) => putBox(box, BLOCK_COLS[ci], APRON_Y + tier * BOX_H + BOX_H / 2, side * BLOCK_Z)),
      );

    gm.count = gi;
    gm.instanceMatrix.needsUpdate = true;
    if (gm.instanceColor) gm.instanceColor.needsUpdate = true;
    bms.forEach((m, k) => {
      if (!m) return;
      m.count = bi[k];
      m.instanceMatrix.needsUpdate = true;
    });

    // lashing crews: two on the ship (between bays, walking across) + one on the quay per working crane
    const cb = crewB.current, cv = crewV.current;
    if (cb && cv) {
      let ci = 0;
      ops.cranes.forEach((c, i) => {
        if (!(c.mode === "discharge" || c.mode === "load") || b.phase !== "working") return;
        for (let j = 0; j < 2; j++) {
          const u = (t * 0.07 + i * 0.31 + j * 0.5) % 1;
          const ping = u < 0.5 ? u * 2 : 2 - u * 2;
          const x = b.x - 9 + ping * 18;
          const z = c.z + (j === 0 ? 6.3 : -6.3);
          const yaw = u < 0.5 ? Math.PI / 2 : -Math.PI / 2;
          const y = DECK_Y + b.bob + Math.abs(Math.sin(t * 7 + j)) * 0.05;
          cb.setMatrixAt(ci, setM(x, y, z, yaw));
          cv.setMatrixAt(ci++, setM(x, y, z, yaw));
        }
        const qz = c.z + 3.5 + Math.sin(t * 0.4 + i) * 1.2;
        cb.setMatrixAt(ci, setM(327.3, APRON_Y, qz, Math.PI / 2));
        cv.setMatrixAt(ci++, setM(327.3, APRON_Y, qz, Math.PI / 2));
      });
      cb.count = ci;
      cv.count = ci;
      cb.instanceMatrix.needsUpdate = true;
      cv.instanceMatrix.needsUpdate = true;
    }

    for (const m of [fx, bm, st, fl, bc, tr, sp, sl, rp, cn]) m.instanceMatrix.needsUpdate = true;
  });

  return (
    <group name="docks-port-cranes">
      <instancedMesh ref={fixed} args={[G.fixed, vc, N]} frustumCulled={false} castShadow receiveShadow />
      <instancedMesh ref={boom} args={[G.boom, vc, N]} frustumCulled={false} castShadow />
      <instancedMesh ref={stays} args={[G.stay, steel, N * 4]} frustumCulled={false} />
      <instancedMesh ref={floods} args={[G.flood, lamp, N * 5]} frustumCulled={false} />
      <instancedMesh ref={beacons} args={[G.beacon, red, N * 2]} frustumCulled={false} />
      <instancedMesh ref={trolleys} args={[G.trolley, vc, N]} frustumCulled={false} castShadow />
      <instancedMesh ref={spreaders} args={[G.spreader, vc, N]} frustumCulled={false} castShadow />
      <instancedMesh ref={sLamps} args={[G.spreaderLamp, lamp, N]} frustumCulled={false} />
      <instancedMesh ref={ropes} args={[G.rope, steel, N * 4]} frustumCulled={false} />
      <instancedMesh ref={cones} args={[G.cone, M.cone, N]} frustumCulled={false} renderOrder={2} />
      <instancedMesh ref={carriers} args={[G.carrier, vc, 2]} frustumCulled={false} castShadow />
      <instancedMesh ref={cSpreaders} args={[G.spreader, vc, 2]} frustumCulled={false} />
      <instancedMesh ref={generic} args={[containerGeo, genericMat, MAX_BOXES]} frustumCulled={false} castShadow receiveShadow />
      {brandMats.map((m, i) => (
        <instancedMesh
          key={i}
          ref={(el) => {
            brands.current[i] = el;
          }}
          args={[containerGeo, m, MAX_BOXES]}
          frustumCulled={false}
          castShadow
          receiveShadow
        />
      ))}
      <instancedMesh ref={crewB} args={[G.crewBody, vc, N * 3]} frustumCulled={false} />
      <instancedMesh ref={crewV} args={[G.crewVest, M.vest, N * 3]} frustumCulled={false} />
      <instancedMesh ref={posts} args={[G.post, vc, QUAY_POSTS.length]} />
      <instancedMesh ref={postLamps} args={[G.postLamp, lamp, QUAY_POSTS.length]} />
      <instancedMesh ref={pools} args={[G.pool, M.pool, QUAY_POSTS.length]} renderOrder={2} />
    </group>
  );
}
