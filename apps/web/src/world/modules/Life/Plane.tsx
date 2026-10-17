"use client";
// A jet crossing high over the city every ~40 s, with blinking nav lights and a strobe.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry } from "three";
import { useWorld } from "../../store";
import { merge, paint } from "./geo";
import { mulberry32 } from "./sim";

const PERIOD = 40; // s between passes
const SPEED = 75; // m/s
const HALF_TRACK = 1000; // starts this far out, flies through the city to the other side
const ALT = 185;

export default function Plane() {
  const group = useRef<Group>(null);
  const strobe = useRef<Mesh>(null);
  const beacon = useRef<Mesh>(null);
  const st = useRef({ t: 12, ox: 0, oz: 0, dx: 1, dz: 0, rand: mulberry32(77) });

  const { bodyGeo, bodyMat, lightGeo, red, green, white } = useMemo(() => {
    const fus = new CylinderGeometry(1.3, 1.1, 22, 10);
    fus.rotateX(Math.PI / 2);
    const nose = new ConeGeometry(1.3, 3.5, 10);
    nose.rotateX(Math.PI / 2);
    nose.translate(0, 0, 12.7);
    const tailCone = new ConeGeometry(1.1, 4, 10);
    tailCone.rotateX(-Math.PI / 2);
    tailCone.translate(0, 0.3, -13);
    const wings = new BoxGeometry(26, 0.3, 4);
    wings.translate(0, -0.4, 1);
    const stab = new BoxGeometry(9, 0.2, 2.2);
    stab.translate(0, 0.5, -12.5);
    const fin = new BoxGeometry(0.3, 4.5, 3);
    fin.translate(0, 2.6, -12.5);
    const engL = new CylinderGeometry(0.7, 0.7, 3, 8);
    engL.rotateX(Math.PI / 2);
    engL.translate(-5.5, -1.2, 2);
    const engR = engL.clone();
    engR.translate(11, 0, 0);
    const bodyGeo = merge([
      paint(fus, "#f4f4f4"),
      paint(nose, "#f4f4f4"),
      paint(tailCone, "#f4f4f4"),
      paint(wings, "#d8dde3"),
      paint(stab, "#d8dde3"),
      paint(fin, "#ff6a1a"),
      paint(engL, "#9aa3ad"),
      paint(engR, "#9aa3ad"),
    ]);
    return {
      bodyGeo,
      bodyMat: new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, flatShading: true }),
      lightGeo: new SphereGeometry(0.6, 8, 6),
      red: new MeshBasicMaterial({ color: "#ff2a2a", toneMapped: false }),
      green: new MeshBasicMaterial({ color: "#2aff6a", toneMapped: false }),
      white: new MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
    };
  }, []);
  useEffect(
    () => () => {
      for (const d of [bodyGeo, bodyMat, lightGeo, red, green, white]) d.dispose();
    },
    [bodyGeo, bodyMat, lightGeo, red, green, white],
  );

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const s = st.current;
    if (!useWorld.getState().paused) s.t += Math.min(delta, 0.1);
    if (s.t >= PERIOD) {
      s.t -= PERIOD;
      const a = s.rand() * Math.PI * 2;
      s.dx = Math.sin(a);
      s.dz = Math.cos(a);
      const off = (s.rand() - 0.5) * 300; // sideways offset so it doesn't always cross the centre
      s.ox = -s.dz * off;
      s.oz = s.dx * off;
    }
    const d = s.t * SPEED - HALF_TRACK;
    const flying = d < HALF_TRACK;
    g.visible = flying;
    if (!flying) return;
    g.position.set(s.ox + s.dx * d, ALT, s.oz + s.dz * d);
    g.rotation.set(0, Math.atan2(s.dx, s.dz), 0);
    const now = performance.now();
    strobe.current!.visible = now % 1200 < 90;
    beacon.current!.visible = (now + 600) % 1000 < 150;
  });

  return (
    <group ref={group} visible={false}>
      <mesh geometry={bodyGeo} material={bodyMat} />
      {/* nav lights: red on the left wing tip (port), green on the right (starboard). Facing +z, left is +x. */}
      <mesh geometry={lightGeo} material={red} position={[13, -0.4, 1]} />
      <mesh geometry={lightGeo} material={green} position={[-13, -0.4, 1]} />
      <mesh ref={strobe} geometry={lightGeo} material={white} position={[0, 4.9, -13.5]} scale={1.3} />
      <mesh ref={beacon} geometry={lightGeo} material={red} position={[0, -1.4, 0]} />
    </group>
  );
}
