"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Label } from "../../live/Label";
import { ATMOS } from "../palette";

const BEAM_H = 700;
const BEAM_R = 9;

const BEAM_VERT = /* glsl */ `
uniform float uH;
varying float vY;
varying vec3 vN;
varying vec3 vV;
void main() {
  vY = position.y / uH + 0.5;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalMatrix * normal;
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying float vY;
varying vec3 vN;
varying vec3 vV;
void main() {
  float rim = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
  float fade = pow(1.0 - vY, 1.6) * smoothstep(0.0, 0.02, vY);
  float pulse = 0.88 + 0.12 * sin(uTime * 1.6 + vY * 9.0);
  gl_FragColor = vec4(uColor * 1.8, rim * fade * pulse * uAlpha);
}`;

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();

function distanceText(dx: number, dz: number) {
  const m = Math.hypot(dx, dz);
  const bearing = Math.atan2(dx, -dz);
  const dir = COMPASS[(Math.round(bearing / (Math.PI / 4)) + 8) % 8];
  return `${m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`} ${dir}`;
}

/** A tall additive light shaft that stays visible above the fog. */
export function Beam({ x, z, color }: { x: number; z: number; color: string }) {
  const mesh = useRef<THREE.Mesh>(null);
  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(BEAM_R * 0.6, BEAM_R, BEAM_H, 24, 1, true);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uH: { value: BEAM_H },
        uColor: { value: new THREE.Color(color) },
        uAlpha: { value: 0.6 },
        uTime: { value: 0 },
      },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    return { geometry, material };
  }, [color]);

  useFrame(({ clock }) => {
    const live = mesh.current?.material as THREE.ShaderMaterial | undefined;
    if (!live) return;
    live.uniforms.uTime.value = clock.elapsedTime;
    live.uniforms.uAlpha.value = 0.3 + 0.5 * ATMOS.windowGlow;
  });

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return <mesh ref={mesh} geometry={geometry} material={material} position={[x, BEAM_H / 2, z]} frustumCulled={false} />;
}

/**
 * Floating name pill above a site. Off screen (or behind the camera) it slides to the nearest screen edge
 * with an arrow, so the site can always be found; the readout is camera-relative distance and compass.
 */
export function SiteLabel({
  x,
  y,
  z,
  name,
  color,
}: {
  x: number;
  y: number;
  z: number;
  name: string;
  color: string;
}) {
  const { camera, size } = useThree();
  const follow = useRef<THREE.Group>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const arrow = useRef<HTMLSpanElement>(null);
  const last = useRef("");
  const target = useMemo(() => new THREE.Vector3(x, y, z), [x, y, z]);

  const node = useMemo(
    () => (
      <div
        style={{
          fontFamily: "var(--font-figtree), system-ui, sans-serif",
          background: "rgba(12,12,16,0.82)",
          border: `1px solid ${color}`,
          boxShadow: `0 0 18px ${color}55`,
          borderRadius: 12,
          padding: "7px 12px",
          color: "#fff",
          whiteSpace: "nowrap",
          fontSize: 13,
          lineHeight: 1.3,
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span ref={arrow} style={{ color, fontSize: 14, opacity: 0, display: "inline-block", width: 14, textAlign: "center" }}>
          ▲
        </span>
        <div>
          <div style={{ fontWeight: 650 }}>{name}</div>
          <div style={{ color, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
            <span ref={readout} />
          </div>
        </div>
      </div>
    ),
    [name, color],
  );

  useFrame(() => {
    const anchor = follow.current;
    if (!anchor) return;
    camera.updateMatrixWorld();
    _p.copy(target).project(camera);
    const behind = _p.z > 1;
    if (behind) {
      _p.x = -_p.x * 1000;
      _p.y = -_p.y * 1000;
    }
    const halfW = size.width / 2;
    const halfH = size.height / 2;
    const mx = Math.max(0.3, 1 - 140 / halfW);
    const top = Math.max(0.3, 1 - 80 / halfH);
    const bottom = Math.max(0.3, 1 - 100 / halfH);
    const k = Math.max(Math.abs(_p.x) / mx, _p.y > 0 ? _p.y / top : -_p.y / bottom);
    const clamped = behind || k > 1;
    if (clamped) {
      const s = Math.max(k, 1e-6);
      _n.set(_p.x / s, _p.y / s, 0.5).unproject(camera);
      anchor.position.copy(_n);
    } else {
      anchor.position.copy(target);
    }
    if (arrow.current) {
      arrow.current.style.opacity = clamped ? "1" : "0";
      arrow.current.style.transform = `rotate(${Math.atan2(_p.x * halfW, _p.y * halfH).toFixed(3)}rad)`;
    }
    const text = distanceText(target.x - camera.position.x, target.z - camera.position.z);
    if (readout.current && text !== last.current) {
      last.current = text;
      readout.current.textContent = text;
    }
  }, -1);

  return (
    <group ref={follow}>
      <Label position={[0, 0, 0]}>{node}</Label>
    </group>
  );
}
