// Rolling stock: intercity sets (power cars + coaches), a Shoreditch EMU, diesel freight locos, container
// flats with colourful containers and tank wagons. One instanced mesh per vehicle type; each frame the engine
// places every car from two bogie points on its track (so cars follow curves, crossovers and ramps).
import * as THREE from "three";
import { Builder, HIDDEN, compose, instanced, mulberry32, vcMat } from "./kit";
import { carOffsets, railTop, trackLateral, trackPoint, type CarSpec, type CarType, type Line, type TrackPoint } from "./network";
import type { Train } from "./sim";
import { corrugation } from "./textures";

const WHITE = "#f3f4f1";
const DARK = "#24282c";
const BOGIE = "#1b1e21";
const ORANGE = "#ff6a1a";
const ROOF = "#c9ced2";
export const RAIL_TOP = 0.33;

// ---- Geometry (local: +z = forward, origin on the rail top at the car centre) -----------------------

function underframe(b: Builder, len: number) {
  b.box(0, 0.7, 0, 2.5, 0.5, len - 1.2, 0, DARK);
  for (const z of [-(len / 2 - 2.6), len / 2 - 2.6]) {
    b.box(0, 0.42, z, 2.3, 0.62, 2.8, 0, BOGIE);
    for (const dz of [-0.8, 0.8]) b.box(0, 0.42, z + dz, 2.6, 0.7, 0.7, 0, "#33373b");
  }
}

function coachGeometry(len: number) {
  const b = new Builder();
  underframe(b, len);
  b.box(0, 2.4, 0, 2.9, 2.9, len, 0, WHITE);
  b.box(0, 1.62, 0, 2.94, 0.34, len - 0.2, 0, ORANGE);
  b.box(0, 3.95, 0, 2.5, 0.22, len - 0.6, 0, ROOF);
  for (const z of [-(len / 2 - 1.1), len / 2 - 1.1]) b.box(0, 2.3, z, 2.95, 2.3, 0.9, 0, "#d3d7da"); // doors
  b.box(0, 2.2, 0, 2.6, 2.4, len + 0.5, 0, "#3b4045"); // gangway bellows
  return b.build();
}

function noseGeometry(len: number) {
  const b = new Builder();
  underframe(b, len);
  const nose = 4.2;
  const zb = len / 2 - nose; // body ends here, nose starts
  b.box(0, 2.4, -nose / 2, 2.9, 2.9, len - nose, 0, WHITE);
  b.box(0, 1.62, -nose / 2, 2.94, 0.34, len - nose - 0.2, 0, ORANGE);
  b.box(0, 3.95, -nose / 2 - 0.2, 2.5, 0.22, len - nose - 0.8, 0, ROOF);
  b.box(0, 2.2, -len / 2, 2.6, 2.4, 0.6, 0, "#3b4045");
  // wedge nose: rear ring at zb (full section), front ring at the tip (low and narrow)
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const r = [V(-1.45, 0.95, zb), V(1.45, 0.95, zb), V(1.45, 3.85, zb), V(-1.45, 3.85, zb)];
  const tip = len / 2;
  const f = [V(-1.05, 0.95, tip), V(1.05, 0.95, tip), V(1.0, 2.0, tip), V(-1.0, 2.0, tip)];
  b.quad(r[1], f[1], f[2], r[2], WHITE); // right side
  b.quad(f[0], r[0], r[3], f[3], WHITE); // left side
  b.quad(r[3], r[2], f[2], f[3], WHITE); // sloping top
  b.quad(f[0], f[1], f[2], f[3], ORANGE); // nose cap
  b.quad(r[0], r[1], f[1], f[0], DARK); // underside
  // windscreen on the slope
  const lerp = (a: THREE.Vector3, c: THREE.Vector3, t: number) => a.clone().lerp(c, t).add(V(0, 0.03, 0));
  const w0 = lerp(r[3], f[3], 0.22), w1 = lerp(r[2], f[2], 0.22), w2 = lerp(r[2], f[2], 0.62), w3 = lerp(r[3], f[3], 0.62);
  w0.x += 0.15; w3.x += 0.12; w1.x -= 0.15; w2.x -= 0.12;
  b.quad(w0, w1, w2, w3, "#11161b");
  // orange stripe swept onto the nose sides
  b.quad(V(1.47, 1.45, zb), V(1.07, 1.3, tip - 0.05), V(1.04, 1.6, tip - 0.05), V(1.47, 1.79, zb), ORANGE);
  b.quad(V(-1.07, 1.3, tip - 0.05), V(-1.47, 1.45, zb), V(-1.47, 1.79, zb), V(-1.04, 1.6, tip - 0.05), ORANGE);
  // pantograph
  b.box(0, 4.2, -len / 2 + 4, 1.6, 0.25, 1.2, 0, "#555b61");
  b.box(0, 4.75, -len / 2 + 4.6, 0.12, 1.1, 0.12, 0.6, "#555b61");
  return b.build();
}

function locoGeometry(len: number) {
  const b = new Builder();
  underframe(b, len);
  const body = "#ff6a1a";
  b.box(0, 2.45, -0.4, 2.75, 2.9, len - 3.2, 0, body);
  b.box(0, 2.3, len / 2 - 1.7, 2.75, 2.6, 2.6, 0, body); // cab
  b.box(0, 1.75, len / 2 - 0.35, 2.7, 1.5, 0.14, 0, "#ffd21a"); // yellow warning end
  b.box(0, 3.05, len / 2 - 0.4, 2.4, 0.75, 0.12, 0, "#11161b"); // windscreen
  b.box(0, 3.75, -0.6, 2.4, 0.3, len - 4, 0, "#5c6268");
  for (const z of [-4, -1, 2]) b.box(0, 3.95, z, 1.3, 0.12, 1.3, 0, "#2b2f33"); // roof fans
  b.box(0, 1.3, -0.4, 2.8, 0.25, len - 3, 0, "#3a3f45");
  b.box(0, 2.3, -len / 2 + 0.5, 2.6, 2.4, 0.9, 0, "#d95a12"); // rear cab end
  return b.build();
}

function flatGeometry(len: number) {
  const b = new Builder();
  underframe(b, len);
  b.box(0, 1.15, 0, 2.6, 0.32, len - 0.4, 0, "#4d555c");
  for (const z of [-len / 2 + 0.6, len / 2 - 0.6]) b.box(0, 1.35, z, 2.6, 0.2, 0.3, 0, "#f2c230");
  return b.build();
}

function tankGeometry(len: number) {
  const b = new Builder();
  underframe(b, len);
  b.box(0, 1.05, 0, 2.5, 0.3, len - 0.4, 0, DARK);
  const cyl = new THREE.CylinderGeometry(1.35, 1.35, len - 1.6, 14, 1, false);
  cyl.rotateX(Math.PI / 2);
  b.geometry(cyl, new THREE.Matrix4().makeTranslation(0, 2.55, 0), "#ffffff");
  cyl.dispose();
  const dome = new THREE.CylinderGeometry(0.5, 0.6, 0.5, 10);
  b.geometry(dome, new THREE.Matrix4().makeTranslation(0, 4.05, 0), "#ffffff");
  dome.dispose();
  b.box(0, 3.93, 0, 0.9, 0.06, len - 3, 0, "#3a3f45"); // walkway
  return b.build();
}

function windowBand(len: number, z0: number, z1: number) {
  const g = new THREE.BoxGeometry(2.96, 0.72, z1 - z0);
  g.translate(0, 2.85, (z0 + z1) / 2);
  void len;
  return g;
}

// ---- The fleet ------------------------------------------------------------------------------------

const CONTAINER_COLORS = ["#c0392b", "#1f6fb2", "#2e8b57", "#f39c12", "#7d3c98", "#e67e22", "#16a085", "#b03a2e", "#2c3e50", "#d4ac0d", "#ff6a1a", "#5d6d7e"];
const TANK_COLORS = ["#2a2d31", "#c8ccd0", "#e9ecef", "#2f6b4f", "#2a2d31"];
const EMU_TINT = new THREE.Color("#f2a43a");

interface CarSlot {
  mesh: THREE.InstancedMesh;
  index: number;
  win?: { mesh: THREE.InstancedMesh; index: number };
  scaleZ: number;
  containers?: { index: number; z: number; long: boolean }[];
}

export interface Fleet {
  meshes: THREE.Object3D[];
  update(trains: readonly Train[], night: number): void;
  windowMat: THREE.MeshStandardMaterial;
  dispose(): void;
}

const _a: TrackPoint = { x: 0, y: 0, z: 0, h: 0 };
const _b: TrackPoint = { x: 0, y: 0, z: 0, h: 0 };
const _m = new THREE.Matrix4();
const _l = new THREE.Matrix4();
const _o = new THREE.Matrix4();
const WHITE_C = new THREE.Color("#fff6d8");
const RED_C = new THREE.Color("#ff2216");
const LONG = new THREE.Matrix4().makeScale(1, 1, 2.01);

/** Car frame from its two bogie centres. */
function carMatrix(line: Line, sCar: number, len: number, flip: boolean, latF: number, latR: number, out: THREE.Matrix4) {
  const b = len / 2 - 2.6;
  trackPoint(line, sCar + b, latF, _a);
  trackPoint(line, sCar - b, latR, _b);
  const dx = _a.x - _b.x, dz = _a.z - _b.z, dy = _a.y - _b.y;
  let yaw = Math.atan2(dx, dz);
  let pitch = -Math.atan2(dy, Math.hypot(dx, dz));
  if (flip) {
    yaw += Math.PI;
    pitch = -pitch;
  }
  return compose((_a.x + _b.x) / 2, (_a.y + _b.y) / 2 + railTop(line, sCar), (_a.z + _b.z) / 2, yaw, 1, 1, 1, out, pitch);
}

/** Car frame on a static siding (a polyline of points) at distance d from its start. */
function sidingMatrix(pts: { x: number; y: number; z: number }[], cum: number[], d: number, len: number, flip: boolean, out: THREE.Matrix4) {
  const at = (u: number, o: TrackPoint) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < u) i++;
    const t = Math.max(0, Math.min(1, (u - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)));
    o.x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t;
    o.y = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t;
    o.z = pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t;
    return o;
  };
  const b = len / 2 - 2.6;
  at(d + b, _a);
  at(d - b, _b);
  let yaw = Math.atan2(_a.x - _b.x, _a.z - _b.z);
  if (flip) yaw += Math.PI;
  return compose((_a.x + _b.x) / 2, (_a.y + _b.y) / 2 + RAIL_TOP, (_a.z + _b.z) / 2, yaw, 1, 1, 1, out);
}

export function createFleet(trains: readonly Train[], sidings: { pts: { x: number; y: number; z: number }[]; park?: { kind: "ic" | "flat" | "tank"; cars: number } }[]): Fleet {
  const rand = mulberry32(4242);
  // count instances
  const counts: Record<CarType, number> = { icNose: 0, icCoach: 0, emuNose: 0, emuCoach: 0, loco: 0, flat: 0, tank: 0 };
  for (const t of trains) for (const c of t.consist) counts[c.type]++;
  for (const s of sidings) {
    if (!s.park) continue;
    if (s.park.kind === "ic") {
      counts.icNose += 2;
      counts.icCoach += s.park.cars - 2;
    } else counts[s.park.kind] += s.park.cars;
  }
  const noseCount = counts.icNose + counts.emuNose;
  const coachCount = counts.icCoach + counts.emuCoach;
  const containerCount = counts.flat * 2;

  const mat = vcMat({ roughness: 0.55 });
  const noseMesh = instanced(noseGeometry(14), mat, noseCount, true);
  const coachMesh = instanced(coachGeometry(13.5), mat, coachCount, true);
  const locoMesh = instanced(locoGeometry(17), mat, counts.loco, true);
  const flatMesh = instanced(flatGeometry(14), mat, counts.flat, true);
  const tankMesh = instanced(tankGeometry(14), mat, counts.tank, true);
  const corr = corrugation();
  const contGeo = new THREE.BoxGeometry(2.44, 2.59, 6.06);
  contGeo.translate(0, 1.295, 0);
  const contMesh = instanced(contGeo, new THREE.MeshStandardMaterial({ map: corr, roughness: 0.7, flatShading: true }), containerCount, true);
  const windowMat = new THREE.MeshStandardMaterial({ color: "#1d2733", emissive: "#ffd998", emissiveIntensity: 0, roughness: 0.25, metalness: 0.2 });
  const noseWin = instanced(windowBand(14, -6.4, 1.4), windowMat, noseCount, true);
  const coachWin = instanced(windowBand(13.5, -5.5, 5.5), windowMat, coachCount, true);
  for (const m of [noseMesh, coachMesh, locoMesh, flatMesh, tankMesh, contMesh]) m.castShadow = true;

  const lampGeo = new THREE.BoxGeometry(0.34, 0.26, 0.1);
  const lampPair = new THREE.BufferGeometry();
  {
    const l = lampGeo.clone().translate(-0.78, 0, 0);
    const r = lampGeo.clone().translate(0.78, 0, 0);
    const g = new Builder();
    g.geometry(l, new THREE.Matrix4(), "#ffffff");
    g.geometry(r, new THREE.Matrix4(), "#ffffff");
    lampPair.copy(g.build());
    l.dispose();
    r.dispose();
  }
  const lamps = instanced(lampPair, new THREE.MeshBasicMaterial({ toneMapped: false }), trains.length * 2, true);
  const beamGeo = new THREE.ConeGeometry(3.2, 34, 18, 1, true);
  beamGeo.translate(0, -17, 0);
  beamGeo.rotateX(-Math.PI / 2); // apex at origin, opening toward +z
  const beamMat = new THREE.MeshBasicMaterial({ color: "#fff1c2", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const beams = instanced(beamGeo, beamMat, trains.length, true);

  // allocate slots
  const next = { nose: 0, coach: 0, loco: 0, flat: 0, tank: 0, cont: 0 };
  const white = new THREE.Color("#ffffff");
  const slotFor = (c: CarSpec): CarSlot => {
    switch (c.type) {
      case "icNose":
      case "emuNose": {
        const i = next.nose++;
        noseMesh.setColorAt(i, c.type === "emuNose" ? EMU_TINT : white);
        return { mesh: noseMesh, index: i, win: { mesh: noseWin, index: i }, scaleZ: c.len / 14 };
      }
      case "icCoach":
      case "emuCoach": {
        const i = next.coach++;
        coachMesh.setColorAt(i, c.type === "emuCoach" ? EMU_TINT : white);
        return { mesh: coachMesh, index: i, win: { mesh: coachWin, index: i }, scaleZ: c.len / 13.5 };
      }
      case "loco":
        return { mesh: locoMesh, index: next.loco++, scaleZ: c.len / 17 };
      case "tank": {
        const i = next.tank++;
        tankMesh.setColorAt(i, new THREE.Color(TANK_COLORS[Math.floor(rand() * TANK_COLORS.length)]));
        return { mesh: tankMesh, index: i, scaleZ: c.len / 14 };
      }
      case "flat": {
        const i = next.flat++;
        const long = rand() < 0.35;
        const containers: CarSlot["containers"] = [];
        const pick = () => new THREE.Color(CONTAINER_COLORS[Math.floor(rand() * CONTAINER_COLORS.length)]);
        if (long) {
          const k = next.cont++;
          contMesh.setColorAt(k, pick());
          containers.push({ index: k, z: 0, long: true });
          contMesh.setMatrixAt(next.cont++, HIDDEN); // keep two per flat
        } else
          for (const z of [-3.25, 3.25]) {
            const k = next.cont++;
            if (rand() < 0.12) {
              contMesh.setMatrixAt(k, HIDDEN);
              contMesh.setColorAt(k, white);
              continue; // an empty slot now and then
            }
            contMesh.setColorAt(k, pick());
            containers.push({ index: k, z, long: false });
          }
        return { mesh: flatMesh, index: i, scaleZ: c.len / 14, containers };
      }
    }
  };

  const trainSlots = trains.map((t) => t.consist.map(slotFor));
  const offsets = trains.map((t) => carOffsets(t.consist));

  const placeCar = (slot: CarSlot, m: THREE.Matrix4) => {
    if (slot.scaleZ !== 1) m = _o.copy(m).multiply(_l.makeScale(1, 1, slot.scaleZ));
    slot.mesh.setMatrixAt(slot.index, m);
    if (slot.win) slot.win.mesh.setMatrixAt(slot.win.index, m);
    if (slot.containers)
      for (const c of slot.containers) {
        _l.makeTranslation(0, 1.31, c.z);
        if (c.long) _l.multiply(LONG);
        contMesh.setMatrixAt(c.index, _o.copy(m).multiply(_l));
      }
  };

  // parked stock on the sidings (static, written once)
  for (const s of sidings) {
    if (!s.park) continue;
    const cum = [0];
    for (let i = 1; i < s.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(s.pts[i].x - s.pts[i - 1].x, s.pts[i].z - s.pts[i - 1].z));
    const consist: CarSpec[] =
      s.park.kind === "ic"
        ? [{ type: "icNose", len: 14, flip: true }, ...Array.from({ length: s.park.cars - 2 }, () => ({ type: "icCoach" as const, len: 13.5, flip: false })), { type: "icNose", len: 14, flip: false }]
        : Array.from({ length: s.park.cars }, () => ({ type: s.park!.kind as "flat" | "tank", len: 14, flip: false }));
    let d = 4;
    for (const c of consist) {
      const slot = slotFor(c);
      sidingMatrix(s.pts, cum, d + c.len / 2, c.len, c.flip, _m);
      placeCar(slot, _m);
      d += c.len + 0.6;
    }
  }

  for (const m of [noseMesh, coachMesh, tankMesh, contMesh]) if (m.instanceColor) m.instanceColor.needsUpdate = true;

  const lampColors = new Int8Array(trains.length * 2).fill(-1);
  const all = [noseMesh, coachMesh, locoMesh, flatMesh, tankMesh, contMesh, noseWin, coachWin, lamps, beams];

  return {
    meshes: all,
    windowMat,
    update(list, night) {
      beamMat.opacity = 0.16 * night;
      beams.visible = night > 0.05;
      for (let t = 0; t < list.length; t++) {
        const tr = list[t];
        const st = tr.st;
        const line = tr.line;
        const offs = offsets[t];
        const slots = trainSlots[t];
        for (let k = 0; k < slots.length; k++) {
          const c = tr.consist[k];
          const sCar = st.s + offs[k];
          const b = c.len / 2 - 2.6;
          carMatrix(line, sCar, c.len, c.flip, trackLateral(line, sCar + b, st.dir), trackLateral(line, sCar - b, st.dir), _m);
          placeCar(slots[k], _m);
          // lamps on the two end cars
          if (k === 0 || k === slots.length - 1) {
            const end = k === 0 ? 0 : 1;
            const li = t * 2 + end;
            const front = (end === 0 && st.dir > 0) || (end === 1 && st.dir < 0);
            const y = c.type === "loco" ? 1.65 : 1.35;
            _l.makeTranslation(0, y, c.len / 2 + 0.06);
            lamps.setMatrixAt(li, _o.copy(_m).multiply(_l));
            const want = front ? 1 : 0;
            if (lampColors[li] !== want) {
              lampColors[li] = want;
              lamps.setColorAt(li, front ? WHITE_C : RED_C);
              lamps.instanceColor!.needsUpdate = true;
            }
            if (front) beams.setMatrixAt(t, _o.copy(_m).multiply(_l.makeTranslation(0, y, c.len / 2 + 0.2)));
          }
        }
      }
      for (const m of all) m.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      for (const m of all) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      mat.dispose();
      corr.dispose();
      lampGeo.dispose();
    },
  };
}
