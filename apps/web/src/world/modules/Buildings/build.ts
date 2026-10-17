// Builds the skyline meshes from a CityLayout: one InstancedMesh per archetype, plus the Shard and
// Gherkin. Also records, per building group, which instances belong to it (for collapse / rebuild).
import * as THREE from "three";
import type { BodyKind, BoxSpec, CityLayout } from "./layout";
import { GRIDS, makeAwning, makeFacade, makeGherkin, type FacadeGrid, type FacadeKind, type FacadeTextures } from "./textures";

// Scratch objects reused for every matrix (no per-frame allocation anyway, but keeps setup cheap).
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const UP_Q = new THREE.Quaternion();

/** Emissive strength at full night, per facade kind. */
const GLOW: Record<FacadeKind | "gherkin" | "shard", number> = {
  glass: 1.15,
  office: 1.0,
  brick: 0.95,
  stucco: 0.95,
  shopfront: 1.7,
  gherkin: 1.1,
  shard: 1.2,
};

// ---------------------------------------------------------------- shaders

// Per-instance window UVs: tile the facade texture by the instance's real size so windows keep
// their size on any box, snap to whole columns/floors, and shift the pattern per building.
const FACADE_UV = /* glsl */ `
#include <uv_vertex>
#ifdef USE_INSTANCING
{
  vec3 fScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec3 fPos = instanceMatrix[3].xyz;
  vec2 fFace = abs(normal.x) > 0.5 ? vec2(fScale.z, fScale.y) : vec2(fScale.x, fScale.y);
  float fCols = max(1.0, floor(fFace.x / uGrid.x + 0.5));
  float fFloors = max(1.0, floor(fFace.y / uGrid.y + 0.5));
  float fh = fract(sin(dot(fPos.xz + normal.xz * 3.7, vec2(12.9898, 78.233))) * 43758.5453);
  vec2 fOff = vec2(floor(fh * uGrid.z) / uGrid.z, floor(fract(fh * 7.13) * uGrid.w) / uGrid.w);
  vec2 fUv = uv * vec2(fCols / uGrid.z, fFloors / uGrid.w) + fOff;
  if (abs(normal.y) > 0.5) fUv = vec2(0.5 / (uGrid.z * 32.0), 0.5 / (uGrid.w * 32.0)); // roofs: plain wall texel
  #ifdef USE_MAP
  vMapUv = fUv;
  #endif
  #ifdef USE_EMISSIVEMAP
  vEmissiveMapUv = fUv;
  #endif
}
#endif
`;

export function facadeMaterial(g: FacadeGrid, tex: { map: THREE.Texture; emissive?: THREE.Texture }, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: tex.map,
    ...(tex.emissive ? { emissiveMap: tex.emissive, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0 } : {}),
    roughness,
    metalness,
    flatShading: true,
    ...extra,
  });
  const grid = new THREE.Vector4(g.colW, g.floorH, g.nx, g.ny);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGrid = { value: grid };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform vec4 uGrid;")
      .replace("#include <uv_vertex>", FACADE_UV);
  };
  m.customProgramCacheKey = () => "rivet-facade";
  return m;
}

function awningMaterial(stripes: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.85, flatShading: true });
  m.onBeforeCompile = (shader) => {
    // stripe mask (map) picks between cream and the instance colour
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#if defined( USE_COLOR )
  diffuseColor.rgb = mix(vec3(0.97, 0.94, 0.86), vColor.rgb, diffuseColor.r);
#endif`,
    );
  };
  m.customProgramCacheKey = () => "rivet-awning";
  return m;
}

// ---------------------------------------------------------------- geometry

/** Unit pitched-roof prism: base y 0..ridge y 1, ridge along x, footprint 1 x 1. */
function prismGeometry() {
  const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5];
  const R1 = [-0.5, 1, 0], R2 = [0.5, 1, 0];
  const tris = [A, R1, R2, A, R2, B, D, C, R2, D, R2, R1, A, D, R1, B, R2, C];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

function baseBox(w = 1, h = 1, d = 1) {
  return new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
}

/** One instance of an InstancedMesh that belongs to a building group. */
export interface InstRef {
  mesh: THREE.InstancedMesh;
  index: number;
  orig: Float32Array; // the mesh's original instance matrices (shared per mesh)
  prop: boolean; // roof clutter / awnings / roofs: hidden while a building rises, back at the end
}
/** A plain mesh (Shard, Gherkin) that belongs to a building group. */
export interface ObjRef {
  mesh: THREE.Mesh;
  orig: THREE.Matrix4;
}
export interface GroupParts {
  inst: InstRef[];
  objs: ObjRef[];
  color: string; // main body colour, used to tint rubble
}

export interface Built {
  objects: THREE.Object3D[];
  facadeMats: { mat: THREE.MeshStandardMaterial; glow: number }[];
  lightMat: THREE.MeshBasicMaterial;
  groups: GroupParts[]; // index = group id (0 unused)
  dispose: () => void;
}

function instanced(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  n: number,
  fill: (i: number) => string,
  opts: { cast?: boolean; receive?: boolean } = {},
) {
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  for (let i = 0; i < n; i++) {
    const color = fill(i);
    mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    mesh.setColorAt(i, _c.set(color));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = !!opts.cast;
  mesh.receiveShadow = opts.receive ?? true;
  mesh.computeBoundingSphere();
  mesh.frustumCulled = false; // spans the city, and instances move during collapse / rebuild
  return mesh;
}

/** Sets _p/_q/_s for an axis-aligned base-anchored box. */
function boxTransform(b: BoxSpec) {
  _p.set(b.x, b.y, b.z);
  _q.copy(UP_Q);
  _s.set(b.w, b.h, b.d);
  return b.color;
}

export function build(city: CityLayout): Built {
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  const objects: THREE.Object3D[] = [];
  const facadeMats: Built["facadeMats"] = [];
  const groups: GroupParts[] = [];
  for (let g = 0; g <= city.groups; g++) groups.push({ inst: [], objs: [], color: "#9a9a9a" });
  for (const b of city.bodies) if (b.y === 0) groups[b.g].color = b.color;
  /** Registers every instance of a mesh with its group. */
  const track = (mesh: THREE.InstancedMesh, items: readonly { g: number }[], prop = false) => {
    const orig = (mesh.instanceMatrix.array as Float32Array).slice();
    items.forEach((it, index) => groups[it.g].inst.push({ mesh, index, orig, prop }));
    return mesh;
  };

  const box = keep(baseBox());
  const plain = keep(new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }));

  // --- building bodies, one InstancedMesh per archetype
  const bodySettings: Record<BodyKind, { rough: number; metal: number; seed: number }> = {
    glass: { rough: 0.3, metal: 0.15, seed: 11 },
    office: { rough: 0.8, metal: 0, seed: 22 },
    brick: { rough: 0.9, metal: 0, seed: 33 },
    stucco: { rough: 0.85, metal: 0, seed: 44 },
  };
  const textures: Record<string, FacadeTextures> = {};
  for (const kind of Object.keys(bodySettings) as BodyKind[]) {
    const items = city.bodies.filter((b) => b.kind === kind);
    if (!items.length) continue;
    const st = bodySettings[kind];
    const tex = (textures[kind] = makeFacade(kind, st.seed));
    keep(tex.map);
    keep(tex.emissive);
    const mat = keep(facadeMaterial(GRIDS[kind], tex, st.rough, st.metal));
    facadeMats.push({ mat, glow: GLOW[kind] });
    objects.push(track(instanced(box, mat, items.length, (i) => boxTransform(items[i]), { cast: true }), items));
  }

  // --- shopfronts (ground floor glazing, brightest at night)
  if (city.shopfronts.length) {
    const tex = makeFacade("shopfront", 55);
    keep(tex.map);
    keep(tex.emissive);
    const mat = keep(facadeMaterial(GRIDS.shopfront, tex, 0.5));
    facadeMats.push({ mat, glow: GLOW.shopfront });
    objects.push(track(instanced(box, mat, city.shopfronts.length, (i) => boxTransform(city.shopfronts[i])), city.shopfronts));
  }

  // --- trims (parapets, caps, chimneys, podium ledges, plaza) and roof clutter
  if (city.trims.length) objects.push(track(instanced(box, plain, city.trims.length, (i) => boxTransform(city.trims[i]), { cast: true }), city.trims));
  if (city.acs.length) objects.push(track(instanced(box, plain, city.acs.length, (i) => boxTransform(city.acs[i])), city.acs, true));

  if (city.roofs.length) {
    const prism = keep(prismGeometry());
    objects.push(
      track(instanced(prism, plain, city.roofs.length, (i) => {
        const r = city.roofs[i];
        _p.set(r.x, r.y, r.z);
        _q.setFromEuler(_e.set(0, r.ry, 0));
        _s.set(r.w, r.h, r.d);
        return r.color;
      }, { cast: true }), city.roofs, true),
    );
  }

  if (city.tanks.length) {
    const cyl = keep(new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0));
    const cone = keep(new THREE.ConeGeometry(1, 1, 10).translate(0, 0.5, 0));
    objects.push(
      track(instanced(cyl, plain, city.tanks.length, (i) => {
        const t = city.tanks[i];
        _p.set(t.x, t.y, t.z);
        _q.copy(UP_Q);
        _s.set(t.r, t.h, t.r);
        return "#8b6a4a";
      }), city.tanks, true),
      track(instanced(cone, plain, city.tanks.length, (i) => {
        const t = city.tanks[i];
        _p.set(t.x, t.y + t.h, t.z);
        _q.copy(UP_Q);
        _s.set(t.r * 1.1, t.r * 0.7, t.r * 1.1);
        return "#5b4636";
      }), city.tanks, true),
    );
  }

  if (city.antennas.length) {
    const mast = keep(new THREE.CylinderGeometry(0.1, 0.22, 1, 5).translate(0, 0.5, 0));
    objects.push(
      track(instanced(mast, plain, city.antennas.length, (i) => {
        const a = city.antennas[i];
        _p.set(a.x, a.y, a.z);
        _q.copy(UP_Q);
        _s.set(1, a.h, 1);
        return "#d5d9dd";
      }), city.antennas, true),
    );
  }

  // --- awnings: striped, tilted down towards the street
  if (city.awnings.length) {
    const stripes = keep(makeAwning());
    const geo = keep(new THREE.BoxGeometry(1, 0.12, 1.6));
    const mat = keep(awningMaterial(stripes));
    objects.push(
      track(instanced(geo, mat, city.awnings.length, (i) => {
        const a = city.awnings[i];
        _p.set(a.x, a.y, a.z);
        _q.setFromEuler(_e.set(0.38, a.ry, 0, "YXZ"));
        _s.set(a.w, 1, 1);
        return a.color;
      }), city.awnings, true),
    );
  }

  // --- red aviation lights (blink in useFrame)
  const lightMat = keep(new THREE.MeshBasicMaterial({ color: "#ff2a1a", toneMapped: false }));
  if (city.lights.length) {
    const ball = keep(new THREE.SphereGeometry(0.5, 8, 6));
    objects.push(
      track(instanced(ball, lightMat, city.lights.length, (i) => {
        const l = city.lights[i];
        _p.set(l.x, l.y, l.z);
        _q.copy(UP_Q);
        _s.set(1, 1, 1);
        return "#ffffff";
      }, { receive: false }), city.lights, true),
    );
  }

  // --- London nods: the Shard and the Gherkin
  const trackObj = (mesh: THREE.Mesh, g: number) => {
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false; // the destruction controller drives mesh.matrix directly
    groups[g].objs.push({ mesh, orig: mesh.matrix.clone() });
    groups[g].color = lm0Color;
  };
  const lm0Color = "#a9c4d6";
  for (const lm of city.landmarks) {
    if (lm.kind === "shard") {
      const base = textures.glass ?? makeFacade("glass", 11);
      const map = keep(base.map.clone());
      const em = keep(base.emissive.clone());
      map.repeat.set(4, 4.5);
      em.repeat.set(4, 4.5);
      map.needsUpdate = em.needsUpdate = true;
      const mat = keep(new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0, color: "#b7d3e6", roughness: 0.25, metalness: 0.2, flatShading: true }));
      facadeMats.push({ mat, glow: GLOW.shard });
      const R = lm.r * Math.SQRT2;
      const shards: [number, number, number, number, number][] = [
        // radius, height, dx, dz, twist
        [R, lm.h, 0, 0, 0],
        [R * 0.82, lm.h * 0.93, 1.4, -1.1, 0.1],
        [R * 0.7, lm.h * 0.97, -1.2, 1.3, -0.08],
      ];
      for (const [r, h, dx, dz, tw] of shards) {
        const geo = keep(new THREE.ConeGeometry(r, h, 4, 1).rotateY(Math.PI / 4 + tw).translate(0, h / 2, 0));
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(lm.x + dx, 0, lm.z + dz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        trackObj(mesh, lm.g);
        objects.push(mesh);
      }
    } else {
      const tex = makeGherkin(77);
      keep(tex.map);
      keep(tex.emissive);
      tex.map.repeat.set(3, 3);
      tex.emissive.repeat.set(3, 3);
      const pts: THREE.Vector2[] = [];
      const N = 22;
      for (let j = 0; j <= N; j++) {
        const t = j / N;
        pts.push(new THREE.Vector2(Math.max(0.001, lm.r * Math.sin(Math.PI * (0.25 + 0.75 * t))), t * lm.h));
      }
      const geo = keep(new THREE.LatheGeometry(pts, 28));
      const mat = keep(new THREE.MeshStandardMaterial({ map: tex.map, emissiveMap: tex.emissive, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0, roughness: 0.35, metalness: 0.15, flatShading: true }));
      facadeMats.push({ mat, glow: GLOW.gherkin });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(lm.x, 0, lm.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      trackObj(mesh, lm.g);
      objects.push(mesh);
    }
  }

  return {
    objects,
    facadeMats,
    lightMat,
    groups,
    dispose: () => {
      for (const o of objects) if (o instanceof THREE.InstancedMesh) o.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}

