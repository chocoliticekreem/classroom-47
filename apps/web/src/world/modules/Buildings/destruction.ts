// Collapse / rebuild controller for damage zones. Driven by Buildings.tsx:
//   sync(damage) whenever store.damage changes (low frequency),
//   update(dt) every frame (instance matrices only, no allocation, no store writes except on finish).
import * as THREE from "three";
import type { DamageZone } from "../../store";
import { facadeMaterial, type Built } from "./build";
import {
  COLLAPSE_S,
  collapsePose,
  groupFootprints,
  groupsInCircle,
  rebuildFraction,
  rebuildSchedule,
  type Footprint,
} from "./damage";
import { mulberry32, type CityLayout } from "./layout";

const Mode = {
  Idle: 0,
  Collapsing: 1,
  Down: 2,
  Waiting: 3, // rebuild scheduled, not started yet
  Rising: 4,
} as const;

const DUST_POOL = 420;
const RUBBLE_POOL = 900;
const PILE_POOL = 140;
const SCAFFOLD_POOL = 140;

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
const _P = new THREE.Matrix4();
const _R = new THREE.Matrix4();
const _T = new THREE.Matrix4();
const _axis = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const RUBBLE_GREY = new THREE.Color("#8a8580");

interface ZoneTrack {
  groups: number[];
  rebuilding: boolean;
}

function scaffoldTexture() {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(46, 120, 110, 0.55)"; // green safety netting
  g.fillRect(0, 0, S, S);
  g.fillStyle = "rgba(255, 255, 255, 0.12)";
  for (let k = 0; k < S; k += 4) g.fillRect(0, k, S, 1);
  g.fillStyle = "#c9c2b0"; // poles and ledgers
  g.fillRect(8, 0, 3, S);
  g.fillRect(40, 0, 3, S);
  g.fillRect(0, 20, S, 3);
  g.fillStyle = "#ff6a1a"; // Hamyway-orange toe boards
  g.fillRect(0, 50, S, 3);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Destruction {
  readonly objects: THREE.Object3D[] = [];
  private readonly fps: (Footprint | null)[];
  private readonly n: number;
  private sim = 0;
  // per-group state
  private readonly mode: Uint8Array;
  private readonly t0: Float64Array;
  private readonly riseDur: Float32Array;
  private readonly riseAt: Float64Array; // sim time the rebuild starts, -1 = not scheduled
  private readonly tiltAxis: Float32Array;
  private readonly tiltMax: Float32Array;
  private readonly dust2: Uint8Array;
  private readonly owner: (string | null)[];
  private readonly pileSlot: Int16Array;
  private readonly scafSlot: Int16Array;
  private readonly rubbleOf: number[][];
  private readonly active: number[] = [];
  private readonly zones = new Map<string, ZoneTrack>();
  // pools
  private readonly dust: THREE.InstancedMesh;
  private readonly dustP = new Float32Array(DUST_POOL * 8); // x y z vx vy vz age life
  private readonly dustSize = new Float32Array(DUST_POOL);
  private dustNext = 0;
  private dustAlive = 0;
  private readonly rubble: THREE.InstancedMesh;
  private readonly rub = new Float32Array(RUBBLE_POOL * 8); // x y z vy restY startDelay size rotSeed
  private readonly rubFalling = new Uint8Array(RUBBLE_POOL);
  private readonly rubFree: number[] = [];
  private rubFallingCount = 0;
  private readonly pile: THREE.InstancedMesh;
  private readonly pileFree: number[] = [];
  private readonly scaffold: THREE.InstancedMesh;
  private readonly scafFree: number[] = [];
  private readonly disposables: { dispose: () => void }[] = [];

  constructor(
    private readonly built: Built,
    city: CityLayout,
    private readonly onZoneRestored: (id: string) => void,
  ) {
    this.fps = groupFootprints(city);
    this.n = city.groups + 1;
    this.mode = new Uint8Array(this.n);
    this.t0 = new Float64Array(this.n);
    this.riseDur = new Float32Array(this.n);
    this.riseAt = new Float64Array(this.n).fill(-1);
    this.tiltAxis = new Float32Array(this.n);
    this.tiltMax = new Float32Array(this.n);
    this.dust2 = new Uint8Array(this.n);
    this.owner = new Array(this.n).fill(null);
    this.pileSlot = new Int16Array(this.n).fill(-1);
    this.scafSlot = new Int16Array(this.n).fill(-1);
    this.rubbleOf = Array.from({ length: this.n }, () => []);
    const r = mulberry32(4242);
    for (let g = 0; g < this.n; g++) {
      this.tiltAxis[g] = r() * Math.PI * 2;
      this.tiltMax[g] = THREE.MathUtils.degToRad(3 + r() * 5);
    }

    const keep = <T extends { dispose: () => void }>(x: T) => (this.disposables.push(x), x);
    const pool = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number, cast: boolean) => {
      const m = new THREE.InstancedMesh(keep(geo), keep(mat), count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < count; i++) m.setMatrixAt(i, ZERO);
      m.frustumCulled = false;
      m.castShadow = cast;
      m.receiveShadow = true;
      this.objects.push(m);
      return m;
    };

    this.dust = pool(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: "#c9bda8", roughness: 1, transparent: true, opacity: 0.55, depthWrite: false, flatShading: true }),
      DUST_POOL,
      false,
    );
    this.dust.receiveShadow = false;
    this.dust.renderOrder = 2;

    this.rubble = pool(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), RUBBLE_POOL, false);
    for (let i = 0; i < RUBBLE_POOL; i++) this.rubble.setColorAt(i, RUBBLE_GREY);
    for (let i = RUBBLE_POOL - 1; i >= 0; i--) this.rubFree.push(i);

    const pyramid = new THREE.ConeGeometry(1, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
    this.pile = pool(pyramid, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), PILE_POOL, true);
    for (let i = 0; i < PILE_POOL; i++) this.pile.setColorAt(i, RUBBLE_GREY);
    for (let i = PILE_POOL - 1; i >= 0; i--) this.pileFree.push(i);

    const scafTex = keep(scaffoldTexture());
    const scafMat = facadeMaterial({ colW: 2.5, floorH: 2.2, nx: 2, ny: 1 }, { map: scafTex }, 0.9, 0, {
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // facadeMaterial's roof texel lookup assumes 32 px cells; our cells are 32 px too (64 / 2).
    this.scaffold = pool(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), scafMat, SCAFFOLD_POOL, false);
    for (let i = SCAFFOLD_POOL - 1; i >= 0; i--) this.scafFree.push(i);
  }

  // ------------------------------------------------------------ store sync (low frequency)

  sync(damage: readonly DamageZone[]) {
    const seen = new Set<string>();
    for (const z of damage) {
      seen.add(z.id);
      let track = this.zones.get(z.id);
      if (!track) {
        if (z.state === "restored") continue;
        const groups = groupsInCircle(this.fps, z.x, z.z, z.radius).filter((g) => this.owner[g] === null);
        track = { groups, rebuilding: false };
        this.zones.set(z.id, track);
        for (const g of groups) {
          this.owner[g] = z.id;
          this.startCollapse(g);
        }
      }
      if (z.state === "rebuilding" && !track.rebuilding) {
        track.rebuilding = true;
        for (const g of track.groups) {
          const { delay, dur } = rebuildSchedule(g);
          const collapsing = this.mode[g] === Mode.Collapsing;
          const collapseEnd = collapsing ? this.t0[g] + COLLAPSE_S : this.sim;
          this.riseAt[g] = Math.max(this.sim, collapseEnd) + delay;
          this.riseDur[g] = dur;
          if (!collapsing) {
            this.mode[g] = Mode.Waiting; // a still-collapsing group switches to Waiting when it lands
            this.activate(g);
          }
        }
        if (track.groups.length === 0) this.finishZone(z.id); // nothing to rebuild
      }
    }
    // zones removed by someone else: put their buildings straight back
    for (const [id, track] of this.zones) {
      if (seen.has(id)) continue;
      for (const g of track.groups) {
        this.restoreGroup(g);
        this.owner[g] = null;
      }
      this.zones.delete(id);
    }
  }

  // ------------------------------------------------------------ per frame

  update(dt: number) {
    this.sim += dt;
    const sim = this.sim;
    for (let k = this.active.length - 1; k >= 0; k--) {
      const g = this.active[k];
      const m = this.mode[g];
      if (m === Mode.Collapsing) {
        const t = sim - this.t0[g];
        const pose = collapsePose(t);
        if (pose.done) {
          this.setGroup(g, null, true, true);
          this.setPile(g, 1);
          if (this.riseAt[g] >= 0) this.mode[g] = Mode.Waiting;
          else {
            this.mode[g] = Mode.Down;
            this.deactivate(k);
          }
          continue;
        }
        this.collapseMatrix(g, pose.sink, pose.tilt, pose.shake);
        this.setGroup(g, _P, false, false);
        this.setPile(g, pose.sink);
        if (!this.dust2[g] && t > 1.4) {
          this.dust2[g] = 1;
          this.spawnDust(g, 0.6, 1.4);
        }
      } else if (m === Mode.Waiting) {
        if (sim >= this.riseAt[g]) {
          this.mode[g] = Mode.Rising;
          this.t0[g] = this.riseAt[g];
          this.clearRubble(g);
          this.scafSlot[g] = this.scafFree.pop() ?? -1;
          this.spawnDust(g, 0.25, 0.6);
        }
      } else if (m === Mode.Rising) {
        const t = sim - this.t0[g];
        const fp = this.fps[g]!;
        if (t >= this.riseDur[g]) {
          this.restoreGroup(g); // also drops g from the active list
          this.checkZone(this.owner[g]);
          continue;
        }
        const f = rebuildFraction(t, this.riseDur[g], fp.floors);
        _P.makeScale(1, Math.max(f, 0.0001), 1);
        this.setGroup(g, _P, true, false);
        this.setScaffold(g, f);
      }
    }
    this.updateDust(dt);
    this.updateRubble(dt);
  }

  dispose() {
    for (const o of this.objects) (o as THREE.InstancedMesh).dispose();
    for (const d of this.disposables) d.dispose();
  }

  // ------------------------------------------------------------ group transforms

  private activate(g: number) {
    if (!this.active.includes(g)) this.active.push(g);
  }

  private deactivate(k: number) {
    this.active[k] = this.active[this.active.length - 1];
    this.active.pop();
  }

  private startCollapse(g: number) {
    this.mode[g] = Mode.Collapsing;
    this.t0[g] = this.sim;
    this.dust2[g] = 0;
    this.activate(g);
    this.spawnDust(g, 1, 0);
    this.spawnRubble(g);
    if (this.pileSlot[g] < 0) this.pileSlot[g] = this.pileFree.pop() ?? -1;
  }

  /** _P = shake + sink + lean about the footprint's base centre (world space). */
  private collapseMatrix(g: number, sink: number, tilt: number, shake: number) {
    const fp = this.fps[g]!;
    const a = this.tiltAxis[g];
    _axis.set(Math.cos(a), 0, Math.sin(a));
    _P.makeTranslation(-fp.x, 0, -fp.z);
    _R.makeRotationAxis(_axis, tilt * this.tiltMax[g]);
    _P.premultiply(_R);
    _T.makeTranslation(fp.x + shake, -sink * (fp.top + 2), fp.z + shake * 0.6);
    _P.premultiply(_T);
  }

  /** Applies P (world-space pre-transform) to a group; null P = exact original matrices. */
  private setGroup(g: number, P: THREE.Matrix4 | null, hideProps: boolean, hideAll: boolean) {
    const parts = this.built.groups[g];
    for (const ref of parts.inst) {
      if (hideAll || (hideProps && ref.prop && P !== null)) ref.mesh.setMatrixAt(ref.index, ZERO);
      else if (P === null) ref.mesh.setMatrixAt(ref.index, _m.fromArray(ref.orig, ref.index * 16));
      else ref.mesh.setMatrixAt(ref.index, _m.fromArray(ref.orig, ref.index * 16).premultiply(P));
      ref.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const o of parts.objs) {
      o.mesh.visible = !hideAll;
      if (P === null) o.mesh.matrix.copy(o.orig);
      else o.mesh.matrix.copy(o.orig).premultiply(P);
      o.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  private restoreGroup(g: number) {
    this.setGroup(g, null, false, false);
    this.clearRubble(g);
    if (this.scafSlot[g] >= 0) {
      this.scaffold.setMatrixAt(this.scafSlot[g], ZERO);
      this.scaffold.instanceMatrix.needsUpdate = true;
      this.scafFree.push(this.scafSlot[g]);
      this.scafSlot[g] = -1;
    }
    this.mode[g] = Mode.Idle;
    this.riseAt[g] = -1;
    const k = this.active.indexOf(g);
    if (k >= 0) this.deactivate(k);
  }

  private checkZone(id: string | null) {
    if (!id) return;
    const track = this.zones.get(id);
    if (!track || !track.rebuilding) return;
    for (const g of track.groups) if (this.mode[g] !== Mode.Idle) return;
    this.finishZone(id);
  }

  private finishZone(id: string) {
    const track = this.zones.get(id);
    if (track) for (const g of track.groups) this.owner[g] = null;
    this.zones.delete(id); // forget first so the store echo of removeDamage is a no-op
    this.onZoneRestored(id);
  }

  // ------------------------------------------------------------ rubble pile + scaffold

  private setPile(g: number, k: number) {
    const slot = this.pileSlot[g];
    if (slot < 0) return;
    const fp = this.fps[g]!;
    const h = Math.min(5, Math.max(1.2, fp.top * 0.06)) * Math.max(0.02, k);
    _p.set(fp.x, 0, fp.z);
    _q.identity();
    _s.set((fp.w / Math.SQRT2) * 0.95, h, (fp.d / Math.SQRT2) * 0.95);
    this.pile.setMatrixAt(slot, _m.compose(_p, _q, _s));
    this.pile.instanceMatrix.needsUpdate = true;
  }

  private setScaffold(g: number, f: number) {
    const slot = this.scafSlot[g];
    if (slot < 0) return;
    const fp = this.fps[g]!;
    _p.set(fp.x, 0, fp.z);
    _q.identity();
    _s.set(fp.w + 1.4, Math.min(fp.top + 1.5, fp.top * f + 2.2), fp.d + 1.4);
    this.scaffold.setMatrixAt(slot, _m.compose(_p, _q, _s));
    this.scaffold.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ dust (pooled ring buffer)

  private spawnDust(g: number, amount: number, yFrac: number) {
    const fp = this.fps[g]!;
    const r = mulberry32((g * 131 + Math.floor(this.sim * 10)) >>> 0);
    const n = Math.round(Math.min(46, Math.max(14, (fp.w * fp.d) / 10)) * amount);
    for (let k = 0; k < n; k++) {
      const i = this.dustNext;
      this.dustNext = (this.dustNext + 1) % DUST_POOL;
      const o = i * 8;
      const ang = r() * Math.PI * 2;
      const rad = 0.5 + r() * 0.6;
      this.dustP[o] = fp.x + Math.cos(ang) * (fp.w / 2) * rad;
      this.dustP[o + 1] = 1 + r() * Math.max(2, fp.top * yFrac * 0.4);
      this.dustP[o + 2] = fp.z + Math.sin(ang) * (fp.d / 2) * rad;
      const sp = 4 + r() * 9;
      this.dustP[o + 3] = Math.cos(ang) * sp;
      this.dustP[o + 4] = 1.5 + r() * 4;
      this.dustP[o + 5] = Math.sin(ang) * sp;
      this.dustP[o + 6] = 0;
      this.dustP[o + 7] = 2.5 + r() * 2.5;
      this.dustSize[i] = 1.6 + r() * 2.2 + Math.min(3, fp.top * 0.03);
    }
    this.dustAlive = DUST_POOL; // conservative: scan until everything has died out
  }

  private updateDust(dt: number) {
    if (this.dustAlive === 0) return;
    let alive = 0;
    const drag = Math.exp(-1.8 * dt);
    for (let i = 0; i < DUST_POOL; i++) {
      const o = i * 8;
      const life = this.dustP[o + 7];
      if (life <= 0) continue;
      const age = (this.dustP[o + 6] += dt);
      if (age >= life) {
        this.dustP[o + 7] = 0;
        this.dust.setMatrixAt(i, ZERO);
        continue;
      }
      alive++;
      this.dustP[o + 3] *= drag;
      this.dustP[o + 4] = this.dustP[o + 4] * drag - 0.4 * dt;
      this.dustP[o + 5] *= drag;
      this.dustP[o] += this.dustP[o + 3] * dt;
      this.dustP[o + 1] = Math.max(0.5, this.dustP[o + 1] + this.dustP[o + 4] * dt);
      this.dustP[o + 2] += this.dustP[o + 5] * dt;
      const u = age / life;
      const fade = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
      const sc = this.dustSize[i] * (1 + 1.8 * u) * fade;
      _p.set(this.dustP[o], this.dustP[o + 1], this.dustP[o + 2]);
      _q.setFromEuler(_e.set(i, i * 0.7, 0));
      _s.set(sc, sc * 0.8, sc);
      this.dust.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    this.dust.instanceMatrix.needsUpdate = true;
    this.dustAlive = alive;
  }

  // ------------------------------------------------------------ rubble chunks

  private spawnRubble(g: number) {
    const fp = this.fps[g]!;
    const r = mulberry32(g * 977 + 3);
    const n = Math.round(Math.min(30, Math.max(8, (fp.w * fp.d) / 10)));
    const pileH = Math.min(5, Math.max(1.2, fp.top * 0.06));
    _c.set(this.built.groups[g].color).lerp(RUBBLE_GREY, 0.45);
    for (let k = 0; k < n; k++) {
      const i = this.rubFree.pop();
      if (i === undefined) return;
      this.rubbleOf[g].push(i);
      const o = i * 8;
      // spread over the footprint and a little past it onto the pavement
      const ux = (r() - 0.5) * 1.15;
      const uz = (r() - 0.5) * 1.15;
      this.rub[o] = fp.x + ux * fp.w;
      this.rub[o + 2] = fp.z + uz * fp.d;
      const centre = 1 - Math.min(1, Math.max(Math.abs(ux), Math.abs(uz)) * 2);
      this.rub[o + 4] = 0.2 + pileH * centre * r(); // rest height on the pile
      this.rub[o + 1] = this.rub[o + 4] + 4 + r() * Math.max(6, fp.top * 0.5);
      this.rub[o + 3] = 0;
      this.rub[o + 5] = r() * 1.6; // start delay (s)
      this.rub[o + 6] = 0.5 + r() * 1.3;
      this.rub[o + 7] = r() * 100;
      this.rubFalling[i] = 1;
      this.rubFallingCount++;
      this.rubble.setColorAt(i, _c);
    }
    if (this.rubble.instanceColor) this.rubble.instanceColor.needsUpdate = true;
  }

  private updateRubble(dt: number) {
    if (this.rubFallingCount === 0) return;
    for (let i = 0; i < RUBBLE_POOL; i++) {
      if (!this.rubFalling[i]) continue;
      const o = i * 8;
      if (this.rub[o + 5] > 0) {
        this.rub[o + 5] -= dt;
        continue;
      }
      this.rub[o + 3] -= 22 * dt;
      this.rub[o + 1] += this.rub[o + 3] * dt;
      if (this.rub[o + 1] <= this.rub[o + 4]) {
        this.rub[o + 1] = this.rub[o + 4];
        this.rubFalling[i] = 0;
        this.rubFallingCount--;
      }
      this.writeChunk(i);
    }
    this.rubble.instanceMatrix.needsUpdate = true;
  }

  private writeChunk(i: number) {
    const o = i * 8;
    const seed = this.rub[o + 7];
    const sz = this.rub[o + 6];
    _p.set(this.rub[o], this.rub[o + 1], this.rub[o + 2]);
    _q.setFromEuler(_e.set(seed, seed * 1.7, seed * 0.3));
    _s.set(sz * 1.3, sz * 0.7, sz);
    this.rubble.setMatrixAt(i, _m.compose(_p, _q, _s));
  }

  private clearRubble(g: number) {
    const list = this.rubbleOf[g];
    for (const i of list) {
      if (this.rubFalling[i]) {
        this.rubFalling[i] = 0;
        this.rubFallingCount--;
      }
      this.rubble.setMatrixAt(i, ZERO);
      this.rubFree.push(i);
    }
    if (list.length) this.rubble.instanceMatrix.needsUpdate = true;
    list.length = 0;
    const slot = this.pileSlot[g];
    if (slot >= 0) {
      this.pile.setMatrixAt(slot, ZERO);
      this.pile.instanceMatrix.needsUpdate = true;
      this.pileFree.push(slot);
      this.pileSlot[g] = -1;
    }
  }
}
