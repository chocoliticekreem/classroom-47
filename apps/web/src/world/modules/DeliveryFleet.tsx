"use client";
// Module: DeliveryFleet. The Hamyway Delivery fleet: 10 liveried vans + 4 HGVs that load at the depot,
// run delivery rounds (parcel pops onto the kerb with a tick), reroute around closures, break down
// (request:breakdown) and can be crashed by the Crashes module through registry crash().
// Simulation lives in DeliveryFleet/sim.ts; this file only renders it (instanced, ~10 draw calls).
import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BoxGeometry, Color, CylinderGeometry, IcosahedronGeometry, InstancedMesh, Matrix4, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, Quaternion, Vector3,
} from "three";
import { useWorld } from "../store";
import { DROP_POP_MS, FleetSim, LOAD_MS, MAX_VEHICLES, VEHICLE_DIMS, type LabelStatus, type Van } from "./DeliveryFleet/sim";
import { ViewCheck } from "./DeliveryFleet/lookahead";
import { LAYOUTS, RIVET_ORANGE, makeCheckTexture, makeLiveryTexture, makeParcelTexture } from "./DeliveryFleet/visuals";

const MAX_PARCELS = 120;
const MAX_FLASHES = 12;
const MAX_STEAM = 36;
const PUFFS_PER_VAN = 6;
const DROP_LIFE_MS = 30000;

const LABEL_STYLE: Record<LabelStatus, { bg: string; text: (v: Van) => string }> = {
  loading: { bg: "#d97706", text: (v) => `loading ${v.parcels.length}` },
  en_route: { bg: "#15803d", text: (v) => `${v.parcels.length} parcel${v.parcels.length === 1 ? "" : "s"}` },
  delayed: { bg: "#dc2626", text: (v) => `${v.parcels.length} delayed` },
  delivering: { bg: "#0284c7", text: () => "✓ delivering" },
  returning: { bg: "#475569", text: () => "returning" },
  broken: {
    bg: "#7f1d1d",
    text: (v) => (v.phase === "towing" ? "towing" : v.phase === "crashed" ? "CRASHED" : "BROKEN DOWN"),
  },
};

// scratch objects (no per-frame allocation)
const M = new Matrix4();
const ZERO = new Matrix4().makeScale(0, 0, 0);
const P = new Vector3();
const S = new Vector3();
const Q = new Quaternion();
const UP = new Vector3(0, 1, 0);
const HAZ_ON = new Color(3, 1.5, 0.15);
const HAZ_OFF = new Color("#6b3b12");
const BRAKE_ON = new Color(2.6, 0.15, 0.1);
const BRAKE_OFF = new Color("#5a1010");
const HEAD_ON = new Color(2.5, 2.4, 2.0);
const HEAD_OFF = new Color("#d6d9dc");
const CAB_VAN = new Color("#f6f5f1");
const CAB_TRUCK = new Color(RIVET_ORANGE);

function VanLabel({ van, selected, register }: { van: Van; selected: boolean; register: (id: string, el: HTMLSpanElement | null) => void }) {
  const y = VEHICLE_DIMS[van.kind].height + 1.3;
  return (
    <Html position={[0, y, 0]} center zIndexRange={[40, 0]} style={{ pointerEvents: "none" }}>
      <div
        onClick={() => useWorld.getState().select(van.id)}
        style={{
          pointerEvents: "auto",
          cursor: "pointer",
          whiteSpace: "nowrap",
          font: "600 11px/1 system-ui, -apple-system, sans-serif",
          color: "#fff",
          borderRadius: 999,
          padding: "3px 7px 3px 4px",
          display: "flex",
          alignItems: "center",
          gap: 5,
          background: "rgba(15,17,22,0.82)",
          boxShadow: selected ? "0 0 0 2px #fff, 0 2px 8px rgba(0,0,0,.5)" : "0 1px 4px rgba(0,0,0,.4)",
          transform: selected ? "scale(1.18)" : undefined,
          userSelect: "none",
        }}
      >
        <span style={{ background: RIVET_ORANGE, borderRadius: 999, padding: "2px 5px", fontWeight: 800 }}>{van.id}</span>
        <span ref={(el) => register(van.id, el)} style={{ borderRadius: 999, padding: "2px 6px" }} />
      </div>
    </Html>
  );
}

// Camera frustum check so off-screen vans only raycast every 4th frame.
const view = new ViewCheck();

export default function DeliveryFleet() {
  const [vans, setVans] = useState<Van[]>([]);
  const simRef = useRef<FleetSim | null>(null);
  const selected = useWorld((s) => s.selectedVehicle);
  const labels = useRef(new Map<string, HTMLSpanElement>());
  const indexToId = useRef<(string | null)[]>(new Array(MAX_VEHICLES).fill(null));

  const bodyRef = useRef<InstancedMesh>(null);
  const cabRef = useRef<InstancedMesh>(null);
  const glassRef = useRef<InstancedMesh>(null);
  const bumperRef = useRef<InstancedMesh>(null);
  const wheelRef = useRef<InstancedMesh>(null);
  const lightRef = useRef<InstancedMesh>(null);
  const parcelRef = useRef<InstancedMesh>(null);
  const flashRef = useRef<InstancedMesh>(null);
  const steamRef = useRef<InstancedMesh>(null);

  const res = useMemo(() => {
    const livery = makeLiveryTexture();
    const parcelTex = makeParcelTexture();
    const check = makeCheckTexture();
    return {
      box: new BoxGeometry(1, 1, 1),
      wheel: new CylinderGeometry(1, 1, 1, 10),
      plane: new PlaneGeometry(1, 1),
      puff: new IcosahedronGeometry(1, 0),
      bodyMat: new MeshStandardMaterial({ map: livery, roughness: 0.55 }),
      cabMat: new MeshStandardMaterial({ color: "#ffffff", roughness: 0.6 }),
      glassMat: new MeshStandardMaterial({ color: "#1d2735", roughness: 0.2, metalness: 0.3 }),
      bumperMat: new MeshStandardMaterial({ color: "#2a2d34", roughness: 0.85 }),
      wheelMat: new MeshStandardMaterial({ color: "#16171b", roughness: 0.9, flatShading: true }),
      lightMat: new MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
      parcelMat: new MeshStandardMaterial({ map: parcelTex, roughness: 0.85 }),
      flashMat: new MeshBasicMaterial({ map: check, transparent: true, depthWrite: false, toneMapped: false }),
      steamMat: new MeshStandardMaterial({ color: "#f4f6f8", roughness: 1, transparent: true, opacity: 0.72, depthWrite: false, flatShading: true }),
      textures: [livery, parcelTex, check],
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const v of Object.values(res)) if (v && typeof v === "object" && "dispose" in v) (v as { dispose: () => void }).dispose();
      for (const t of res.textures) t.dispose();
    };
  }, [res]);

  useEffect(() => {
    const sim = new FleetSim();
    simRef.current = sim;
    sim.onListChange = () => setVans([...sim.vans.values()]);
    sim.sees = view.sees;
    sim.start();
    return () => {
      sim.dispose();
      simRef.current = null;
    };
  }, []);

  // initialise instance colours / hide everything until the first frame writes matrices
  useEffect(() => {
    for (const r of [bodyRef, cabRef, glassRef, bumperRef, wheelRef, lightRef, parcelRef, flashRef, steamRef]) {
      const m = r.current;
      if (!m) continue;
      for (let i = 0; i < m.count; i++) m.setMatrixAt(i, ZERO);
      m.instanceMatrix.needsUpdate = true;
    }
    const cab = cabRef.current;
    const light = lightRef.current;
    if (cab) for (let i = 0; i < MAX_VEHICLES; i++) cab.setColorAt(i, CAB_VAN);
    if (light) for (let i = 0; i < MAX_VEHICLES * 8; i++) light.setColorAt(i, HAZ_OFF);
  }, []);

  const registerLabel = (id: string, el: HTMLSpanElement | null) => {
    if (el) {
      labels.current.set(id, el);
      const v = simRef.current?.vans.get(id);
      if (v) v.labelDirty = true;
    } else labels.current.delete(id);
  };

  useFrame(({ camera }, rawDelta) => {
    const sim = simRef.current;
    const body = bodyRef.current;
    const cab = cabRef.current;
    const glass = glassRef.current;
    const bumper = bumperRef.current;
    const wheels = wheelRef.current;
    const lights = lightRef.current;
    const parcels = parcelRef.current;
    const flashes = flashRef.current;
    const steam = steamRef.current;
    if (!sim || !body || !cab || !glass || !bumper || !wheels || !lights || !parcels || !flashes || !steam) return;
    const world = useWorld.getState();
    if (world.paused) return;
    const dt = Math.min(rawDelta, 0.1);
    const wall = performance.now();
    view.update(camera);
    sim.update(dt, wall);
    const now = sim.now;
    const blink = wall % 800 < 420;
    const night = world.timeOfDay < 7 || world.timeOfDay > 17.6;
    const ids = indexToId.current;
    ids.fill(null);

    let np = 0; // parcels used
    let ns = 0; // steam puffs used
    for (const v of sim.vans.values()) {
      const i = v.index;
      ids[i] = v.id;
      const L = LAYOUTS[v.kind];
      const G = v.group.matrix;
      body.setMatrixAt(i, M.multiplyMatrices(G, L.body));
      cab.setMatrixAt(i, M.multiplyMatrices(G, L.cab));
      cab.setColorAt(i, v.kind === "truck" ? CAB_TRUCK : CAB_VAN);
      glass.setMatrixAt(i, M.multiplyMatrices(G, L.glass));
      bumper.setMatrixAt(i, M.multiplyMatrices(G, L.bumper));
      for (let w = 0; w < 6; w++) wheels.setMatrixAt(i * 6 + w, w < L.wheels.length ? M.multiplyMatrices(G, L.wheels[w]) : ZERO);
      const haz = v.hazard && blink;
      for (let k = 0; k < 8; k++) {
        lights.setMatrixAt(i * 8 + k, M.multiplyMatrices(G, L.lights[k]));
        const col = k < 4 ? (haz ? HAZ_ON : HAZ_OFF) : k < 6 ? (v.braking || v.phase !== "driving" ? BRAKE_ON : BRAKE_OFF) : night ? HEAD_ON : HEAD_OFF;
        lights.setColorAt(i * 8 + k, col);
      }

      const fx = Math.sin(v.dh);
      const fz = Math.cos(v.dh);
      const lx = Math.cos(v.dh);
      const lz = -Math.sin(v.dh);
      const half = VEHICLE_DIMS[v.kind].len / 2;

      // parcel stack beside the van at the bay, shrinking into the back doors
      if (v.phase === "loading" && v.loadCount > 0) {
        const n = v.loadCount;
        const p = Math.min(1, Math.max(0, (now - v.phaseStart - (v.phaseDur - LOAD_MS)) / (LOAD_MS * 0.9)));
        const gone = Math.min(n, Math.floor(p * n));
        const frac = p * n - gone;
        for (let j = 0; j < n - gone && np < MAX_PARCELS; j++) {
          const col = j % 2;
          const row = Math.floor(j / 2);
          let x = v.dx + lx * 2.4 - fx * (half - 1.0 - col * 0.75);
          let z = v.dz + lz * 2.4 - fz * (half - 1.0 - col * 0.75);
          let y = 0.3 + row * 0.62;
          let sc = 0.6;
          if (j === n - gone - 1 && gone < n) {
            // top box: hop into the van
            const rx = v.dx - fx * (half + 0.3);
            const rz = v.dz - fz * (half + 0.3);
            x += (rx - x) * frac;
            z += (rz - z) * frac;
            y += (1.1 - y) * frac + Math.sin(frac * Math.PI) * 0.8;
            sc *= 1 - frac * 0.7;
          }
          Q.setFromAxisAngle(UP, v.dh);
          parcels.setMatrixAt(np++, M.compose(P.set(x, y, z), Q, S.setScalar(sc)));
        }
      }

      // steam from the bonnet of broken-down vans
      if ((v.phase === "broken" || v.phase === "crashed") && ns + PUFFS_PER_VAN <= MAX_STEAM) {
        P.copy(L.bonnet).applyMatrix4(G);
        const bx = P.x;
        const by = P.y;
        const bz = P.z;
        for (let k = 0; k < PUFFS_PER_VAN; k++) {
          const ph = (now / 1700 + k / PUFFS_PER_VAN + i * 0.13) % 1;
          const sc = (0.25 + ph * 0.85) * (1 - ph * ph * ph);
          Q.identity();
          steam.setMatrixAt(
            ns++,
            M.compose(P.set(bx + Math.sin(k * 2.1 + i) * 0.5 * ph + 0.8 * ph, by + ph * 3.4, bz + Math.cos(k * 1.7 + i) * 0.5 * ph), Q, S.setScalar(sc)),
          );
        }
      }

      // label text/colour only when the status changed
      if (v.labelDirty) {
        const el = labels.current.get(v.id);
        if (el) {
          const st = LABEL_STYLE[v.label];
          el.textContent = st.text(v);
          el.style.background = st.bg;
          v.labelDirty = false;
        }
      }
      const el = labels.current.get(v.id);
      if (el) {
        const dist = camera.position.distanceTo(v.group.position);
        const op = Math.round(Math.min(1, Math.max(0.3, 1.3 - dist / 450)) * 10) / 10;
        const wrap = el.parentElement;
        if (wrap && wrap.dataset.op !== String(op)) {
          wrap.dataset.op = String(op);
          wrap.style.opacity = String(op);
        }
      }
    }
    for (let i = 0; i < MAX_VEHICLES; i++) {
      if (ids[i]) continue;
      body.setMatrixAt(i, ZERO);
      cab.setMatrixAt(i, ZERO);
      glass.setMatrixAt(i, ZERO);
      bumper.setMatrixAt(i, ZERO);
      for (let w = 0; w < 6; w++) wheels.setMatrixAt(i * 6 + w, ZERO);
      for (let k = 0; k < 8; k++) lights.setMatrixAt(i * 8 + k, ZERO);
    }

    // delivered parcels on the kerb: fly out of the back, bounce, sit for a while, shrink away
    while (sim.drops.length && now - sim.drops[0].born > DROP_LIFE_MS + 1000) sim.drops.shift();
    for (const d of sim.drops) {
      if (np >= MAX_PARCELS) break;
      const age = now - d.born;
      let x = d.x;
      let z = d.z;
      let y = 0.3;
      let sc = 0.6;
      if (age < DROP_POP_MS) {
        const u = age / DROP_POP_MS;
        x = d.sx + (d.x - d.sx) * u;
        z = d.sz + (d.z - d.sz) * u;
        y = 1.0 * (1 - u) + 0.3 * u + Math.sin(Math.PI * u) * 1.3;
        sc = 0.6 * (0.5 + 0.5 * u);
      } else if (age < DROP_POP_MS + 700) {
        const b = (age - DROP_POP_MS) / 700;
        y = 0.3 + Math.abs(Math.sin(b * Math.PI * 2)) * 0.4 * (1 - b);
      } else if (age > DROP_LIFE_MS) {
        sc = 0.6 * Math.max(0, 1 - (age - DROP_LIFE_MS) / 1000);
      }
      Q.setFromAxisAngle(UP, (d.born * 0.0137) % Math.PI);
      parcels.setMatrixAt(np++, M.compose(P.set(x, age > DROP_LIFE_MS ? sc / 2 : y, z), Q, S.setScalar(sc)));
    }
    for (let i = np; i < parcels.count; i++) parcels.setMatrixAt(i, ZERO);

    // ✓ flashes above freshly delivered parcels (billboarded)
    let nf = 0;
    for (const f of sim.flashes) {
      const age = now - f.born;
      if (age < 0 || age > 1400 || nf >= MAX_FLASHES) continue;
      let sc = age < 180 ? (age / 180) * 1.5 : age < 360 ? 1.5 - ((age - 180) / 180) * 0.3 : 1.2;
      if (age > 1100) sc *= Math.max(0, 1 - (age - 1100) / 300);
      flashes.setMatrixAt(nf++, M.compose(P.set(f.x, 1.7 + (age / 1400) * 0.9, f.z), camera.quaternion, S.set(sc * 1.4, sc * 1.4, 1)));
    }
    for (let i = nf; i < flashes.count; i++) flashes.setMatrixAt(i, ZERO);
    for (let i = ns; i < steam.count; i++) steam.setMatrixAt(i, ZERO);

    for (const m of [body, cab, glass, bumper, wheels, lights, parcels, flashes, steam]) m.instanceMatrix.needsUpdate = true;
    if (cab.instanceColor) cab.instanceColor.needsUpdate = true;
    if (lights.instanceColor) lights.instanceColor.needsUpdate = true;
    // keep click raycasts accurate for moving instances
    body.computeBoundingSphere();
    cab.computeBoundingSphere();
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId === undefined) return;
    const id = indexToId.current[e.instanceId];
    if (!id) return;
    e.stopPropagation();
    useWorld.getState().select(id);
  };
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    if (e.instanceId !== undefined && indexToId.current[e.instanceId]) document.body.style.cursor = "pointer";
  };
  const onOut = () => {
    document.body.style.cursor = "";
  };

  return (
    <group name="DeliveryFleet">
      <instancedMesh
        ref={bodyRef}
        args={[res.box, res.bodyMat, MAX_VEHICLES]}
        castShadow
        frustumCulled={false}
        onClick={onClick}
        onPointerOver={onOver}
        onPointerOut={onOut}
      />
      <instancedMesh ref={cabRef} args={[res.box, res.cabMat, MAX_VEHICLES]} castShadow frustumCulled={false} onClick={onClick} />
      <instancedMesh ref={glassRef} args={[res.box, res.glassMat, MAX_VEHICLES]} frustumCulled={false} />
      <instancedMesh ref={bumperRef} args={[res.box, res.bumperMat, MAX_VEHICLES]} frustumCulled={false} />
      <instancedMesh ref={wheelRef} args={[res.wheel, res.wheelMat, MAX_VEHICLES * 6]} frustumCulled={false} />
      <instancedMesh ref={lightRef} args={[res.box, res.lightMat, MAX_VEHICLES * 8]} frustumCulled={false} />
      <instancedMesh ref={parcelRef} args={[res.box, res.parcelMat, MAX_PARCELS]} castShadow frustumCulled={false} />
      <instancedMesh ref={flashRef} args={[res.plane, res.flashMat, MAX_FLASHES]} frustumCulled={false} renderOrder={10} />
      <instancedMesh ref={steamRef} args={[res.puff, res.steamMat, MAX_STEAM]} frustumCulled={false} />
      {vans.map((v) => (
        <primitive key={v.id} object={v.group}>
          <VanLabel van={v} selected={selected === v.id} register={registerLabel} />
        </primitive>
      ))}
    </group>
  );
}
