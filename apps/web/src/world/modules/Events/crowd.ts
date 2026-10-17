// Event crowds on the GPU, reusing the Crowds module's shader (positions along packed path loops from a
// uTime uniform; static figures when aWalk.x = -1). One layer = shared uniforms + a few instanced meshes:
// people, hand props (flags / placards, riding on the same attributes) and stewards/police.
import * as THREE from "three";
import { personTris, PART } from "../Crowds/meshes";
import { packPaths, type WalkPath } from "../Crowds/paths";
import { crowdMaterial, crowdUniforms, type CrowdUniforms } from "../Crowds/shader";
import type { Attrs } from "../Crowds/population";

export const KIND = { walker: 0, jogger: 1, loiterer: 5 } as const;

// sRGB hex -> linear rgb (the shader takes linear colours straight from the attributes)
export function lin(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}

/** Collects per-person attributes. */
export class People {
  aWalk: number[] = [];
  aLook: number[] = [];
  aShirt: number[] = [];
  aPants: number[] = [];

  get count() {
    return this.aWalk.length / 4;
  }

  /** Someone walking path `pathId` from `s0` at `speed` m/s, `lateral` metres off its centre line. */
  walker(pathId: number, s0: number, speed: number, lateral: number, kind: number, shirt: string, pants: string, rand: () => number, scale = 1) {
    this.aWalk.push(pathId, s0, speed, rand() * 6.28);
    this.aLook.push(lateral, kind, scale * (0.92 + rand() * 0.16), rand() * 6.28);
    this.aShirt.push(...lin(shirt), rand());
    this.aPants.push(...lin(pants), rand());
  }

  /** Someone standing at (x, z) on ground y, facing yaw (0 = +z). */
  stander(x: number, z: number, y: number, yaw: number, kind: number, shirt: string, pants: string, rand: () => number, scale = 1) {
    this.aWalk.push(-1, x, z, yaw);
    this.aLook.push(y, kind, scale * (0.92 + rand() * 0.16), rand() * 6.28);
    this.aShirt.push(...lin(shirt), rand());
    this.aPants.push(...lin(pants), rand());
  }

  /** Copy person i's placement with a new colour (for a prop that rides on them). */
  copyOf(src: People, i: number, colour: string, kind?: number) {
    this.aWalk.push(...src.aWalk.slice(i * 4, i * 4 + 4));
    const look = src.aLook.slice(i * 4, i * 4 + 4);
    if (kind !== undefined) look[1] = kind;
    this.aLook.push(...look);
    this.aShirt.push(...lin(colour), 0);
    this.aPants.push(0.3, 0.2, 0.1, 1);
  }

  attrs(): Attrs {
    return {
      count: this.count,
      aWalk: Float32Array.from(this.aWalk),
      aLook: Float32Array.from(this.aLook),
      aShirt: Float32Array.from(this.aShirt),
      aPants: Float32Array.from(this.aPants),
    };
  }
}

/**
 * A flag held in the right hand. In the rest pose the arm hangs down, so the staff points down from the
 * hand; the waving gesture swings the arm up overhead and the flag with it. All arm parts (coloured by aShirt).
 */
function flagGeometry() {
  const t = personTris();
  t.pos.length = 0;
  t.part.length = 0;
  const hx = -0.27;
  t.box(hx - 0.02, hx + 0.02, -0.1, 0.85, -0.02, 0.02, PART.armR, false); // staff
  t.box(hx - 0.015, hx + 0.015, -0.1, 0.32, 0.02, 0.62, PART.armR, true, true); // cloth
  return t.geometry();
}

/** A placard on a stick, carried above the head (board = torso colour, stick = hair colour). */
function placardGeometry() {
  const t = personTris();
  t.pos.length = 0;
  t.part.length = 0;
  t.box(-0.025, 0.025, 1.3, 2.25, 0.2, 0.25, PART.hair, false);
  t.box(-0.42, 0.42, 2.05, 2.62, 0.17, 0.21, PART.torso, true, true);
  return t.geometry();
}

/** Same as the Crowds person material, but loiterers wave overhead most of the time (flags, cheering). */
function wavingMaterial(u: CrowdUniforms) {
  const m = crowdMaterial("person", u);
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    base.call(m, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("step(0.6, sin(uTime * 0.35 + aLook.w))", "step(-0.35, sin(uTime * 0.7 + aLook.w))")
      .replace("(-0.5 - 0.35 * sin(uTime * 3.0 + aLook.w * 2.0))", "(-2.3 - 0.5 * sin(uTime * 7.0 + aLook.w * 2.0))");
  };
  m.customProgramCacheKey = () => "events-crowd-wave";
  return m;
}

function emptyAttrs(): Attrs {
  return { count: 0, aWalk: new Float32Array(4), aLook: new Float32Array(4), aShirt: new Float32Array(4), aPants: new Float32Array(4) };
}

class Layer {
  readonly mesh: THREE.InstancedMesh;
  constructor(private readonly geo: THREE.BufferGeometry, mat: THREE.Material, readonly cap: number, name: string) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = name;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.set(emptyAttrs());
  }

  set(a: Attrs) {
    const n = Math.min(a.count, this.cap);
    const put = (name: string, src: Float32Array) => {
      let attr = this.geo.getAttribute(name) as THREE.InstancedBufferAttribute | undefined;
      if (!attr || attr.count < this.cap) {
        attr = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 4), 4);
        this.geo.setAttribute(name, attr);
      }
      (attr.array as Float32Array).set(src.subarray(0, n * 4));
      attr.needsUpdate = true;
    };
    put("aWalk", a.aWalk);
    put("aLook", a.aLook);
    put("aShirt", a.aShirt);
    put("aPants", a.aPants);
    this.mesh.count = n;
    this.mesh.visible = n > 0;
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

/** One event crowd: people + hand props + stewards, sharing path textures and a clock. */
export class CrowdLayer {
  readonly group = new THREE.Group();
  readonly uniforms: CrowdUniforms;
  readonly people: Layer;
  readonly props: Layer;
  readonly placards: Layer;
  readonly stewards: Layer;

  constructor(name: string, cap = { people: 3200, props: 1200, placards: 400, stewards: 240 }) {
    this.uniforms = crowdUniforms(packPaths([dummyPath()]), 700, 1000);
    this.people = new Layer(personTris().geometry(), wavingMaterial(this.uniforms), cap.people, `${name}-people`);
    this.props = new Layer(flagGeometry(), wavingMaterial(this.uniforms), cap.props, `${name}-flags`);
    this.placards = new Layer(placardGeometry(), crowdMaterial("person", this.uniforms), cap.placards, `${name}-placards`);
    this.stewards = new Layer(personTris().geometry(), crowdMaterial("person", this.uniforms), cap.stewards, `${name}-stewards`);
    for (const l of [this.people, this.props, this.placards, this.stewards]) {
      l.mesh.receiveShadow = true;
      this.group.add(l.mesh);
    }
  }

  /** Swap in a new set of walking loops (path ids are their indices). */
  setPaths(paths: WalkPath[]) {
    const fresh = crowdUniforms(packPaths(paths.length ? paths : [dummyPath()]));
    this.uniforms.uPathTex.value.dispose();
    this.uniforms.uHeadTex.value.dispose();
    this.uniforms.uPathTex.value = fresh.uPathTex.value;
    this.uniforms.uHeadTex.value = fresh.uHeadTex.value;
    this.uniforms.uTime.value = 0;
  }

  tick(dt: number) {
    this.uniforms.uTime.value += dt;
  }

  /** Everyone sits down (protest sit-in) or stands up: squash the people layers. */
  setSitting(on: boolean) {
    for (const l of [this.people, this.placards]) {
      l.mesh.scale.y = on ? 0.55 : 1;
      l.mesh.updateMatrix();
    }
  }

  clear() {
    const e = emptyAttrs();
    this.people.set(e);
    this.props.set(e);
    this.placards.set(e);
    this.stewards.set(e);
    this.setSitting(false);
  }

  get count() {
    return this.people.mesh.count + this.stewards.mesh.count;
  }

  dispose() {
    for (const l of [this.people, this.props, this.placards, this.stewards]) l.dispose();
    this.uniforms.uPathTex.value.dispose();
    this.uniforms.uHeadTex.value.dispose();
  }
}

/** A walking loop for event crowds (y: ground height; downtown sidewalks are raised). */
export function eventPath(corners: number[], y = 0.06): WalkPath {
  return { kind: "street", corners, chain: [], zone: "downtown", weight: 1, y, lateral: 0 };
}

function dummyPath(): WalkPath {
  return eventPath([0, -5000, 1, -5000, 1, -5001, 0, -5001], -50);
}
