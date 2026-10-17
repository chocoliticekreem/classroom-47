// Static airport scenery, built once and merged by material: ground surfaces + markings, solid buildings,
// glass, and the list of airfield lights (instanced elsewhere).
import * as THREE from "three";
import { ZONES } from "../../config";
import { getNode } from "../../roads";
import { box, cyl, merge, paint, quad, strip, beam } from "./geometry";
import {
  APPROACH_LIGHTS,
  APRON,
  CAR_PARK,
  CARGO_SHED,
  CREW_EAST_X,
  EXIT_X,
  FIRE_STATION,
  FUEL_FARM,
  HOLD,
  RWY,
  SERVICE_ROAD_Z,
  STAND_Z,
  STANDS,
  TAXI,
  TERMINAL,
  terminalFrontZ,
  TOWER,
  WINDSOCK,
} from "./layout";

const Y = { grass: 0.012, stripe: 0.013, pave: 0.024, apron: 0.022, mark: 0.034 };
const YELLOW = "#f2c230";

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function groundGeometry() {
  const z = ZONES.airport;
  const grass = quad(z.minX, z.maxX, z.minZ, z.maxZ, Y.grass, "#76a552");
  // mowing stripes on the airfield
  const stripes: THREE.BufferGeometry[] = [];
  for (let x = z.minX; x < z.maxX; x += 16) stripes.push(quad(x, Math.min(x + 8, z.maxX), z.minZ, -378, Y.stripe, "#82b25d"));
  let g: THREE.BufferGeometry[] = [];

  // taxiway, connectors and fillets
  g.push(strip(TAXI.x0 - 4, TAXI.z, TAXI.x1 + 4, TAXI.z, TAXI.halfW * 2, Y.pave, "#45484d"));
  for (const x of [HOLD.x, EXIT_X]) {
    g.push(strip(x, TAXI.z, x, RWY.z + RWY.halfW, 13, Y.pave, "#45484d"));
    g.push(quad(x - 9, x + 9, RWY.z + RWY.halfW, RWY.z + RWY.halfW + 6, Y.pave, "#45484d"));
  }
  // apron (reaches the taxiway) and the cargo yard
  g.push(quad(APRON.minX, APRON.maxX, TAXI.z + TAXI.halfW, -323, Y.apron, "#a7a49b"));
  g.push(quad(APRON.maxX, CARGO_SHED.maxX + 3, CARGO_SHED.maxZ, -324, Y.apron, "#a7a49b"));
  g.push(quad(APRON.maxX - 0.5, CARGO_SHED.minX, TAXI.z + TAXI.halfW, CARGO_SHED.maxZ, Y.apron, "#a7a49b"));

  // landside: service road, footway, car park, fire station yard, fuel farm pad
  const tn = getNode("airport_terminal");
  g.push(strip(FIRE_STATION.minX + 2, SERVICE_ROAD_Z, tn.x, SERVICE_ROAD_Z, 7, Y.pave, "#4b4d52"));
  g.push(strip(CREW_EAST_X, FIRE_STATION.minZ - 12, CREW_EAST_X, SERVICE_ROAD_Z, 6, Y.pave, "#4b4d52"));
  g.push(quad(FIRE_STATION.minX - 2, CREW_EAST_X + 3, FIRE_STATION.minZ - 12, FIRE_STATION.minZ, Y.apron, "#9c9a93"));
  g.push(quad(TERMINAL.minX, TERMINAL.maxX + 40, TERMINAL.backZ, SERVICE_ROAD_Z - 3.5, Y.apron, "#c9c3b5"));
  g.push(quad(CAR_PARK.minX, CAR_PARK.maxX, CAR_PARK.minZ, CAR_PARK.maxZ, Y.pave, "#55585e"));
  g.push(strip(CAR_PARK.maxX - 6, SERVICE_ROAD_Z, CAR_PARK.maxX - 6, CAR_PARK.minZ, 6, Y.pave, "#4b4d52"));
  g.push(quad(FUEL_FARM.x - 14, FUEL_FARM.x + 14, FUEL_FARM.z - 14, FUEL_FARM.z + 14, Y.apron, "#8d8b84"));
  g.push(strip(FUEL_FARM.x + 14, FUEL_FARM.z, FUEL_FARM.x + 20, SERVICE_ROAD_Z, 5, Y.pave, "#4b4d52"));

  const pave = merge(g);
  g = [];
  // --- markings
  g.push(strip(TAXI.x0, TAXI.z, TAXI.x1, TAXI.z, 0.35, Y.mark, YELLOW));
  for (const x of [HOLD.x, EXIT_X]) g.push(strip(x, TAXI.z, x, RWY.z + RWY.halfW, 0.35, Y.mark, YELLOW));
  // hold-short bars at the runway entry
  for (const dz of [0, 0.7, 1.6, 2.3]) g.push(strip(HOLD.x - 6.5, HOLD.z - 2 - dz, HOLD.x + 6.5, HOLD.z - 2 - dz, 0.22, Y.mark, YELLOW));
  // stand lead-in lines, stop bars and red safety boxes
  for (const s of STANDS) {
    g.push(strip(s.x, TAXI.z, s.x, STAND_Z + 9, 0.3, Y.mark, YELLOW));
    g.push(strip(s.x - 2.5, STAND_Z + 9.4, s.x + 2.5, STAND_Z + 9.4, 0.35, Y.mark, "#ffffff"));
    const x0 = s.x - 11.5;
    const x1 = s.x + 11.5;
    for (const [a, b, c, d] of [
      [x0, STAND_Z - 12, x1, STAND_Z - 12],
      [x0, STAND_Z - 12, x0, STAND_Z + 12],
      [x1, STAND_Z - 12, x1, STAND_Z + 12],
    ])
      g.push(strip(a, b, c, d, 0.25, Y.mark, "#d8433b"));
  }
  // car park bays
  for (let x = CAR_PARK.minX + 2; x < CAR_PARK.maxX - 10; x += 3)
    for (const zz of [CAR_PARK.minZ + 3, CAR_PARK.maxZ - 3]) g.push(strip(x, zz - 2.5, x, zz + 2.5, 0.12, Y.mark, "#e9e9e4"));
  // service road centre dashes
  for (let x = FIRE_STATION.minX + 6; x < tn.x - 4; x += 6) g.push(strip(x, SERVICE_ROAD_Z, x + 3, SERVICE_ROAD_Z, 0.18, Y.mark, "#ececec"));
  // Layered with polygonOffset (like Roads/Ground): grass behind stripes behind paving behind markings.
  return { grass, stripes: merge(stripes), pave, marks: merge(g) };
}

/** Terminal plan (shape x = world x, shape y = -world z), optionally grown by `pad`. */
function terminalShape(pad: number) {
  const s = new THREE.Shape();
  const n = 24;
  const x0 = TERMINAL.minX - pad;
  const x1 = TERMINAL.maxX + pad;
  s.moveTo(x0, -(TERMINAL.backZ + pad));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    s.lineTo(x, -(terminalFrontZ(Math.min(TERMINAL.maxX, Math.max(TERMINAL.minX, x))) - pad));
  }
  s.lineTo(x1, -(TERMINAL.backZ + pad));
  s.closePath();
  return s;
}

function extrudeUp(shape: THREE.Shape, height: number, y0: number) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

/** Extra roof thickness on top (>= 0): the roof undulates in three gentle waves along the terminal. */
const roofWave = (x: number) => 0.65 + 0.65 * Math.sin(((x - TERMINAL.minX) / (TERMINAL.maxX - TERMINAL.minX)) * Math.PI * 3);

export function glassGeometry() {
  const g: THREE.BufferGeometry[] = [];
  g.push(paint(extrudeUp(terminalShape(0), TERMINAL.height, 0), "#9fd0ee"));
  // tower cab
  const cab = new THREE.CylinderGeometry(4.0, 3.4, 3.2, 8);
  cab.translate(TOWER.x, TOWER.height - 3.4, TOWER.z);
  g.push(paint(cab, "#9fd0ee"));
  // fire station office windows and cargo office strip
  g.push(box(FIRE_STATION.maxX + 0.05, 4.6, (FIRE_STATION.minZ + FIRE_STATION.maxZ) / 2, 0.1, 1.2, 14, "#9fd0ee"));
  g.push(box((CARGO_SHED.minX + CARGO_SHED.maxX) / 2, 3, CARGO_SHED.maxZ + 0.05, 16, 1.1, 0.1, "#9fd0ee"));
  return merge(g);
}

export function solidGeometry() {
  const g: THREE.BufferGeometry[] = [];
  const rand = mulberry(42);

  // --- terminal: wavy white roof with Hamyway-orange ribs and fascia
  const roof = extrudeUp(terminalShape(2.2), 0.7, TERMINAL.height);
  const rp = roof.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < rp.count; i++) if (rp.getY(i) > TERMINAL.height + 0.35) rp.setY(i, rp.getY(i) + roofWave(rp.getX(i)));
  roof.computeVertexNormals();
  g.push(paint(roof, "#f3f1ec"));
  for (let i = 0; i < 10; i++) {
    const x = TERMINAL.minX + 3 + i * ((TERMINAL.maxX - TERMINAL.minX - 6) / 9);
    const fz = terminalFrontZ(x) - 2.2;
    const len = TERMINAL.backZ + 2.2 - fz;
    g.push(box(x, TERMINAL.height + 0.8 + roofWave(x), fz + len / 2, 0.7, 0.35, len, "#ff6a1a"));
  }
  for (let i = 0; i < 24; i++) {
    const xa = TERMINAL.minX - 2 + i * ((TERMINAL.maxX - TERMINAL.minX + 4) / 24);
    const xb = xa + (TERMINAL.maxX - TERMINAL.minX + 4) / 24;
    const clampX = (x: number) => Math.min(TERMINAL.maxX, Math.max(TERMINAL.minX, x));
    const a = new THREE.Vector3(xa, TERMINAL.height + 0.3 + roofWave(xa) / 2, terminalFrontZ(clampX(xa)) - 2.3);
    const b = new THREE.Vector3(xb, TERMINAL.height + 0.3 + roofWave(xb) / 2, terminalFrontZ(clampX(xb)) - 2.3);
    g.push(beam(a, b, 0.4, 0.55, "#ff6a1a"));
  }
  // landside canopy over the drop-off
  g.push(box(-385, 5.2, TERMINAL.backZ + 2.5, 30, 0.35, 5, "#f3f1ec"));
  for (const x of [-398, -385, -372]) g.push(cyl(x, 2.6, TERMINAL.backZ + 4.4, 0.18, 5.2, "#ff6a1a", 6));

  // --- jet bridges (to the plane's left forward door) and rotundas
  for (const s of STANDS) {
    if (!s.bridge) continue;
    const rx = s.x + 7;
    const rz = terminalFrontZ(rx) - 1.2;
    g.push(cyl(rx, 2, rz, 2.0, 4, "#d6d9dd", 10));
    const a = new THREE.Vector3(rx, 3.3, rz - 1.2);
    const b = new THREE.Vector3(s.x + 3.1, 3.3, STAND_Z + 6.2 + 1.2);
    g.push(beam(a, b, 2.4, 2.4, "#cfd3d8"));
    g.push(box(s.x + 2.7, 3.3, STAND_Z + 7.4, 2.2, 2.7, 2.6, "#9aa1aa"));
    const mid = a.clone().lerp(b, 0.7);
    g.push(box(mid.x, 1.05, mid.z, 0.35, 2.1, 0.35, "#5b6068"));
    g.push(box(mid.x, 0.3, mid.z, 1.6, 0.6, 0.8, "#2b2e33"));
  }
  // ground equipment: baggage carts and a belt loader at each stand
  for (const s of STANDS) {
    for (let k = 0; k < 3; k++) {
      const x = s.x - 9 - k * 2.4;
      g.push(box(x, 0.55, STAND_Z + 9, 1.8, 0.9, 1.3, k === 0 ? "#3b6fb6" : "#c9ccd1"));
    }
    g.push(box(s.x - 5, 0.5, STAND_Z + 2, 1.4, 0.8, 3.6, "#f4c20d"));
  }

  // --- control tower
  g.push(box(TOWER.x, 2.5, TOWER.z, 8, 5, 8, "#e9e6df"));
  g.push(cyl(TOWER.x, (TOWER.height - 5) / 2, TOWER.z, 1.9, TOWER.height - 5, "#f1efe9", 10, 1.6));
  g.push(cyl(TOWER.x, TOWER.height - 5.4, TOWER.z, 3.3, 0.8, "#cfcac0", 8, 3.9));
  g.push(cyl(TOWER.x, TOWER.height - 1.55, TOWER.z, 4.4, 0.5, "#f1efe9", 8, 4.4));
  g.push(box(TOWER.x, TOWER.height - 0.8, TOWER.z, 1.8, 1.0, 1.8, "#ff6a1a"));
  g.push(cyl(TOWER.x + 2.5, TOWER.height + 1.2, TOWER.z, 0.08, 4, "#8b9097", 4));

  // --- fire station: brick with red doors, hose tower
  const fs = FIRE_STATION;
  const fcx = (fs.minX + fs.maxX) / 2;
  const fcz = (fs.minZ + fs.maxZ) / 2;
  g.push(box(fcx, 3.5, fcz, fs.maxX - fs.minX, 7, fs.maxZ - fs.minZ, "#9e4a32"));
  g.push(box(fcx, 7.15, fcz, fs.maxX - fs.minX + 0.8, 0.3, fs.maxZ - fs.minZ + 0.8, "#e8e4dc"));
  for (let k = 0; k < 3; k++) {
    const x = fs.minX + 5 + k * 8;
    g.push(box(x, 2.6, fs.minZ - 0.05, 5.6, 5.2, 0.12, "#d92b1f"));
    for (let j = 1; j < 5; j++) g.push(box(x, j * 1.05, fs.minZ - 0.12, 5.6, 0.08, 0.05, "#a81e15"));
  }
  g.push(box(fs.maxX - 3, 6, fs.maxZ - 4, 4, 12, 4, "#9e4a32"));
  g.push(box(fs.maxX - 3, 12.2, fs.maxZ - 4, 4.6, 0.4, 4.6, "#e8e4dc"));
  g.push(box(fcx, 6.3, fs.minZ - 0.1, 12, 1.0, 0.1, "#ffffff"));

  // --- fuel farm: tanks in a bund
  for (const [dx, dz] of [
    [-6.5, -6.5],
    [6.5, -6.5],
    [-6.5, 6.5],
    [6.5, 6.5],
  ]) {
    const x = FUEL_FARM.x + dx;
    const zz = FUEL_FARM.z + dz;
    g.push(cyl(x, 2.6, zz, 4.6, 5.2, "#f2f2ee", 14));
    g.push(cyl(x, 4.1, zz, 4.65, 0.6, "#d92b1f", 14));
    g.push(cyl(x, 5.35, zz, 4.2, 0.3, "#cfd2d6", 14, 2.0));
  }
  for (const [a, b] of [
    [-14, -14],
    [14, -14],
  ]) {
    g.push(box(FUEL_FARM.x + a / 2 + b / 2, 0.5, FUEL_FARM.z - 14, 28, 1, 0.5, "#b8b5ad"));
    g.push(box(FUEL_FARM.x + a / 2 + b / 2, 0.5, FUEL_FARM.z + 14, 28, 1, 0.5, "#b8b5ad"));
  }
  g.push(box(FUEL_FARM.x - 14, 0.5, FUEL_FARM.z, 0.5, 1, 28, "#b8b5ad"));
  g.push(box(FUEL_FARM.x + 14, 0.5, FUEL_FARM.z, 0.5, 1, 28, "#b8b5ad"));
  g.push(box(FUEL_FARM.x, 1.4, FUEL_FARM.z, 0.4, 0.4, 20, "#8b9097"));

  // --- cargo shed: blue-grey with an orange door band and barrel roof
  const cs = CARGO_SHED;
  const ccx = (cs.minX + cs.maxX) / 2;
  const ccz = (cs.minZ + cs.maxZ) / 2;
  const cw = cs.maxX - cs.minX;
  const cd = cs.maxZ - cs.minZ;
  g.push(box(ccx, cs.height / 2, ccz, cw, cs.height, cd, "#6d7f93"));
  const barrel = new THREE.CylinderGeometry(cd / 2, cd / 2, cw + 0.6, 16, 1, false, 0, Math.PI);
  barrel.rotateZ(Math.PI / 2);
  barrel.scale(1, 0.32, 1);
  barrel.translate(ccx, cs.height, ccz);
  g.push(paint(barrel, "#d8dde3"));
  for (let k = 0; k < 3; k++) g.push(box(cs.minX - 0.06, 2.9, cs.minZ + 5 + k * 9, 0.12, 5.6, 6, "#ff6a1a"));
  g.push(box(ccx, cs.height - 0.6, cs.maxZ + 0.08, cw, 1.2, 0.12, "#ff6a1a"));
  // ULD containers on dollies (silver, a few in Hamyway orange)
  for (let i = 0; i < 16; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = APRON.maxX + 1.2 + col * 2.3 - 9.5;
    const zz = STAND_Z - 13 + row * 2.6 + (row > 1 ? 14 : 0);
    if (x > APRON.maxX + 6) continue;
    const hex = rand() < 0.3 ? "#ff6a1a" : "#c9ced6";
    g.push(box(x, 1.25, zz, 1.9, 1.6, 1.9, hex));
    g.push(box(x, 0.25, zz, 2.1, 0.3, 2.1, "#3a3d42"));
  }
  for (let i = 0; i < 8; i++) {
    const x = cs.minX + 3 + (i % 4) * 2.5;
    const zz = cs.maxZ + 3 + Math.floor(i / 4) * 2.5;
    g.push(box(x, 1.0, zz, 2.0, 1.7, 2.0, i % 3 === 0 ? "#ff6a1a" : "#c9ced6"));
  }
  g.push(box(cs.minX - 6, 0.7, cs.minZ + 2, 2.4, 1.2, 4.5, "#f4c20d")); // K-loader

  // --- car park: rows of parked cars
  const carCols = ["#e7e7e7", "#1d1d1f", "#9aa3ad", "#b8222b", "#2f5fa8", "#ffffff", "#545a63", "#c4a35a"];
  for (let x = CAR_PARK.minX + 3.5; x < CAR_PARK.maxX - 10; x += 3)
    for (const zz of [CAR_PARK.minZ + 3, CAR_PARK.maxZ - 3]) {
      if (rand() < 0.25) continue;
      const c = carCols[Math.floor(rand() * carCols.length)];
      g.push(box(x, 0.55, zz, 1.7, 0.8, 4.0, c));
      g.push(box(x, 1.15, zz - 0.2, 1.5, 0.5, 2.1, c));
    }

  // --- apron light masts, windsock pole, approach light stands, signs
  for (const x of [-423, -397, -371, -343, -315]) g.push(cyl(x, 8, -331, 0.22, 16, "#9aa0a8", 6));
  for (const x of [-423, -397, -371, -343, -315]) g.push(box(x, 16.1, -331, 2.4, 0.5, 0.9, "#4a4f57"));
  g.push(cyl(WINDSOCK.x, 3.5, WINDSOCK.z, 0.1, 7, "#d6d6d6", 6));
  for (let k = 0; k < APPROACH_LIGHTS.bars; k++) {
    const x = APPROACH_LIGHTS.x0 - k * APPROACH_LIGHTS.spacing;
    g.push(box(x, 0.3, RWY.z, 0.25, 0.6, 9, "#4a4f57"));
  }
  // taxiway location/direction signs
  for (const [x, zz] of [
    [HOLD.x + 8, HOLD.z - 1],
    [EXIT_X - 8, TAXI.z - 7],
  ]) {
    g.push(box(x, 0.8, zz, 2.6, 1.0, 0.25, "#f2c230"));
    g.push(box(x - 0.7, 0.8, zz + 0.14, 0.9, 0.7, 0.02, "#111111"));
    g.push(box(x, 0.15, zz, 0.2, 0.3, 0.2, "#4a4f57"));
  }
  // perimeter fence along the south-west boundary
  for (let x = ZONES.airport.minX; x < CAR_PARK.minX - 4; x += 4)
    g.push(box(x + 2, 1.0, ZONES.airport.maxZ - 1, 4, 2, 0.06, "#7c848c"));
  return merge(g);
}

export interface Lamp {
  x: number;
  y: number;
  z: number;
  color: string;
  s: number;
}

export function lamps(): Lamp[] {
  const out: Lamp[] = [];
  const edgeZ = RWY.halfW + 0.7;
  for (let x = RWY.x0; x <= RWY.x1 + 0.1; x += 8)
    for (const s of [-1, 1]) out.push({ x, y: 0.3, z: RWY.z + s * edgeZ, color: "#fff2cf", s: 0.45 });
  for (let k = 0; k < 9; k++) {
    const z = RWY.z - RWY.halfW + 1 + k * ((RWY.halfW * 2 - 2) / 8);
    out.push({ x: RWY.x0 - 0.8, y: 0.25, z, color: "#29ff6a", s: 0.45 });
    out.push({ x: RWY.x1 + 0.8, y: 0.25, z, color: "#ff2a2a", s: 0.45 });
  }
  // PAPI: two red, two white
  for (let k = 0; k < 4; k++)
    out.push({ x: RWY.x0 + 30, y: 0.45, z: RWY.z - RWY.halfW - 5 - k * 1.8, color: k < 2 ? "#ff2a2a" : "#ffffff", s: 0.6 });
  // taxiway edge (blue)
  for (let x = TAXI.x0; x <= TAXI.x1; x += 10) {
    out.push({ x, y: 0.25, z: TAXI.z - TAXI.halfW - 0.5, color: "#3b6cff", s: 0.38 });
    if (x > APRON.maxX + 2) out.push({ x, y: 0.25, z: TAXI.z + TAXI.halfW + 0.5, color: "#3b6cff", s: 0.38 });
  }
  for (const x of [HOLD.x, EXIT_X])
    for (let zz = TAXI.z - 9; zz > RWY.z + RWY.halfW; zz -= 6)
      for (const s of [-1, 1]) out.push({ x: x + s * 7, y: 0.25, z: zz, color: "#3b6cff", s: 0.38 });
  // apron flood heads
  for (const x of [-423, -397, -371, -343, -315])
    for (const dx of [-0.7, 0.7]) out.push({ x: x + dx, y: 15.75, z: -331.3, color: "#ffe2a8", s: 0.55 });
  // obstruction lights
  out.push({ x: TOWER.x + 2.5, y: TOWER.height + 3.3, z: TOWER.z, color: "#ff2a2a", s: 0.45 });
  out.push({ x: FIRE_STATION.maxX - 3, y: 12.6, z: FIRE_STATION.maxZ - 4, color: "#ff2a2a", s: 0.4 });
  out.push({ x: WINDSOCK.x, y: 7.2, z: WINDSOCK.z, color: "#ff2a2a", s: 0.3 });
  return out;
}

/** Approach light bars west of the threshold, nearest bar first (the "rabbit" runs toward the runway). */
export function rabbitLamps(): Lamp[] {
  const out: Lamp[] = [];
  for (let k = APPROACH_LIGHTS.bars - 1; k >= 0; k--) {
    const x = APPROACH_LIGHTS.x0 - k * APPROACH_LIGHTS.spacing;
    for (let j = 0; j < APPROACH_LIGHTS.perBar; j++)
      out.push({ x, y: 0.7, z: RWY.z - 4 + (j * 8) / (APPROACH_LIGHTS.perBar - 1), color: "#ffffff", s: 0.42 });
  }
  return out;
}
