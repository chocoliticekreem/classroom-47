// Low-poly meshes for the Chases module, built once from shared primitives (no network assets).
// Local frame for vehicles: front is +z, ground at y = 0.
import * as THREE from "three";
import { policeSide, roofMark } from "../Responders/livery";

const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...extra });

function canvasTex(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const hit = texCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}
const texCache = new Map<string, THREE.CanvasTexture>();

function rivetSide() {
  return canvasTex("rivet-side", 512, 192, (c) => {
    c.fillStyle = "#f6f6f2";
    c.fillRect(0, 0, 512, 192);
    c.fillStyle = "#ff6a1a";
    c.fillRect(0, 120, 512, 30);
    c.font = "bold 72px sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("HAMYWAY", 256, 62);
  });
}

function radial(key: string, inner: string, outer: string) {
  return canvasTex(key, 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
}

export interface Kit {
  box: THREE.BoxGeometry;
  axle: THREE.CylinderGeometry;
  ring: THREE.RingGeometry;
  disc: THREE.CircleGeometry;
  sphere: THREE.SphereGeometry;
  cyl: THREE.CylinderGeometry;
  mats: Record<string, THREE.Material>;
  policeBody: THREE.Material[];
  policeCabin: THREE.Material[];
  vanBody: THREE.Material[];
  disposables: { dispose(): void }[];
}

let kit: Kit | null = null;

export function getKit(): Kit {
  if (kit) return kit;
  const white = std("#f4f4ee");
  const glass = std("#1c2a38", { roughness: 0.25, metalness: 0.3 });
  const dark = std("#1b1b1f");
  const policeTex = new THREE.MeshStandardMaterial({ map: policeSide(), roughness: 0.6 });
  const roof = new THREE.MeshStandardMaterial({ map: roofMark("C9", "#f4f4ee", "#111"), roughness: 0.6 });
  const rivet = new THREE.MeshStandardMaterial({ map: rivetSide(), roughness: 0.6 });
  const shadowMat = new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.3, depthWrite: false });
  const mats: Record<string, THREE.Material> = {
    white, glass, dark, policeTex, roof, rivet, shadow: shadowMat,
    black: std("#121216", { roughness: 0.35, metalness: 0.5 }),
    chrome: std("#b9bec4", { metalness: 0.6, roughness: 0.3 }),
    head: new THREE.MeshBasicMaterial({ color: "#fff6dc", toneMapped: false }),
    tail: new THREE.MeshBasicMaterial({ color: "#ff2a1a", toneMapped: false }),
    hiVis: std("#d8f21a", { emissive: "#7a8a00", emissiveIntensity: 0.25 }),
    skin: std("#e2b48c"),
    hoodie: std("#2a2c33"),
    jeans: std("#2b3b5a"),
    navy: std("#141b2e"),
    heliYellow: std("#f0c814"),
    heliBlack: std("#15161a", { roughness: 0.5, metalness: 0.3 }),
    rotor: std("#2a2a2e"),
    pole: std("#4a4f57", { metalness: 0.4 }),
    lampGlow: new THREE.MeshBasicMaterial({ color: "#ffe2a0", toneMapped: false }),
    camYellow: std("#f2c414"),
    camLens: std("#111"),
    beacon: new THREE.MeshBasicMaterial({ color: "#ff2020", toneMapped: false }),
    spark: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
  };
  const box = new THREE.BoxGeometry(1, 1, 1);
  const axle = new THREE.CylinderGeometry(1, 1, 1, 10).rotateZ(Math.PI / 2);
  const ring = new THREE.RingGeometry(1.4, 1.75, 40).rotateX(-Math.PI / 2);
  const disc = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  const sphere = new THREE.SphereGeometry(1, 10, 8);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
  kit = {
    box, axle, ring, disc, sphere, cyl, mats,
    // box face order: +x, -x, +y, -y, +z, -z
    policeBody: [policeTex, policeTex, white, dark, white, white],
    policeCabin: [glass, glass, roof, glass, glass, glass],
    vanBody: [rivet, rivet, white, dark, white, white],
    disposables: [box, axle, ring, disc, sphere, cyl, ...Object.values(mats)],
  };
  return kit;
}

export function disposeKit() {
  if (!kit) return;
  for (const d of kit.disposables) d.dispose();
  kit = null;
}

function part(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], pos: [number, number, number], scale: [number, number, number], shadow = false) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.scale.set(...scale);
  m.castShadow = shadow;
  return m;
}

function wheels(g: THREE.Group, k: Kit, z: number, r: number, w: number) {
  g.add(part(k.axle, k.mats.dark, [0, r, z], [w, r, r]));
  g.add(part(k.axle, k.mats.dark, [0, r, -z], [w, r, r]));
}

function blob(g: THREE.Group, k: Kit, w: number, l: number) {
  const s = part(k.disc, k.mats.shadow, [0, 0.07, 0], [w * 0.62, 1, l * 0.55]);
  s.renderOrder = 1;
  g.add(s);
}

export interface PoliceParts {
  root: THREE.Group;
  lightL: THREE.MeshStandardMaterial;
  lightR: THREE.MeshStandardMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  own: THREE.Material[];
}

export function buildPolice(): PoliceParts {
  const k = getKit();
  const root = new THREE.Group();
  root.name = "chase-police";
  root.add(part(k.box, k.policeBody, [0, 0.62, 0], [1.85, 0.72, 4.4], true));
  root.add(part(k.box, k.policeCabin, [0, 1.26, -0.25], [1.66, 0.56, 2.3]));
  wheels(root, k, 1.38, 0.36, 2.0);
  for (const x of [0.6, -0.6]) {
    root.add(part(k.box, k.mats.head, [x, 0.7, 2.21], [0.36, 0.14, 0.04]));
    root.add(part(k.box, k.mats.tail, [x, 0.7, -2.21], [0.36, 0.14, 0.04]));
  }
  const light = () =>
    new THREE.MeshStandardMaterial({ color: "#0b1f6e", emissive: "#2b5cff", emissiveIntensity: 0.3, roughness: 0.4, toneMapped: false });
  const lightL = light();
  const lightR = light();
  root.add(part(k.box, lightL, [-0.4, 1.6, -0.1], [0.66, 0.15, 0.34]));
  root.add(part(k.box, lightR, [0.4, 1.6, -0.1], [0.66, 0.15, 0.34]));
  const ringMat = new THREE.MeshBasicMaterial({ color: "#3d6bff", transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const ring = part(k.ring, ringMat, [0, 0.08, 0], [1.6, 1.6, 1.6]);
  ring.renderOrder = 2;
  root.add(ring);
  blob(root, k, 1.85, 4.4);
  root.visible = false;
  return { root, lightL, lightR, ring, ringMat, own: [lightL, lightR, ringMat] };
}

export interface CarParts {
  root: THREE.Group;
  body: THREE.Object3D; // tilts/bounces (kerb, crash)
  hazard: THREE.MeshBasicMaterial; // indicator lamps (hazards after a crash)
  glow: THREE.Mesh | null; // racers: neon underglow
  glowMat: THREE.MeshBasicMaterial | null;
  own: THREE.Material[];
}

function hazardLamps(body: THREE.Group, k: Kit, halfW: number, halfL: number, y: number) {
  const hazard = new THREE.MeshBasicMaterial({ color: "#5a3300", toneMapped: false });
  for (const x of [halfW, -halfW]) for (const z of [halfL - 0.15, -halfL + 0.15]) body.add(part(k.box, hazard, [x, y, z], [0.1, 0.12, 0.14]));
  return hazard;
}

/** The getaway: a fast black saloon, or (for comedy) a stolen white Hamyway van. */
export function buildGetaway(kind: "saloon" | "van"): CarParts {
  const k = getKit();
  const root = new THREE.Group();
  root.name = `chase-getaway-${kind}`;
  const body = new THREE.Group();
  root.add(body);
  let hazard: THREE.MeshBasicMaterial;
  if (kind === "saloon") {
    body.add(part(k.box, k.mats.black, [0, 0.6, 0], [1.86, 0.6, 4.7], true));
    body.add(part(k.box, k.mats.glass, [0, 1.13, -0.2], [1.62, 0.48, 2.3]));
    body.add(part(k.box, k.mats.black, [0, 1.39, -0.2], [1.58, 0.05, 2.1]));
    body.add(part(k.box, k.mats.chrome, [0, 0.5, 2.36], [1.2, 0.2, 0.05]));
    wheels(body, k, 1.5, 0.36, 2.0);
    for (const x of [0.62, -0.62]) {
      body.add(part(k.box, k.mats.head, [x, 0.7, 2.36], [0.4, 0.14, 0.04]));
      body.add(part(k.box, k.mats.tail, [x, 0.72, -2.36], [0.42, 0.14, 0.04]));
    }
    hazard = hazardLamps(body, k, 0.94, 2.35, 0.72);
    blob(root, k, 1.86, 4.7);
  } else {
    body.add(part(k.box, k.vanBody, [0, 1.25, -0.35], [2.0, 1.9, 4.2], true));
    body.add(part(k.box, k.mats.white, [0, 0.85, 2.15], [2.0, 1.1, 0.9]));
    body.add(part(k.box, k.mats.glass, [0, 1.75, 1.75], [1.86, 0.6, 0.12]));
    wheels(body, k, 1.7, 0.4, 2.05);
    for (const x of [0.7, -0.7]) {
      body.add(part(k.box, k.mats.head, [x, 0.9, 2.61], [0.36, 0.16, 0.04]));
      body.add(part(k.box, k.mats.tail, [x, 0.8, -2.46], [0.2, 0.3, 0.04]));
    }
    hazard = hazardLamps(body, k, 1.01, 2.45, 0.9);
    blob(root, k, 2.0, 5.1);
  }
  root.visible = false;
  return { root, body, hazard, glow: null, glowMat: null, own: [hazard] };
}

/** A tuned street racer: low, wide, spoiler, neon underglow. */
export function buildRacer(paint: string, neon: string): CarParts {
  const k = getKit();
  const root = new THREE.Group();
  root.name = "chase-racer";
  const body = new THREE.Group();
  root.add(body);
  const paintMat = std(paint, { roughness: 0.3, metalness: 0.55 });
  body.add(part(k.box, paintMat, [0, 0.5, 0], [1.95, 0.46, 4.3], true));
  body.add(part(k.box, k.mats.glass, [0, 0.93, -0.25], [1.6, 0.42, 1.9]));
  body.add(part(k.box, paintMat, [0, 1.15, -0.25], [1.55, 0.05, 1.7]));
  body.add(part(k.box, k.mats.dark, [0, 1.05, -2.0], [1.9, 0.07, 0.42])); // spoiler wing
  for (const x of [0.75, -0.75]) body.add(part(k.box, k.mats.dark, [x, 0.85, -2.0], [0.07, 0.36, 0.2]));
  wheels(body, k, 1.35, 0.34, 2.08);
  for (const x of [0.62, -0.62]) {
    body.add(part(k.box, k.mats.head, [x, 0.58, 2.16], [0.42, 0.1, 0.04]));
    body.add(part(k.box, k.mats.tail, [x, 0.6, -2.16], [0.5, 0.1, 0.04]));
  }
  const hazard = hazardLamps(body, k, 0.98, 2.1, 0.6);
  const glowMat = new THREE.MeshBasicMaterial({
    color: neon,
    map: radial("neon-glow", "rgba(255,255,255,1)", "rgba(255,255,255,0)"),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const glow = part(k.disc, glowMat, [0, 0.09, 0], [2.6, 1, 4.2]);
  glow.renderOrder = 3;
  root.add(glow);
  blob(root, k, 1.95, 4.3);
  root.visible = false;
  return { root, body, hazard, glow, glowMat, own: [paintMat, hazard, glowMat] };
}

export interface HeliParts {
  root: THREE.Group;
  rotor: THREE.Object3D;
  tailRotor: THREE.Object3D;
  beacon: THREE.Mesh;
  cone: THREE.Mesh;
  coneMat: THREE.ShaderMaterial;
  spot: THREE.Mesh;
  spotMat: THREE.MeshBasicMaterial;
  own: THREE.Material[];
  geos: THREE.BufferGeometry[];
}

/** Police helicopter (black and yellow, NPAS-style) with an additive searchlight cone and ground spot. */
export function buildHeli(): HeliParts {
  const k = getKit();
  const root = new THREE.Group();
  root.name = "chase-heli";
  const body = new THREE.Group();
  root.add(body);
  body.add(part(k.sphere, k.mats.heliBlack, [0, 0, 0.4], [1.3, 1.25, 2.2], true));
  body.add(part(k.box, k.mats.heliYellow, [0, -0.15, 0.2], [2.5, 0.35, 2.6]));
  body.add(part(k.sphere, k.mats.glass, [0, 0.15, 1.9], [0.95, 0.75, 0.9]));
  body.add(part(k.box, k.mats.heliBlack, [0, 0.35, -3.2], [0.35, 0.4, 4.6]));
  body.add(part(k.box, k.mats.heliYellow, [0, 1.0, -5.2], [0.12, 1.4, 0.8]));
  body.add(part(k.box, k.mats.heliBlack, [0, 0.35, -4.9], [1.6, 0.08, 0.5]));
  for (const x of [0.9, -0.9]) body.add(part(k.box, k.mats.dark, [x, -1.45, 0.4], [0.1, 0.1, 3.4]));
  body.add(part(k.box, k.mats.dark, [0, 1.3, 0.3], [0.3, 0.5, 0.3]));
  const beacon = part(k.sphere, k.mats.beacon, [0, -1.25, -0.6], [0.18, 0.18, 0.18]);
  body.add(beacon);
  body.add(part(k.sphere, k.mats.chrome, [0, -1.15, 1.6], [0.3, 0.3, 0.3])); // searchlight pod
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.6, 0.3);
  rotor.add(part(k.box, k.mats.rotor, [0, 0, 0], [11, 0.06, 0.35]));
  rotor.add(part(k.box, k.mats.rotor, [0, 0, 0], [0.35, 0.06, 11]));
  body.add(rotor);
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.25, 1.0, -5.3);
  tailRotor.add(part(k.box, k.mats.rotor, [0, 0, 0], [0.05, 2.0, 0.18]));
  body.add(tailRotor);

  // Searchlight: unit cone, apex at +y (the heli), base at -y (the ground). Additive, fades towards the ground.
  const coneGeo = new THREE.CylinderGeometry(0.02, 1, 1, 24, 1, true);
  const coneMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying float vY;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vY = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vY;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float rim = pow(abs(dot(normalize(vN), normalize(vView))), 1.4);
        float a = uOpacity * (0.25 + 0.75 * vY) * rim;
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.86) * a, a);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.renderOrder = 4;
  cone.frustumCulled = false;
  const spotMat = new THREE.MeshBasicMaterial({
    color: "#fff4d6",
    map: radial("searchlight-spot", "rgba(255,255,255,1)", "rgba(255,255,255,0)"),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const spot = part(k.disc, spotMat, [0, 0.12, 0], [9, 1, 9]);
  spot.renderOrder = 4;
  root.visible = false;
  cone.visible = false;
  spot.visible = false;
  return { root, rotor, tailRotor, beacon, cone, coneMat, spot, spotMat, own: [coneMat, spotMat], geos: [coneGeo] };
}

export interface Figure {
  root: THREE.Group;
}

/** A person: an officer (hi-vis, custodian helmet) or the suspect (hoodie, hands cuffed behind). */
export function buildFigure(kind: "officer" | "suspect"): Figure {
  const k = getKit();
  const root = new THREE.Group();
  root.name = `chase-${kind}`;
  if (kind === "officer") {
    root.add(part(k.cyl, k.mats.navy, [0, 0.4, 0], [0.24, 0.8, 0.24]));
    root.add(part(k.cyl, k.mats.hiVis, [0, 1.12, 0], [0.28, 0.66, 0.28]));
    root.add(part(k.sphere, k.mats.skin, [0, 1.62, 0], [0.19, 0.2, 0.19]));
    root.add(part(k.sphere, k.mats.navy, [0, 1.84, 0], [0.17, 0.26, 0.17]));
  } else {
    root.add(part(k.cyl, k.mats.jeans, [0, 0.4, 0], [0.22, 0.8, 0.22]));
    root.add(part(k.cyl, k.mats.hoodie, [0, 1.12, 0], [0.27, 0.66, 0.27]));
    root.add(part(k.sphere, k.mats.hoodie, [0, 1.62, 0], [0.21, 0.22, 0.21]));
    for (const x of [0.2, -0.2]) {
      const arm = part(k.box, k.mats.hoodie, [x, 1.1, -0.18], [0.1, 0.55, 0.1]);
      arm.rotation.x = 0.5;
      arm.rotation.z = x > 0 ? -0.3 : 0.3;
      root.add(arm);
    }
    root.add(part(k.box, k.mats.chrome, [0, 0.88, -0.36], [0.22, 0.06, 0.06])); // cuffs
  }
  root.visible = false;
  return { root };
}

/** A street lamp, pivoting at its base so it can be knocked over. */
export function buildLamppost(): THREE.Group {
  const k = getKit();
  const g = new THREE.Group();
  g.name = "chase-lamppost";
  g.add(part(k.cyl, k.mats.pole, [0, 3, 0], [0.09, 6, 0.09], true));
  g.add(part(k.box, k.mats.pole, [0, 6, 0.5], [0.08, 0.08, 1.1]));
  g.add(part(k.box, k.mats.lampGlow, [0, 5.9, 1.0], [0.3, 0.12, 0.45]));
  g.visible = false;
  return g;
}

export interface CameraMeshes {
  meshes: THREE.InstancedMesh[];
  flash: THREE.InstancedMesh;
  own: THREE.Material[];
}

/** Speed camera posts: grey pole, yellow box, and an additive flash sprite per post (3 draw calls). */
export function buildCameras(sites: { x: number; z: number; h: number }[]): CameraMeshes {
  const k = getKit();
  const n = Math.max(1, sites.length);
  const pole = new THREE.InstancedMesh(k.cyl, k.mats.pole, n);
  const head = new THREE.InstancedMesh(k.box, k.mats.camYellow, n);
  const flashMat = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    map: radial("cam-flash", "rgba(255,255,255,1)", "rgba(255,255,255,0)"),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const flash = new THREE.InstancedMesh(k.sphere, flashMat, n);
  const o = new THREE.Object3D();
  sites.forEach((s, i) => {
    o.position.set(s.x, 1.8, s.z);
    o.rotation.set(0, s.h, 0);
    o.scale.set(0.11, 3.6, 0.11);
    o.updateMatrix();
    pole.setMatrixAt(i, o.matrix);
    o.position.y = 3.85;
    o.scale.set(0.62, 0.78, 0.82);
    o.updateMatrix();
    head.setMatrixAt(i, o.matrix);
    o.scale.setScalar(0);
    o.updateMatrix();
    flash.setMatrixAt(i, o.matrix);
  });
  pole.count = head.count = flash.count = sites.length;
  for (const m of [pole, head]) {
    m.castShadow = false;
    m.computeBoundingSphere();
  }
  flash.frustumCulled = false;
  flash.renderOrder = 5;
  flash.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pole.name = "chase-cam-pole";
  head.name = "chase-cam-head";
  flash.name = "chase-cam-flash";
  return { meshes: [pole, head, flash], flash, own: [flashMat] };
}

export interface Sparks {
  mesh: THREE.InstancedMesh;
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, r: number, g: number, b: number): void;
  step(dt: number): void;
}

/** Tiny particle pool for ram sparks, crash puffs and smoke (one draw call). */
export function buildSparks(n = 96): Sparks {
  const k = getKit();
  const mesh = new THREE.InstancedMesh(k.sphere, k.mats.spark, n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.name = "chase-sparks";
  const p = new Float32Array(n * 8); // x y z vx vy vz life size
  const maxLife = new Float32Array(n);
  const col = new THREE.Color();
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    m.makeScale(0, 0, 0);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, col.setRGB(1, 1, 1));
  }
  let next = 0;
  let live = 0;
  return {
    mesh,
    emit(x, y, z, vx, vy, vz, life, size, r, g, b) {
      const i = next;
      next = (next + 1) % n;
      const o = i * 8;
      p[o] = x;
      p[o + 1] = y;
      p[o + 2] = z;
      p[o + 3] = vx;
      p[o + 4] = vy;
      p[o + 5] = vz;
      p[o + 6] = life;
      p[o + 7] = size;
      maxLife[i] = life;
      mesh.setColorAt(i, col.setRGB(r, g, b));
      mesh.instanceColor!.needsUpdate = true;
      live = 1.5;
    },
    step(dt) {
      if (live <= 0) return;
      live -= dt;
      for (let i = 0; i < n; i++) {
        const o = i * 8;
        if (p[o + 6] <= 0) {
          m.makeScale(0, 0, 0);
          mesh.setMatrixAt(i, m);
          continue;
        }
        p[o + 6] -= dt;
        p[o + 4] -= 9 * dt * (p[o + 7] < 0.3 ? 1 : -0.05); // sparks fall, puffs drift up
        p[o] += p[o + 3] * dt;
        p[o + 1] = Math.max(0.05, p[o + 1] + p[o + 4] * dt);
        p[o + 2] += p[o + 5] * dt;
        const u = Math.max(0, p[o + 6] / (maxLife[i] || 1));
        const s = p[o + 7] * (p[o + 7] < 0.3 ? u : 1 + (1 - u) * 2.5) * (u > 0 ? 1 : 0);
        m.makeScale(s, s, s);
        m.setPosition(p[o], p[o + 1], p[o + 2]);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
