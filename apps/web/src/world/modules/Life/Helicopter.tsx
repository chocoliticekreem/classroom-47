"use client";
// A news helicopter circling slowly over the newest live incident (or the downtown centre), rotors spinning.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
} from "three";
import { useWorld } from "../../store";
import { merge, paint } from "./geo";

const RADIUS = 42;
const ALT = 72; // above the tallest towers
const ORBIT = 0.22; // rad/s

function newsTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 48;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#1d3557";
  ctx.fillRect(0, 0, 128, 48);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 30px Arial, Helvetica, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("NEWS 6", 64, 25);
  const t = new CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

export default function Helicopter() {
  const root = useRef<Group>(null);
  const rotor = useRef<Mesh>(null);
  const tailRotor = useRef<Mesh>(null);
  const beacon = useRef<Mesh>(null);
  const st = useRef({ cx: 0, cz: 0, a: 0, t: 0 });

  const res = useMemo(() => {
    const cabin = new SphereGeometry(1.6, 10, 8);
    cabin.scale(1, 0.9, 1.5);
    const glass = new SphereGeometry(1.2, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    glass.rotateX(Math.PI / 2);
    glass.scale(1.1, 1, 0.8);
    glass.translate(0, 0.25, 1.3);
    const boom = new CylinderGeometry(0.3, 0.45, 5.5, 6);
    boom.rotateX(Math.PI / 2);
    boom.translate(0, 0.4, -4.2);
    const fin = new BoxGeometry(0.15, 1.6, 0.9);
    fin.translate(0, 1.1, -6.8);
    const skidL = new BoxGeometry(0.12, 0.12, 3.6);
    skidL.translate(0.95, -1.6, 0);
    const skidR = new BoxGeometry(0.12, 0.12, 3.6);
    skidR.translate(-0.95, -1.6, 0);
    const mast = new CylinderGeometry(0.12, 0.12, 0.6, 6);
    mast.translate(0, 1.6, 0);
    const body = merge([
      paint(cabin, "#f1faee"),
      paint(glass, "#457b9d"),
      paint(boom, "#f1faee"),
      paint(fin, "#e63946"),
      paint(skidL, "#333333"),
      paint(skidR, "#333333"),
      paint(mast, "#333333"),
    ]);
    const rotorGeo = merge([
      paint(new BoxGeometry(11, 0.06, 0.35), "#2b2b2b"),
      paint(new BoxGeometry(0.35, 0.06, 11), "#2b2b2b"),
    ]);
    const tailGeo = merge([
      paint(new BoxGeometry(0.05, 1.7, 0.2), "#2b2b2b"),
      paint(new BoxGeometry(0.05, 0.2, 1.7), "#2b2b2b"),
    ]);
    const tex = newsTexture();
    return {
      body,
      rotorGeo,
      tailGeo,
      mat: new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true }),
      decalGeo: new PlaneGeometry(1.8, 0.66),
      decalMat: new MeshBasicMaterial({ map: tex, side: DoubleSide }),
      tex,
      beaconGeo: new SphereGeometry(0.18, 6, 4),
      beaconMat: new MeshBasicMaterial({ color: "#ff2a2a", toneMapped: false }),
    };
  }, []);
  useEffect(
    () => () => {
      for (const d of [res.body, res.rotorGeo, res.tailGeo, res.mat, res.decalGeo, res.decalMat, res.tex, res.beaconGeo, res.beaconMat])
        d.dispose();
    },
    [res],
  );

  useFrame((_, delta) => {
    const g = root.current;
    if (!g || useWorld.getState().paused) return;
    const dt = Math.min(delta, 0.1);
    const s = st.current;
    s.t += dt;

    // newest incident still live, else the downtown centre
    const incidents = useWorld.getState().incidents;
    let tx = 0;
    let tz = 0;
    for (let i = incidents.length - 1; i >= 0; i--) {
      if (incidents[i].status !== "cleared") {
        tx = incidents[i].x;
        tz = incidents[i].z;
        break;
      }
    }
    const k = 1 - Math.exp(-dt * 0.35); // slow, cinematic drift to the new target
    s.cx += (tx - s.cx) * k;
    s.cz += (tz - s.cz) * k;
    s.a += ORBIT * dt;

    g.position.set(s.cx + Math.cos(s.a) * RADIUS, ALT + Math.sin(s.t * 0.7) * 1.5, s.cz + Math.sin(s.a) * RADIUS);
    // orbiting counter-clockwise seen from above: velocity is (-sin a, cos a)
    // nose down a touch, banked right into the turn (the orbit centre is on our right)
    g.rotation.set(0.08, Math.atan2(-Math.sin(s.a), Math.cos(s.a)), 0.12, "YXZ");
    rotor.current!.rotation.y += dt * 28;
    tailRotor.current!.rotation.x += dt * 40;
    beacon.current!.visible = performance.now() % 1000 < 140;
  });

  return (
    <group ref={root} position={[RADIUS, ALT, 0]} scale={1.4}>
      <mesh geometry={res.body} material={res.mat} castShadow />
      <mesh ref={rotor} geometry={res.rotorGeo} material={res.mat} position={[0, 1.95, 0]} />
      <mesh ref={tailRotor} geometry={res.tailGeo} material={res.mat} position={[0.25, 1.1, -6.8]} />
      <mesh geometry={res.decalGeo} material={res.decalMat} position={[1.62, 0, -0.2]} rotation={[0, Math.PI / 2, 0]} />
      <mesh geometry={res.decalGeo} material={res.decalMat} position={[-1.62, 0, -0.2]} rotation={[0, -Math.PI / 2, 0]} />
      <mesh ref={beacon} geometry={res.beaconGeo} material={res.beaconMat} position={[0, -1.4, -1]} />
    </group>
  );
}
