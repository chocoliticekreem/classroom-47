// Three.js plumbing for crash VFX: billboard particle meshes driven straight from pool arrays,
// and canvas textures for status labels. Everything is created once and reused.
import * as THREE from "three";
import type { ParticlePool } from "./particles";

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aParams; // size, alpha, rotation
attribute vec3 aColor;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
varying float vSeed;
void main() {
  vUv = uv;
  vAlpha = aParams.y;
  vColor = aColor;
  vSeed = aParams.z;
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  float c = cos(aParams.z);
  float s = sin(aParams.z);
  vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
  mv.xy += p * aParams.x;
  gl_Position = projectionMatrix * mv;
}
`;

const SMOKE_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
varying float vSeed;
void main() {
  vec2 q = vUv - 0.5;
  float d = length(q) * 2.0;
  float lumps = sin(q.x * 13.0 + vSeed * 3.0) * sin(q.y * 11.0 - vSeed * 2.0) * 0.16;
  float a = smoothstep(1.0, 0.25, d + lumps) * vAlpha;
  if (a < 0.01) discard;
  vec3 col = vColor * (0.82 + 0.4 * vUv.y);
  gl_FragColor = vec4(col, a);
}
`;

const GLOW_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float body = pow(max(0.0, 1.0 - d), 1.7);
  float core = pow(max(0.0, 1.0 - d * 1.8), 3.0);
  float a = body * vAlpha;
  if (a < 0.004) discard;
  vec3 col = vColor * body + vec3(1.0, 0.95, 0.8) * core;
  gl_FragColor = vec4(col * vAlpha, 1.0);
}
`;

/** One draw call for a whole pool. Attributes alias the pool's arrays (zero copy). */
export function makeParticleMesh(pool: ParticlePool, additive: boolean): THREE.Mesh {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
  const aPos = new THREE.InstancedBufferAttribute(pool.pos, 3);
  const aParams = new THREE.InstancedBufferAttribute(pool.params, 3);
  const aColor = new THREE.InstancedBufferAttribute(pool.color, 3);
  for (const a of [aPos, aParams, aColor]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("aPos", aPos);
  geo.setAttribute("aParams", aParams);
  geo.setAttribute("aColor", aColor);
  geo.instanceCount = pool.n;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: additive ? GLOW_FRAG : SMOKE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = additive ? 12 : 10;
  return mesh;
}

export function markParticlesDirty(mesh: THREE.Mesh) {
  const g = mesh.geometry;
  (g.getAttribute("aPos") as THREE.InstancedBufferAttribute).needsUpdate = true;
  (g.getAttribute("aParams") as THREE.InstancedBufferAttribute).needsUpdate = true;
  (g.getAttribute("aColor") as THREE.InstancedBufferAttribute).needsUpdate = true;
}

// --- Labels -----------------------------------------------------------------

const labelCache = new Map<string, THREE.CanvasTexture>();

/** Floating status badge: hazard triangle + headline + status line. Cached per text. */
export function labelTexture(title: string, status: string, color: string): THREE.CanvasTexture {
  const key = `${title}|${status}|${color}`;
  const hit = labelCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 160;
  const g = c.getContext("2d")!;
  // pill
  g.fillStyle = color;
  roundRect(g, 6, 6, 500, 118, 30);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = "#ffffff";
  g.stroke();
  // pointer
  g.beginPath();
  g.moveTo(236, 122);
  g.lineTo(256, 154);
  g.lineTo(276, 122);
  g.closePath();
  g.fillStyle = color;
  g.fill();
  // hazard triangle icon
  g.beginPath();
  g.moveTo(70, 26);
  g.lineTo(114, 102);
  g.lineTo(26, 102);
  g.closePath();
  g.fillStyle = "#ffd21a";
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = "#1a1a1a";
  g.stroke();
  g.fillStyle = "#1a1a1a";
  g.font = "bold 50px system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif";
  g.textAlign = "center";
  g.fillText("!", 70, 96);
  // text
  g.textAlign = "left";
  g.fillStyle = "#ffffff";
  g.font = "900 54px system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif";
  g.fillText(title, 134, 70);
  g.font = "700 28px system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif";
  g.fillStyle = "rgba(255,255,255,0.88)";
  g.fillText(status, 136, 106);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  labelCache.set(key, tex);
  return tex;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// --- Warning triangle geometry (flat, faces +z) -------------------------------

export function triangleGeometry(size: number): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  const h = size * 0.866;
  s.moveTo(-size / 2, 0);
  s.lineTo(size / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}
