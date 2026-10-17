// Builds every construction site into a handful of merged static meshes plus instanced moving parts
// (cranes, excavators, dump trucks, hoists, workers, aviation lights) and animates them per frame.
// Client only.
import * as THREE from "three";
import { craneAt, derive, newCraneState, type CraneState, type Derived } from "./crane";
import { Batch, adAtlas, adRect, glazing, scaffoldNet } from "./kit";
import { dumpAt, excavatorAt, hoistY, type DumpPose, type ExcavatorPose } from "./machines";
import {
  APEX_Y, DUMP_HINGE, EXC, beamLoad, bucketLoad, cable, craneHead, dumpBed, dumpChassis, excBase, excBoom, excBucket,
  excStick, excUpper, hoistCage, hookBlock, trolley, workerGeometry, WORKER_SHOULDER,
} from "./parts";
import { FLOOR_H, SLAB_T, type CraneSpec, type SiteLayout } from "./sites";

const CONCRETE = "#b9b7b0";
const CONCRETE_DARK = "#8f8e88";
const CORE = "#a3a19a";
const GRAVEL = "#a39782";
const DIRT = "#6b4f36";
const DIRT_DARK = "#4f3a28";
const RAIL = "#e8c32a";
const FORMWORK = "#c98b45";
const POST = "#2f4f3a";
const STEEL = "#7d828a";

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

// scratch
const mA = new THREE.Matrix4();
const mB = new THREE.Matrix4();
const mC = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const s1 = new THREE.Vector3(1, 1, 1);
const sc = new THREE.Vector3();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** 0 by day, 1 at night, fading at dusk and dawn. */
export function nightLevel(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 19.25 || h < 5.75) return 1;
  if (h >= 17.75) return (h - 17.75) / 1.5;
  if (h < 7.25) return 1 - (h - 5.75) / 1.5;
  return 0;
}

interface CraneRt {
  spec: CraneSpec;
  head: THREE.Mesh;
  d: Derived;
  st: CraneState;
}

function rotY(m: THREE.Matrix4, x: number, y: number, z: number, yaw: number) {
  q.setFromAxisAngle(Y_AXIS, yaw);
  return m.compose(v.set(x, y, z), q, s1);
}

function local(m: THREE.Matrix4, x: number, y: number, z: number, axis: THREE.Vector3, angle: number) {
  q.setFromAxisAngle(axis, angle);
  return m.compose(v.set(x, y, z), q, s1);
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, name: string, shadow = false) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  m.name = `construction-${name}`;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.castShadow = shadow;
  m.receiveShadow = true;
  m.frustumCulled = false; // instances move all over the city
  for (let i = 0; i < m.count; i++) m.setMatrixAt(i, HIDDEN);
  return m;
}

export class ConstructionScene {
  readonly objects: THREE.Object3D[] = [];
  private disposables: { dispose(): void }[] = [];
  private cranes: CraneRt[] = [];
  private trolleys: THREE.InstancedMesh;
  private hooks: THREE.InstancedMesh;
  private cables: THREE.InstancedMesh;
  private beams: THREE.InstancedMesh;
  private buckets: THREE.InstancedMesh;
  private lights: THREE.InstancedMesh;
  private lightMat: THREE.MeshBasicMaterial;
  private exc: Record<"base" | "upper" | "boom" | "stick" | "bucket", THREE.InstancedMesh>;
  private dumpBody: THREE.InstancedMesh;
  private dumpBedM: THREE.InstancedMesh;
  private cages: THREE.InstancedMesh;
  private glassMat!: THREE.MeshStandardMaterial;
  private lampMat: THREE.MeshBasicMaterial;
  private workerTime = { value: 0 };
  private excPose: ExcavatorPose = { yaw: 0, boom: 0, stick: 0, bucket: 0 };
  private dumpPose: DumpPose = { x: 0, z: 0, h: 0, tip: 0, moving: false };
  private moving: THREE.InstancedMesh[] = [];

  constructor(private sites: SiteLayout[]) {
    const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    const vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1, flatShading: true });
    this.disposables.push(solidMat, vc);

    this.buildStatic(solidMat);

    // --- cranes: one merged slewing head per crane, shared instanced trolley/hook/cable/loads/lights
    const all = sites.flatMap((s) => s.cranes);
    for (const spec of all) {
      const geo = craneHead(spec.jib, spec.counterJib, spec.colour);
      const head = new THREE.Mesh(geo, vc);
      head.name = "construction-crane-head";
      head.castShadow = true;
      head.position.set(spec.x, spec.mastH, spec.z);
      head.matrixAutoUpdate = true;
      this.objects.push(head);
      this.disposables.push(geo);
      this.cranes.push({ spec, head, d: derive(spec.plan), st: newCraneState() });
    }
    const n = all.length;
    this.trolleys = this.addInstanced(trolley(), vc, n, "trolley");
    this.hooks = this.addInstanced(hookBlock(), vc, n, "hook");
    this.cables = this.addInstanced(cable(), vc, n, "cable");
    this.beams = this.addInstanced(beamLoad(), vc, n, "beams", true);
    this.buckets = this.addInstanced(bucketLoad(), vc, n, "buckets", true);
    this.lightMat = new THREE.MeshBasicMaterial({ color: "#ff2010", toneMapped: false });
    this.disposables.push(this.lightMat);
    this.lights = this.addInstanced(new THREE.SphereGeometry(0.4, 8, 6), this.lightMat, n * 3, "aviation-lights");

    // --- excavators, dump trucks, hoists
    const k = sites.length;
    this.exc = {
      base: this.addInstanced(excBase(), vc, k, "exc-base"),
      upper: this.addInstanced(excUpper(), vc, k, "exc-upper", true),
      boom: this.addInstanced(excBoom(), vc, k, "exc-boom"),
      stick: this.addInstanced(excStick(), vc, k, "exc-stick"),
      bucket: this.addInstanced(excBucket(), vc, k, "exc-bucket"),
    };
    sites.forEach((s, i) => this.exc.base.setMatrixAt(i, rotY(mA, s.excavator.x, 0, s.excavator.z, s.excavator.digYaw)));
    this.dumpBody = this.addInstanced(dumpChassis(), vc, k, "dump-body", true);
    this.dumpBedM = this.addInstanced(dumpBed(), vc, k, "dump-bed");
    this.cages = this.addInstanced(hoistCage(), vc, k, "hoist-cage");
    this.moving = [
      this.trolleys, this.hooks, this.cables, this.beams, this.buckets, this.lights, this.dumpBody, this.dumpBedM, this.cages,
      this.exc.upper, this.exc.boom, this.exc.stick, this.exc.bucket,
    ];

    // --- workers (GPU hammering)
    const workers = sites.flatMap((s) => [...s.workers, ...s.groundWorkers]);
    const wMat = this.workerMaterial();
    const wMesh = this.addInstanced(workerGeometry(), wMat, workers.length, "workers");
    wMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    workers.forEach((w, i) => wMesh.setMatrixAt(i, rotY(mA, w.x, w.y, w.z, w.yaw)));
    wMesh.frustumCulled = true;
    wMesh.computeBoundingSphere();

    // floodlight lamps glow at night
    this.lampMat = new THREE.MeshBasicMaterial({ color: "#55534a", toneMapped: false });
    this.disposables.push(this.lampMat);
    const lamps = new Batch();
    for (const s of sites)
      for (const f of s.floodlights) {
        const dx = Math.sign(s.spec.x - f.x) || 1;
        lamps.box(f.x + dx * 0.3, 9.2, f.z, 1.4, 0.5, 0.5, "#ffffff", f.yaw);
      }
    this.addStatic(lamps.build(), this.lampMat, "lamps");
  }

  private addInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, name: string, shadow = false) {
    const m = instanced(geo, mat, n, name, shadow);
    this.objects.push(m);
    this.disposables.push(geo);
    return m;
  }

  private addStatic(geo: THREE.BufferGeometry, mat: THREE.Material, name: string, cast = false) {
    const m = new THREE.Mesh(geo, mat);
    m.name = `construction-${name}`;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    this.objects.push(m);
    this.disposables.push(geo);
    return m;
  }

  private workerMaterial() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true });
    const uTime = this.workerTime;
    const [sx, sy, sz] = WORKER_SHOULDER;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nattribute float aFlag;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
#ifdef USE_INSTANCING
  float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.71;
#else
  float ph = 0.0;
#endif
  float sw = 0.5 + 0.5 * sin(uTime * (6.0 + fract(ph) * 2.0) + ph * 6.2831);
  float a = aFlag * (-0.6 - 1.7 * pow(sw, 0.7));
  vec3 piv = vec3(${sx.toFixed(3)}, ${sy.toFixed(3)}, ${sz.toFixed(3)});
  vec3 r = transformed - piv;
  float ca = cos(a);
  float sa = sin(a);
  transformed = piv + vec3(r.x, r.y * ca - r.z * sa, r.y * sa + r.z * ca);
  transformed.y -= 0.03 * (1.0 - sw); // a little dip into each blow`,
        );
    };
    mat.customProgramCacheKey = () => "construction-worker";
    this.disposables.push(mat);
    return mat;
  }

  // --- static geometry ------------------------------------------------------------------------------

  private buildStatic(solidMat: THREE.Material) {
    const solid = new Batch();
    const glass = new Batch();
    const ads = new Batch();
    const net = new Batch();
    let adI = 0;

    for (const s of this.sites) {
      const yaw = s.yaw;
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const t = s.tower;
      // tower-local (lx along w, lz along d) -> world
      const tx = (lx: number, lz: number) => t.x + lx * cy + lz * sy;
      const tz = (lx: number, lz: number) => t.z - lx * sy + lz * cy;

      // ground: gravel yard, excavation pit, spoil mound
      const b = s.box;
      solid.box((b.minX + b.maxX) / 2, 0.02, (b.minZ + b.maxZ) / 2, b.maxX - b.minX, 0.04, b.maxZ - b.minZ, GRAVEL);
      const pitGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
      solid.place(pitGeo, s.pit.x, 0.03, s.pit.z, DIRT, 0, s.pit.r, 0.06, s.pit.r);
      solid.place(pitGeo, s.pit.x, 0.04, s.pit.z, DIRT_DARK, 0, s.pit.r * 0.7, 0.07, s.pit.r * 0.7);
      const cone = new THREE.ConeGeometry(1, 1, 9);
      solid.place(cone, s.mound.x, 0.8, s.mound.z, DIRT, 0.4, s.mound.r, 1.6, s.mound.r);
      solid.place(cone, s.pit.x + s.pit.r * 0.2, 0.5, s.pit.z - s.pit.r * 1.15, DIRT, 1.1, 1.6, 1.0, 1.6);

      // tower: slabs, columns, core, rails, starter bars
      const hw = t.w / 2;
      const hd = t.d / 2;
      for (let k = 1; k <= t.floors; k++) {
        const y = k * FLOOR_H + SLAB_T / 2;
        solid.box(t.x, y, t.z, t.w + 0.5, SLAB_T, t.d + 0.5, k === t.floors ? CONCRETE : CONCRETE_DARK, yaw);
      }
      const nx = Math.max(2, Math.round(t.w / 4.5));
      const nz = Math.max(2, Math.round(t.d / 4.5));
      const cols: [number, number][] = [];
      for (let i = 0; i <= nx; i++)
        for (let j = 0; j <= nz; j++) {
          const edge = i === 0 || j === 0 || i === nx || j === nz;
          if (!edge && (i + j) % 2 === 1) continue;
          cols.push([-hw + 0.4 + ((t.w - 0.8) * i) / nx, -hd + 0.4 + ((t.d - 0.8) * j) / nz]);
        }
      for (let k = t.glazed; k < t.floors; k++) {
        const y0 = k * FLOOR_H + (k === 0 ? 0 : SLAB_T);
        const h = (k + 1) * FLOOR_H - y0;
        for (const [lx, lz] of cols) solid.box(tx(lx, lz), y0 + h / 2, tz(lx, lz), 0.5, h, 0.5, CONCRETE, yaw);
      }
      // starter columns + formwork on the top slab (the next floor going up)
      const top = t.topY + SLAB_T;
      cols.forEach(([lx, lz], i) => {
        if (i % 2 === 0) solid.box(tx(lx, lz), top + 0.9, tz(lx, lz), 0.5, 1.8, 0.5, CONCRETE, yaw);
        else solid.box(tx(lx, lz), top + 1.5, tz(lx, lz), 0.7, 3.0, 0.7, FORMWORK, yaw);
      });
      solid.box(tx(hw * 0.4, -hd * 0.45), top + 0.06, tz(hw * 0.4, -hd * 0.45), hw * 0.7, 0.12, hd * 0.5, FORMWORK, yaw);
      // core runs ahead of the floors, with a yellow jump-form on top
      const coreTop = t.topY + FLOOR_H * 1.6;
      solid.box(t.x, coreTop / 2, t.z, t.coreW, coreTop, t.coreD, CORE, yaw);
      solid.box(t.x, coreTop + 1.6, t.z, t.coreW + 0.9, 3.2, t.coreD + 0.9, "#e0b030", yaw);
      // edge-protection rails on the bare floors
      for (let k = t.glazed + 1; k < t.screenFrom; k++) {
        const y = k * FLOOR_H + SLAB_T + 1.0;
        solid.box(tx(0, -hd - 0.15), y, tz(0, -hd - 0.15), t.w + 0.3, 0.08, 0.08, RAIL, yaw);
        solid.box(tx(0, hd + 0.15), y, tz(0, hd + 0.15), t.w + 0.3, 0.08, 0.08, RAIL, yaw);
        solid.box(tx(-hw - 0.15, 0), y, tz(-hw - 0.15, 0), 0.08, 0.08, t.d + 0.3, RAIL, yaw);
        solid.box(tx(hw + 0.15, 0), y, tz(hw + 0.15, 0), 0.08, 0.08, t.d + 0.3, RAIL, yaw);
      }
      // glazed lower floors
      for (let k = 0; k < t.glazed; k++) {
        const y0 = k * FLOOR_H + (k === 0 ? 0 : SLAB_T);
        const h = (k + 1) * FLOOR_H - y0;
        glass.box(t.x, y0 + h / 2, t.z, t.w - 0.1, h, t.d - 0.1, "#ffffff", yaw);
      }
      // scaffold + netting screens around the top floors
      const sy0 = t.screenFrom * FLOOR_H;
      const sy1 = top + 1.8;
      const o = 1.2;
      const corners: [number, number][] = [[-hw - o, -hd - o], [hw + o, -hd - o], [hw + o, hd + o], [-hw - o, hd + o]];
      for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i];
        const [bx, bz] = corners[(i + 1) % 4];
        const len = Math.hypot(bx - ax, bz - az);
        net.wall(tx(ax, az), tz(ax, az), tx(bx, bz), tz(bx, bz), sy0, sy1, "#ffffff", len / 2.5, (sy1 - sy0) / 2);
      }
      // construction hoist: mast tied to the tower + a landing gate at the top
      solid.box(s.hoist.x, s.hoist.top / 2 + 1, s.hoist.z + 0, 0.7, s.hoist.top + 2, 0.7, STEEL, yaw);

      // tower crane masts (lattice) and footings
      for (const c of s.cranes) this.mast(solid, c);

      // hoarding with ads (gap at the gate), posts
      this.hoarding(solid, ads, s, () => adI++);

      // site cabins (stacked portakabins) with windows
      for (const c of s.cabins) {
        const y = c.level * 2.65 + 1.3;
        solid.box(c.x, y, c.z, 6, 2.6, 2.5, c.colour, c.yaw);
        const fx = Math.sin(c.yaw);
        const fz = Math.cos(c.yaw);
        for (const off of [-1.6, 1.2])
          solid.box(c.x + Math.cos(c.yaw) * off + fx * 1.26, y + 0.25, c.z - Math.sin(c.yaw) * off + fz * 1.26, 1.4, 0.8, 0.04, "#22313d", c.yaw);
        if (c.level === 1) solid.box(c.x, y + 1.35, c.z, 6.1, 0.1, 2.6, "#d0d0cc", c.yaw);
      }

      // material piles
      for (const p of s.piles) {
        const ca = Math.cos(p.yaw);
        const sa = Math.sin(p.yaw);
        const at = (lx: number, lz: number): [number, number] => [p.x + lx * ca + lz * sa, p.z - lx * sa + lz * ca];
        if (p.kind === "beams") {
          for (let layer = 0; layer < 2; layer++)
            for (let i = -2; i <= 2; i++) {
              const [x, z] = at(0, i * 0.42);
              solid.box(x, 0.1 + layer * 0.3 + 0.15, z, 6, 0.3, 0.22, "#a0402a", p.yaw);
            }
          for (const lx of [-2, 2]) {
            const [x, z] = at(lx, 0);
            solid.box(x, 0.06, z, 0.2, 0.12, 2.4, "#8a6a40", p.yaw);
          }
        } else if (p.kind === "rebar") {
          for (let i = 0; i < 14; i++) {
            const [x, z] = at(((i * 37) % 7) * 0.05 - 0.15, (i % 7) * 0.13 - 0.4);
            solid.box(x, 0.06 + Math.floor(i / 7) * 0.08, z, 5, 0.06, 0.06, "#8a4b2a", p.yaw);
          }
          for (let i = 0; i < 6; i++) {
            const [x, z] = at(-1 + i * 0.35, 0.75);
            solid.box(x, 0.55, z, 0.05, 1.1, 0.05, "#8a4b2a", p.yaw);
          }
        } else {
          const skip = new THREE.CylinderGeometry(0.75, 0.45, 1.3, 10);
          for (const lx of [-1.6, 1.6]) {
            const [x, z] = at(lx, 0);
            solid.place(skip, x, 0.65, z, "#8d8f93");
          }
          skip.dispose();
        }
      }

      // floodlight masts
      for (const f of s.floodlights) solid.box(f.x, 4.6, f.z, 0.25, 9.2, 0.25, "#3a3c40");

      pitGeo.dispose();
      cone.dispose();
    }

    this.addStatic(solid.build(), solidMat, "structure", true);

    const { map, emissive } = glazing();
    this.glassMat = new THREE.MeshStandardMaterial({
      map, emissiveMap: emissive, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0, roughness: 0.25, metalness: 0.35,
    });
    this.disposables.push(map, emissive, this.glassMat);
    this.addStatic(glass.build(), this.glassMat, "glazing", true);

    const atlas = adAtlas();
    const adMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.8 });
    this.disposables.push(atlas, adMat);
    this.addStatic(ads.build(), adMat, "hoarding");

    const netTex = scaffoldNet();
    const netMat = new THREE.MeshStandardMaterial({ map: netTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 });
    this.disposables.push(netTex, netMat);
    this.addStatic(net.build(), netMat, "scaffold");
  }

  private mast(b: Batch, c: CraneSpec) {
    const h = c.mastH;
    const w = 0.95;
    b.box(c.x, 0.5, c.z, 5, 1, 5, "#8f8e88");
    const col = c.colour === "red" ? "#d22f27" : "#f2b705";
    const corners: [number, number][] = [[-w, -w], [w, -w], [w, w], [-w, w]];
    for (const [x, z] of corners) b.member(c.x + x, 1, c.z + z, c.x + x, h, c.z + z, 0.2, col);
    const step = 2.4;
    for (let y = 1, n = 0; y < h - 0.1; y += step, n++) {
      const y2 = Math.min(h, y + step);
      for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i];
        const [bx, bz] = corners[(i + 1) % 4];
        const flip = (n + i) % 2 === 0;
        b.member(c.x + ax, flip ? y : y2, c.z + az, c.x + bx, flip ? y2 : y, c.z + bz, 0.09, col);
        b.member(c.x + ax, y, c.z + az, c.x + bx, y, c.z + bz, 0.08, col);
      }
    }
    // ladder platform rests every ~20 m
    for (let y = 20; y < h - 4; y += 20) b.box(c.x, y, c.z, 2.6, 0.1, 2.6, STEEL);
  }

  private hoarding(solid: Batch, ads: Batch, s: SiteLayout, next: () => number) {
    const b = s.box;
    const g = s.gate;
    const H = 2.4;
    const runs: [number, number, number, number][] = [
      [b.minX, b.minZ, b.maxX, b.minZ], [b.maxX, b.minZ, b.maxX, b.maxZ],
      [b.maxX, b.maxZ, b.minX, b.maxZ], [b.minX, b.maxZ, b.minX, b.minZ],
    ];
    for (const [ax, az, bx, bz] of runs) {
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      const yaw = Math.atan2(dz, dx) * -1; // box local x along the run
      const n = Math.max(1, Math.round(len / 4.8));
      const seg = len / n;
      for (let i = 0; i < n; i++) {
        const mx = ax + dx * seg * (i + 0.5);
        const mz = az + dz * seg * (i + 0.5);
        if (Math.abs((mx - g.x) * g.tx + (mz - g.z) * g.tz) < g.width / 2 + seg / 2 - 0.5 && Math.abs((mx - g.x) * g.nx + (mz - g.z) * g.nz) < 0.5)
          continue; // the gate
        ads.box(mx, H / 2 + 0.05, mz, seg - 0.08, H, 0.12, "#ffffff", yaw, { rect: adRect(next() % 4) });
        solid.box(ax + dx * seg * i, 1.3, az + dz * seg * i, 0.16, 2.6, 0.16, POST);
      }
    }
    // gate posts with a sign bar
    for (const k of [-1, 1])
      solid.box(g.x + g.tx * (g.width / 2) * k, 1.6, g.z + g.tz * (g.width / 2) * k, 0.3, 3.2, 0.3, "#ff6a1a");
  }

  // --- per frame ------------------------------------------------------------------------------------

  private clock = 0;

  /** Advance the site clock by dt seconds (call only when not paused) and animate. */
  tick(dt: number, night: number) {
    this.clock += dt;
    this.update(this.clock, night);
  }

  update(t: number, night: number) {
    this.workerTime.value = t;
    let i = 0;
    for (const c of this.cranes) {
      const st = craneAt(c.spec.plan, c.d, t + c.spec.offset, c.st);
      const { x, z, mastH } = c.spec;
      c.head.rotation.y = st.slew;
      rotY(mA, x, mastH, z, st.slew); // crane frame
      this.trolleys.setMatrixAt(i, mB.multiplyMatrices(mA, local(mC, st.radius, 0.6, 0, Y_AXIS, 0)));
      const cableTop = mastH + 0.3;
      const hookTop = st.hookY + 1.2;
      // cable hangs straight down from the trolley
      const len = Math.max(0.1, cableTop - hookTop);
      const hx = x + Math.cos(st.slew) * st.radius;
      const hz = z - Math.sin(st.slew) * st.radius;
      q.setFromAxisAngle(Y_AXIS, st.slew);
      this.cables.setMatrixAt(i, mB.compose(v.set(hx, cableTop, hz), q, sc.set(1, len, 1)));
      this.hooks.setMatrixAt(i, mB.compose(v.set(hx, st.hookY, hz), q, s1));
      // load: on the hook, or left on the slab until the hook is back at the pick
      const loadM = st.placed
        ? mB.compose(v.set(c.spec.plan.drop.x, c.spec.plan.drop.y, c.spec.plan.drop.z), q.setFromAxisAngle(Y_AXIS, c.d.dropA), s1)
        : mB.compose(v.set(hx, st.hookY, hz), q, s1);
      if (c.spec.load === "beam") {
        this.beams.setMatrixAt(i, loadM);
        this.buckets.setMatrixAt(i, HIDDEN);
      } else {
        this.buckets.setMatrixAt(i, loadM);
        this.beams.setMatrixAt(i, HIDDEN);
      }
      // aviation lights: apex, jib tip, counter-jib tail
      this.lights.setMatrixAt(i * 3, mB.multiplyMatrices(mA, local(mC, 0, APEX_Y + 0.45, 0, Y_AXIS, 0)));
      this.lights.setMatrixAt(i * 3 + 1, mB.multiplyMatrices(mA, local(mC, c.spec.jib + 0.2, 2.9, 0, Y_AXIS, 0)));
      this.lights.setMatrixAt(i * 3 + 2, mB.multiplyMatrices(mA, local(mC, -c.spec.counterJib, 2.6, 0, Y_AXIS, 0)));
      i++;
    }
    // blink: 1 s period, on 40%
    const on = (t % 1.2) < 0.5;
    const k = on ? 0.6 + night * 3.4 : 0.12;
    this.lightMat.color.setRGB(k, k * 0.08, k * 0.04);

    for (let j = 0; j < this.sites.length; j++) {
      const s = this.sites[j];
      // excavator
      const e = s.excavator;
      const p = excavatorAt(e.digYaw, e.dumpYaw, t + e.offset, this.excPose);
      rotY(mA, e.x, EXC.upperY, e.z, p.yaw);
      this.exc.upper.setMatrixAt(j, mA);
      const [px, py, pz] = EXC.boomPivot;
      mB.multiplyMatrices(mA, local(mC, px, py, pz, X_AXIS, -p.boom));
      this.exc.boom.setMatrixAt(j, mB);
      mA.multiplyMatrices(mB, local(mC, 0, 0, EXC.boomLen, X_AXIS, p.stick));
      this.exc.stick.setMatrixAt(j, mA);
      mB.multiplyMatrices(mA, local(mC, 0, 0, EXC.stickLen, X_AXIS, p.bucket - 0.6));
      this.exc.bucket.setMatrixAt(j, mB);

      // dump truck
      const d = dumpAt(s.dump, t + s.dump.offset, this.dumpPose);
      const bounce = d.moving ? Math.sin(t * 9 + j) * 0.03 : 0;
      rotY(mA, d.x, bounce, d.z, d.h);
      this.dumpBody.setMatrixAt(j, mA);
      const [hxL, hyL, hzL] = DUMP_HINGE;
      this.dumpBedM.setMatrixAt(j, mB.multiplyMatrices(mA, local(mC, hxL, hyL, hzL, X_AXIS, -d.tip * 0.85)));

      // hoist cage
      const y = hoistY(s.hoist.top - 1, t + s.hoist.offset);
      const fx = Math.sin(s.yaw);
      const fz = Math.cos(s.yaw);
      this.cages.setMatrixAt(j, rotY(mA, s.hoist.x + fx * 1.2, y, s.hoist.z + fz * 1.2, s.yaw));
    }

    for (const m of this.moving) m.instanceMatrix.needsUpdate = true;
  }

  /** Call when the hour changes (not every frame). */
  setNight(night: number) {
    this.glassMat.emissiveIntensity = night * 1.1;
    const l = 0.3 + night * 2.6;
    this.lampMat.color.setRGB(l, l * 0.97, l * 0.85);
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }
}
