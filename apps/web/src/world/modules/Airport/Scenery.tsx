"use client";
// Static airport: ground, runway, buildings, glass, signs, airfield lights (instanced) with the sequenced
// "rabbit" approach lights, a rotating radar and a fluttering windsock.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useWorld } from "../../store";
import { merge, paint } from "./geometry";
import { CARGO_SHED, nightFactor, RWY, TERMINAL, TOWER, WINDSOCK } from "./layout";
import { glassGeometry, groundGeometry, lamps, rabbitLamps, solidGeometry } from "./sceneryGeo";
import { RUNWAY_TEX_H, RUNWAY_TEX_W, runwayTexture, signTexture } from "./textures";

const m4 = new THREE.Matrix4();
const col = new THREE.Color();

export default function Scenery() {
  const lampRef = useRef<THREE.InstancedMesh>(null);
  const rabbitRef = useRef<THREE.InstancedMesh>(null);
  const radarRef = useRef<THREE.Group>(null);
  const sockRef = useRef<THREE.Group>(null);
  const glassRef = useRef<THREE.Mesh>(null);
  const termRef = useRef<THREE.Mesh>(null);
  const termRef2 = useRef<THREE.Mesh>(null);
  const cargoRef = useRef<THREE.Mesh>(null);
  const lastNight = useRef(-1);

  const built = useMemo(() => {
    const ground = groundGeometry();
    const solid = solidGeometry();
    const glass = glassGeometry();
    const flatMat = (layer: number) =>
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -layer, polygonOffsetUnits: -layer * 2 });
    const layers = [
      { geo: ground.grass, mat: flatMat(-2) },
      { geo: ground.stripes, mat: flatMat(-1) },
      { geo: ground.pave, mat: flatMat(1) },
      { geo: ground.marks, mat: flatMat(3) },
    ];
    const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, flatShading: true, side: THREE.DoubleSide });
    const glassMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.15,
      metalness: 0.35,
      emissive: new THREE.Color("#ffcf8a"),
      emissiveIntensity: 0,
      side: THREE.DoubleSide,
    });

    const rwTex = runwayTexture();
    const rwGeo = new THREE.PlaneGeometry(RUNWAY_TEX_W, RUNWAY_TEX_H);
    rwGeo.rotateX(-Math.PI / 2);
    rwGeo.translate(RWY.x0 - 4 + RUNWAY_TEX_W / 2, 0.03, RWY.z);
    const rwMat = new THREE.MeshStandardMaterial({ map: rwTex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });

    const termTex = signTexture("HAMYWAY CITY AIRPORT", { fg: "#ffffff", bg: "#13233f", accent: "#ff6a1a" });
    const cargoTex = signTexture("HAMYWAY AIR CARGO", { fg: "#ffffff", bg: "#ff6a1a", accent: "#13233f" });
    const signMat = (map: THREE.Texture) =>
      new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.15, roughness: 0.6 });
    const termMat = signMat(termTex);
    const cargoMat = signMat(cargoTex);

    const lampList = lamps();
    const rabbitList = rabbitLamps();
    const lampGeo = new THREE.OctahedronGeometry(1, 0);
    const lampMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const rabbitMat = new THREE.MeshBasicMaterial({ toneMapped: false });

    // windsock: three tapering orange/white bands pointing along +x from the pole top
    const sock: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 3; k++) {
      const r0 = 0.55 - k * 0.12;
      const g = new THREE.CylinderGeometry(r0 - 0.12, r0, 1.2, 8, 1, true);
      g.rotateZ(-Math.PI / 2);
      g.translate(0.6 + k * 1.2, 0, 0);
      sock.push(paint(g, k % 2 ? "#ffffff" : "#ff6a1a"));
    }
    const sockGeo = merge(sock);
    const radarGeo = merge([
      paint(new THREE.BoxGeometry(0.4, 0.8, 0.4).translate(0, 0.4, 0), "#8b9097"),
      paint(new THREE.BoxGeometry(4.2, 1.0, 0.18).rotateX(-0.35).translate(0, 1.2, 0.2), "#f1efe9"),
      paint(new THREE.BoxGeometry(0.3, 0.3, 0.9).translate(0, 1.0, -0.3), "#4a4f57"),
    ]);
    return {
      layers, solid, glass, solidMat, glassMat, rwGeo, rwMat, termMat, cargoMat, termTex, cargoTex,
      lampList, rabbitList, lampGeo, lampMat, rabbitMat, sockGeo, radarGeo,
    };
  }, []);

  useEffect(() => {
    const place = (mesh: THREE.InstancedMesh | null, list: typeof built.lampList) => {
      if (!mesh) return;
      list.forEach((l, i) => {
        m4.makeScale(l.s, l.s, l.s).setPosition(l.x, l.y, l.z);
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, col.set(l.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    place(lampRef.current, built.lampList);
    place(rabbitRef.current, built.rabbitList);
    return () => {
      for (const l of built.layers) {
        l.geo.dispose();
        l.mat.dispose();
      }
      for (const k of ["solid", "glass", "rwGeo", "lampGeo", "sockGeo", "radarGeo"] as const) built[k].dispose();
      for (const k of ["solidMat", "glassMat", "rwMat", "termMat", "cargoMat", "lampMat", "rabbitMat"] as const) built[k].dispose();
      built.rwMat.map?.dispose();
      built.termTex.dispose();
      built.cargoTex.dispose();
    };
  }, [built]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const st = useWorld.getState();
    const night = nightFactor(st.timeOfDay);
    if (Math.abs(night - lastNight.current) > 0.01) {
      lastNight.current = night;
      const std = (r: React.RefObject<THREE.Mesh | null>) => r.current?.material as THREE.MeshStandardMaterial | undefined;
      (lampRef.current?.material as THREE.MeshBasicMaterial | undefined)?.color.setScalar(0.75 + night * 2.6);
      const glass = std(glassRef);
      if (glass) glass.emissiveIntensity = night * 0.85;
      for (const r of [termRef, cargoRef]) {
        const m = std(r);
        if (m) m.emissiveIntensity = 0.15 + night * 0.9;
      }
    }
    if (st.paused) return;
    const now = performance.now() / 1000;
    if (radarRef.current) radarRef.current.rotation.y += dt * 1.6;
    if (sockRef.current) {
      sockRef.current.rotation.y = Math.PI + Math.sin(now * 0.7) * 0.18 + Math.sin(now * 2.3) * 0.05;
      sockRef.current.rotation.z = -0.12 + Math.sin(now * 1.7) * 0.06;
    }
    // rabbit: a bright pulse runs from the outermost bar to the threshold twice a second
    const rabbit = rabbitRef.current;
    if (rabbit) {
      const bars = built.rabbitList.length / 5;
      const cycle = (now * 2) % 1;
      const active = Math.floor(cycle * (bars + 2)); // two dark steps between runs
      const hi = 1.2 + night * 3.5;
      for (let i = 0; i < built.rabbitList.length; i++) {
        const bar = Math.floor(i / 5);
        rabbit.setColorAt(i, col.setScalar(bar === active ? hi : 0.18 + night * 0.25));
      }
      if (rabbit.instanceColor) rabbit.instanceColor.needsUpdate = true;
    }
  });

  const termY = TERMINAL.height + 3.4;
  return (
    <group>
      {built.layers.map((l, i) => (
        <mesh key={i} geometry={l.geo} material={l.mat} receiveShadow />
      ))}
      <mesh geometry={built.rwGeo} material={built.rwMat} receiveShadow />
      <mesh geometry={built.solid} material={built.solidMat} castShadow receiveShadow />
      <mesh ref={glassRef} geometry={built.glass} material={built.glassMat} />
      {/* terminal sign on the roof, facing landside (south, toward the city) and tilted up to the sky */}
      <mesh position={[(TERMINAL.minX + TERMINAL.maxX) / 2, termY, TERMINAL.backZ - 2]} rotation={[-0.35, 0, 0]} material={built.termMat} ref={termRef}>
        <planeGeometry args={[40, 5]} />
      </mesh>
      {/* the same sign on the airside, over the apron */}
      <mesh position={[(TERMINAL.minX + TERMINAL.maxX) / 2, termY, TERMINAL.frontZ + 1]} rotation={[0.35, Math.PI, 0]} material={built.termMat} ref={termRef2}>
        <planeGeometry args={[40, 5]} />
      </mesh>
      <mesh
        position={[(CARGO_SHED.minX + CARGO_SHED.maxX) / 2, CARGO_SHED.height + 2.6, CARGO_SHED.maxZ - 2]}
        rotation={[-0.3, 0, 0]}
        material={built.cargoMat}
        ref={cargoRef}
      >
        <planeGeometry args={[25, 3.1]} />
      </mesh>
      <instancedMesh ref={lampRef} args={[built.lampGeo, built.lampMat, built.lampList.length]} frustumCulled={false} />
      <instancedMesh ref={rabbitRef} args={[built.lampGeo, built.rabbitMat, built.rabbitList.length]} frustumCulled={false} />
      <group ref={radarRef} position={[TOWER.x, TOWER.height + 0.2, TOWER.z]}>
        <mesh geometry={built.radarGeo} material={built.solidMat} />
      </group>
      <group ref={sockRef} position={[WINDSOCK.x, 6.8, WINDSOCK.z]}>
        <mesh geometry={built.sockGeo} material={built.solidMat} />
      </group>
    </group>
  );
}
