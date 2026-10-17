// Instanced drawing for event vehicles and props. All event vehicles share three instanced meshes
// (boxes, balls, lamps) and all props (barriers, water stations, gantries) share one, so draw calls stay
// flat however big the event is. Per frame: one matrix write per vehicle part, one colour per lamp.
import * as THREE from "three";
import type { LampMode, Part, VehicleSpec } from "./specs";

const CAP = { box: 900, ball: 120, lamp: 420 };

interface Slot {
  mesh: THREE.InstancedMesh;
  index: number;
  local: THREE.Matrix4;
  mode?: LampMode;
  phase: number;
}

export interface VehicleHandle {
  spec: VehicleSpec;
  slots: Slot[];
  visible: boolean;
}

const V = new THREE.Matrix4();
const M = new THREE.Matrix4();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const col = new THREE.Color();

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, name: string) {
  const m = new THREE.InstancedMesh(geo, mat, cap);
  m.name = name;
  m.count = 0;
  m.frustumCulled = false; // instances roam the whole city
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.setColorAt(0, col.set("#ffffff"));
  m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  return m;
}

export class VehicleRenderer {
  readonly group = new THREE.Group();
  private box: THREE.InstancedMesh;
  private ball: THREE.InstancedMesh;
  private lamp: THREE.InstancedMesh;
  private lamps: Slot[] = [];
  private handles: VehicleHandle[] = [];
  private geos: THREE.BufferGeometry[];
  private mats: THREE.Material[];

  constructor() {
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const ballGeo = new THREE.IcosahedronGeometry(0.5, 1);
    const paint = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.55, metalness: 0.15, flatShading: true });
    const glow = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
    this.box = instanced(boxGeo, paint, CAP.box, "events-vehicle-box");
    this.ball = instanced(ballGeo, paint, CAP.ball, "events-vehicle-ball");
    this.lamp = instanced(boxGeo, glow, CAP.lamp, "events-vehicle-lamp");
    this.group.add(this.box, this.ball, this.lamp);
    this.syncVisible();
    this.geos = [boxGeo, ballGeo];
    this.mats = [paint, glow];
  }

  private meshFor(p: Part) {
    return p.shape === "box" ? this.box : p.shape === "ball" ? this.ball : this.lamp;
  }

  /** Add a vehicle (hidden until its first pose). Returns null when out of instances. */
  add(spec: VehicleSpec): VehicleHandle | null {
    const need = { box: 0, ball: 0, lamp: 0 };
    for (const p of spec.parts) need[p.shape]++;
    if (this.box.count + need.box > CAP.box || this.ball.count + need.ball > CAP.ball || this.lamp.count + need.lamp > CAP.lamp) return null;
    const slots: Slot[] = [];
    for (const p of spec.parts) {
      const mesh = this.meshFor(p);
      const index = mesh.count++;
      const local = new THREE.Matrix4().compose(new THREE.Vector3(...p.p), new THREE.Quaternion(), new THREE.Vector3(...p.s));
      const slot: Slot = { mesh, index, local, mode: p.lamp, phase: p.phase ?? 0 };
      mesh.setMatrixAt(index, HIDDEN);
      mesh.setColorAt(index, col.set(p.c));
      slots.push(slot);
      if (p.shape === "lamp") this.lamps.push(slot);
    }
    for (const m of [this.box, this.ball, this.lamp]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    const h: VehicleHandle = { spec, slots, visible: false };
    this.handles.push(h);
    this.syncVisible();
    return h;
  }

  /** Place a vehicle (heading h: 0 = +z). `pitch` tilts nose up (radians), for bumps. */
  setPose(h: VehicleHandle, x: number, y: number, z: number, heading: number, visible = true) {
    h.visible = visible;
    if (!visible) {
      for (const s of h.slots) s.mesh.setMatrixAt(s.index, HIDDEN);
    } else {
      const c = Math.cos(heading);
      const sn = Math.sin(heading);
      V.set(c, 0, sn, x, 0, 1, 0, y, -sn, 0, c, z, 0, 0, 0, 1);
      for (const s of h.slots) {
        M.multiplyMatrices(V, s.local);
        s.mesh.setMatrixAt(s.index, M);
      }
    }
    this.box.instanceMatrix.needsUpdate = true;
    this.ball.instanceMatrix.needsUpdate = true;
    this.lamp.instanceMatrix.needsUpdate = true;
  }

  /** Animate lamps: strobes, party colours. `t` seconds. */
  tick(t: number) {
    if (!this.lamps.length) return;
    const strobe = Math.floor(t * 6) % 4; // double flash: A A B B
    const night = 1;
    for (const s of this.lamps) {
      switch (s.mode) {
        case "blueA":
        case "blueB": {
          const on = s.mode === "blueA" ? strobe < 2 : strobe >= 2;
          const flick = (Math.floor(t * 12 + s.phase * 4) & 1) === 0;
          if (on && flick) col.setRGB(0.35, 0.55, 3.2 * night);
          else col.setRGB(0.03, 0.05, 0.18);
          break;
        }
        case "red":
          col.setRGB(Math.floor(t * 3 + s.phase * 2) % 2 ? 2.4 : 0.2, 0.05, 0.05);
          break;
        case "head":
          col.setRGB(1.6, 1.5, 1.25);
          break;
        case "tail":
          col.setRGB(1.6, 0.08, 0.05);
          break;
        case "amber":
          col.setRGB(1.8, 1.1, 0.15);
          break;
        case "party": {
          const beat = 0.55 + 0.45 * Math.max(0, Math.sin(t * 2 * Math.PI * 2.1)); // ~126 bpm pulse
          col.setHSL((t * 0.25 + s.phase) % 1, 1, 0.55);
          col.multiplyScalar(1.6 * beat);
          break;
        }
        default:
          col.setRGB(1, 1, 1);
      }
      s.mesh.setColorAt(s.index, col);
    }
    if (this.lamp.instanceColor) this.lamp.instanceColor.needsUpdate = true;
  }

  /** Remove every vehicle. */
  clear() {
    this.handles = [];
    this.lamps = [];
    this.box.count = this.ball.count = this.lamp.count = 0;
    this.syncVisible();
  }

  private syncVisible() {
    for (const m of [this.box, this.ball, this.lamp]) m.visible = m.count > 0;
  }

  get drawn() {
    return this.handles.length;
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.box.dispose();
    this.ball.dispose();
    this.lamp.dispose();
  }
}

/** A static prop box: centre, size, yaw, colour. */
export interface Prop {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  h: number;
  c: string;
}

/** Static props (barriers, tables, gantries) in one instanced mesh; rebuilt only when the set changes. */
export class PropRenderer {
  readonly mesh: THREE.InstancedMesh;
  private geo = new THREE.BoxGeometry(1, 1, 1);
  private mat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8, flatShading: true });
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(readonly cap = 1600) {
    this.mesh = instanced(this.geo, this.mat, cap, "events-props");
    this.mesh.receiveShadow = true;
  }

  /** Replace all props (one layer per caller key so a show can update barriers without touching tables). */
  private layers = new Map<string, Prop[]>();

  setLayer(key: string, props: Prop[]) {
    if (props.length) this.layers.set(key, props);
    else this.layers.delete(key);
    this.rebuild();
  }

  clear() {
    this.layers.clear();
    this.rebuild();
  }

  private rebuild() {
    let i = 0;
    for (const props of this.layers.values())
      for (const p of props) {
        if (i >= this.cap) break;
        this.q.setFromAxisAngle(this.up, p.h);
        M.compose(this.v.set(p.x, p.y, p.z), this.q, this.sc.set(p.sx, p.sy, p.sz));
        this.mesh.setMatrixAt(i, M);
        this.mesh.setColorAt(i, col.set(p.c));
        i++;
      }
    this.mesh.count = i;
    this.mesh.visible = i > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}

/** Red-and-white barrier across a road at (x, z), facing along heading h (the road direction). */
export function barrier(x: number, z: number, roadHeading: number, width = 7): Prop[] {
  const out: Prop[] = [];
  const n = 5;
  const seg = width / n;
  const px = Math.cos(roadHeading); // across the road
  const pz = -Math.sin(roadHeading);
  for (let k = 0; k < n; k++) {
    const o = (k - (n - 1) / 2) * seg;
    out.push({ x: x + px * o, y: 0.75, z: z + pz * o, sx: seg * 0.96, sy: 0.32, sz: 0.12, h: roadHeading, c: k % 2 ? "#ffffff" : "#e01e1e" });
  }
  for (const s of [-1, 1]) out.push({ x: x + px * s * width * 0.5, y: 0.45, z: z + pz * s * width * 0.5, sx: 0.12, sy: 0.9, sz: 0.5, h: roadHeading, c: "#333" });
  return out;
}
