// Static railway scenery, built once: track (instanced sleepers, merged rails and ballast), brick arch
// viaducts with steel spans over roads, embankments, the river truss bridge, the King's Hamyway terminus,
// stations, overhead line gantries, signals and level crossings. Moving parts (signal lamps, barrier arms,
// crossing lamps) are instanced meshes whose instances the engine updates.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  Builder,
  HIDDEN,
  UNIT_BOX,
  beamMatrix,
  compose,
  finish,
  instanced,
  staticMesh,
  stdMat,
  vcMat,
  type SweepPoint,
} from "./kit";
import {
  DECK_TOP,
  GAUGE_HALF,
  H,
  ISLAND_HALF,
  LINES,
  PLATFORM_HALF,
  TERMINUS,
  gantrySites,
  halfSpacing,
  lineById,
  signalSites,
  styleRuns,
  trackLateral,
  trackPoint,
  viaductLayout,
  type LevelCrossing,
  type Line,
  type SignalSite,
  type TrackPoint,
} from "./network";
import { boardAtlas, boardRow, clockFace, terminusSign } from "./textures";

const BRICK = "#8e4632";
const BRICK_DARK = "#6f3426";
const STONE = "#e2d4b6";
const SLATE = "#46505b";
const STEEL_GREY = "#4b555e";
const IRON_BLUE = "#7fa6cf"; // St Pancras sky-blue ironwork
const TRUSS = "#3b6c8e";
const BALLAST = "#7c746a";
const RAIL = "#b9c0c6";
const SLEEPER = "#5a4b3f";
const PLATFORM = "#c9c3b8";
const EDGE_YELLOW = "#f2c230";
const GRASS = "#6e9a48";

const tp: TrackPoint = { x: 0, y: 0, z: 0, h: 0 };
const tq: TrackPoint = { x: 0, y: 0, z: 0, h: 0 };
const m4 = new THREE.Matrix4();

class Inst {
  mats: THREE.Matrix4[] = [];
  cols: THREE.Color[] = [];
  add(m: THREE.Matrix4, color?: string) {
    this.mats.push(m.clone());
    this.cols.push(new THREE.Color(color ?? "#ffffff"));
  }
  mesh(geo: THREE.BufferGeometry, mat: THREE.Material, colored = false, cast = false) {
    const m = instanced(geo, mat, this.mats.length);
    this.mats.forEach((x, i) => m.setMatrixAt(i, x));
    if (colored) this.cols.forEach((c, i) => m.setColorAt(i, c));
    m.castShadow = cast;
    m.receiveShadow = true;
    return finish(m);
  }
}

// ---- Track paths -----------------------------------------------------------------------------------

interface TrackPath {
  pts: SweepPoint[]; // rail-base points along the track (y = top of ballast)
}

/** Sample a lateral track line on a railway line. */
function sampleLine(line: Line, s0: number, s1: number, lat: (s: number) => number, step = 2): SweepPoint[] {
  const out: SweepPoint[] = [];
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    trackPoint(line, s, lat(s), tp);
    out.push({ x: tp.x, y: tp.y, z: tp.z, h: 0 });
  }
  fixHeadings(out);
  return out;
}

function fixHeadings(pts: SweepPoint[]) {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    pts[i].h = Math.atan2(b.x - a.x, b.z - a.z);
  }
}

/** A straight track between two world points at height y. */
function straight(ax: number, az: number, bx: number, bz: number, y: number, step = 2): SweepPoint[] {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
  const out: SweepPoint[] = [];
  for (let i = 0; i <= n; i++) out.push({ x: ax + ((bx - ax) * i) / n, y, z: az + ((bz - az) * i) / n, h: 0 });
  fixHeadings(out);
  return out;
}

function linePaths(line: Line): TrackPath[] {
  const end = Math.min(line.L, line.externalS);
  const paths: TrackPath[] = [];
  const single = Number.isFinite(line.singleS) ? Math.min(line.singleS, end) : end;
  paths.push({ pts: sampleLine(line, 0, end, (s) => halfSpacing(line, s)) });
  paths.push({ pts: sampleLine(line, 0, single, (s) => -halfSpacing(line, s)) });
  const [a0, a1] = line.a;
  paths.push({ pts: sampleLine(line, a0 - 2, a1 + 2, (s) => trackLateral(line, s, 1)) });
  const [b0, b1] = line.b;
  if (b1 < single) paths.push({ pts: sampleLine(line, b0 - 2, b1 + 2, (s) => trackLateral(line, s, -1)) });
  return paths;
}

/** Decorative sidings: the spare terminus platforms, the goods yard and the freight yard. */
export function sidingPaths(): { pts: SweepPoint[]; park?: { kind: "ic" | "flat" | "tank"; cars: number } }[] {
  const out: { pts: SweepPoint[]; park?: { kind: "ic" | "flat" | "tank"; cars: number } }[] = [];
  const zA = TERMINUS.buffersZ;
  const zB = -470;
  const x2 = TERMINUS.islands[1];
  out.push({ pts: straight(x2 - ISLAND_HALF, zA, x2 - ISLAND_HALF, zB, H), park: { kind: "ic", cars: 6 } });
  out.push({ pts: straight(x2 + ISLAND_HALF, zA, x2 + ISLAND_HALF, zB, H), park: { kind: "ic", cars: 7 } });
  // throat connections from the spare platform roads into the main lines
  const west = lineById("west");
  const north = lineById("north");
  trackPoint(west, 165, -halfSpacing(west, 165), tp);
  out.push({ pts: straight(x2 - ISLAND_HALF, zB, tp.x, tp.z, H) });
  trackPoint(north, 175, halfSpacing(north, 175), tp);
  out.push({ pts: straight(x2 + ISLAND_HALF, zB, tp.x, tp.z, H) });
  // goods yard sidings either side of the freight line
  out.push({ pts: straight(-112, -467, -112, -336, H), park: { kind: "flat", cars: 6 } });
  out.push({ pts: straight(-92, -467, -92, -336, H), park: { kind: "tank", cars: 6 } });
  const fr = lineById("freight");
  trackPoint(fr, 168, -halfSpacing(fr, 168), tp);
  out.push({ pts: straight(-112, -336, tp.x, tp.z, H) });
  trackPoint(fr, 168, halfSpacing(fr, 168), tp);
  out.push({ pts: straight(-92, -336, tp.x, tp.z, H) });
  // freight yard loading siding beside the spur
  const sp: SweepPoint[] = [];
  for (let s = fr.L - 70; s <= fr.L - 2; s += 1) {
    trackPoint(fr, s, 7, tp);
    sp.push({ x: tp.x, y: 0, z: tp.z, h: 0 });
  }
  fixHeadings(sp);
  out.push({ pts: sp, park: { kind: "flat", cars: 4 } });
  trackPoint(fr, fr.L - 100, halfSpacing(fr, fr.L - 100), tp);
  out.push({ pts: straight(tp.x, tp.z, sp[0].x, sp[0].z, 0) });
  return out;
}

// ---- The build -------------------------------------------------------------------------------------

export interface CrossingVisual {
  lc: LevelCrossing;
  armBase: number; // first instance index in the arm mesh
  armPivots: { x: number; y: number; z: number; yaw: number; len: number }[];
  lampBase: number;
  lamps: number;
}

export interface SignalVisual {
  site: SignalSite;
  next: SignalSite | undefined;
  aspect: number;
}

export interface RailScene {
  meshes: THREE.Object3D[];
  glowMat: THREE.MeshStandardMaterial; // windows and platform lamps (emissive at night)
  clockMat: THREE.MeshStandardMaterial;
  clockHands: THREE.InstancedMesh;
  clockCentres: { x: number; y: number; z: number; yaw: number }[];
  signalLamps: THREE.InstancedMesh;
  signals: SignalVisual[];
  arms: THREE.InstancedMesh;
  lcLamps: THREE.InstancedMesh;
  crossings: CrossingVisual[];
  sidings: ReturnType<typeof sidingPaths>;
  dispose(): void;
}

export function buildRailScene(): RailScene {
  const brick = new Builder(); // vertex-coloured solids (brick, stone, slate, steel decks, platforms)
  const track = new Builder(); // ballast + rails
  const glass = new Builder();
  const sleepers = new Inst();
  const arches = new Inst();
  const blocks = new Inst(); // unit boxes, coloured (piers, walls, posts, girders, building parts)
  const steel = new Inst(); // beams, coloured
  const glow = new Inst(); // lit windows / lamps

  // -- track
  const allPaths: SweepPoint[][] = [];
  for (const line of LINES) for (const p of linePaths(line)) allPaths.push(p.pts);
  const sidings = sidingPaths();
  for (const s of sidings) allPaths.push(s.pts);
  for (const pts of allPaths) {
    track.sweep(pts, () => [[-1.75, -0.32], [-1.4, 0.1], [1.4, 0.1], [1.75, -0.32]], BALLAST);
    for (const side of [-1, 1]) {
      const g = side * GAUGE_HALF;
      track.sweep(pts, () => [[g - 0.05, 0.17], [g - 0.05, 0.33], [g + 0.05, 0.33], [g + 0.05, 0.17]], RAIL);
    }
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      if (acc < 1.3) continue;
      acc = 0;
      const p = pts[i];
      sleepers.add(compose(p.x, p.y + 0.1, p.z, p.h, 2.5, 0.14, 0.26, m4));
    }
  }

  // -- structures per line
  for (const line of LINES) buildStructures(line, brick, arches, blocks, steel);

  // -- catenary
  const wireVerts: number[] = [];
  for (const line of LINES) buildCatenary(line, steel, wireVerts);

  // -- stations
  for (const line of LINES) for (const st of line.stations) if (st.building) buildStation(line, st, brick, blocks, steel, glow);

  // -- terminus
  const { clockCentres } = buildTerminus(brick, glass, arches, blocks, steel, glow);

  // -- freight yard gantry crane
  {
    const fr = lineById("freight");
    const s = fr.L - 40;
    const legs: [number, number][] = [];
    for (const ds of [-6, 6]) for (const lat of [-6, 12]) {
      trackPoint(fr, s + ds, lat, tp);
      legs.push([tp.x, tp.z]);
      steel.add(beamMatrix(tp.x, 0, tp.z, tp.x, 15, tp.z, 0.7, 0.7, m4), "#f2b705");
    }
    steel.add(beamMatrix(legs[0][0], 15, legs[0][1], legs[1][0], 15, legs[1][1], 1.1, 1.3, m4), "#f2b705");
    steel.add(beamMatrix(legs[2][0], 15, legs[2][1], legs[3][0], 15, legs[3][1], 1.1, 1.3, m4), "#f2b705");
    trackPoint(fr, s, 3, tp);
    blocks.add(compose(tp.x, 13.6, tp.z, tp.h + Math.PI / 2, 3.2, 1.6, 15, m4), "#3a3f45");
  }

  // -- signals
  const signals: SignalVisual[] = [];
  for (const line of LINES) {
    const sites = signalSites(line);
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      const next = sites.slice(i + 1).find((q) => q.dir === site.dir);
      signals.push({ site, next, aspect: -1 });
    }
  }
  const lampGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
  const signalLamps = instanced(lampGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), signals.length);
  signals.forEach((sv, i) => {
    const line = lineById(sv.site.line);
    const s = sv.site.s;
    const lat = sv.site.dir * (halfSpacing(line, s) + 2.1);
    trackPoint(line, s, lat, tp);
    const y0 = tp.y - 0.3;
    blocks.add(compose(tp.x, y0 + 2.2, tp.z, tp.h, 0.18, 4.4, 0.18, m4), "#30353a");
    blocks.add(compose(tp.x, y0 + 4.5, tp.z, tp.h, 0.6, 1.5, 0.4, m4), "#151719");
    // lamp on the face toward the approaching trains
    const fx = Math.sin(tp.h) * sv.site.dir, fz = Math.cos(tp.h) * sv.site.dir;
    signalLamps.setMatrixAt(i, compose(tp.x - fx * 0.22, y0 + 4.85, tp.z - fz * 0.22, tp.h, 1, 1, 1, m4));
    signalLamps.setColorAt(i, new THREE.Color("#2aff6a"));
  });
  finish(signalLamps);

  // -- level crossings
  const armGeo = barrierArmGeometry();
  const lcs = LINES.flatMap((l) => l.levelCrossings);
  const arms = instanced(armGeo, vcMat(), lcs.length * 4, true);
  const lcLamps = instanced(new THREE.BoxGeometry(0.42, 0.42, 0.42), new THREE.MeshBasicMaterial({ toneMapped: false }), lcs.length * 4, true);
  const crossings: CrossingVisual[] = [];
  lcs.forEach((lc, k) => crossings.push(buildCrossing(lc, k, brick, blocks, lcLamps)));
  for (let i = 0; i < arms.count; i++) arms.setMatrixAt(i, HIDDEN);
  finish(arms);
  finish(lcLamps);

  // -- meshes
  const meshes: THREE.Object3D[] = [];
  const disposables: { dispose(): void }[] = [];
  const mBrick = vcMat({ side: THREE.DoubleSide });
  const mTrack = vcMat({ side: THREE.DoubleSide, roughness: 0.95 });
  const mGlass = new THREE.MeshStandardMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.38,
    roughness: 0.15,
    metalness: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const brickMesh = staticMesh(brick.build(), mBrick, true, true);
  const trackMesh = staticMesh(track.build(), mTrack, false, true);
  const glassMesh = staticMesh(glass.build(), mGlass, false, false);
  glassMesh.renderOrder = 2;
  meshes.push(brickMesh, trackMesh, glassMesh);

  const sleeperMesh = sleepers.mesh(UNIT_BOX, stdMat(SLEEPER, { roughness: 0.95 }));
  const archMesh = arches.mesh(archGeometry(), stdMat("#ffffff", { side: THREE.DoubleSide }), true, true);
  const blockMesh = blocks.mesh(UNIT_BOX, stdMat("#ffffff"), true, true);
  const steelMesh = steel.mesh(UNIT_BOX, stdMat("#ffffff", { metalness: 0.3, roughness: 0.6 }), true, true);
  const glowMat = new THREE.MeshStandardMaterial({ color: "#26303a", emissive: "#ffd28a", emissiveIntensity: 0, roughness: 0.4 });
  const glowMesh = glow.mesh(UNIT_BOX, glowMat);
  meshes.push(sleeperMesh, archMesh, blockMesh, steelMesh, glowMesh, signalLamps, arms, lcLamps);

  const wires = new THREE.BufferGeometry();
  wires.setAttribute("position", new THREE.Float32BufferAttribute(wireVerts, 3));
  wires.computeBoundingSphere();
  const wireMesh = new THREE.LineSegments(wires, new THREE.LineBasicMaterial({ color: "#2a2d30", transparent: true, opacity: 0.75 }));
  wireMesh.matrixAutoUpdate = false;
  meshes.push(wireMesh);

  // boards (one atlas)
  const boards = buildBoards();
  if (boards) meshes.push(boards);

  // clock faces + hands
  const clockMat = new THREE.MeshStandardMaterial({ map: clockFace(), emissive: "#fff2c8", emissiveIntensity: 0, roughness: 0.5 });
  const faceGeos = clockCentres.map((c) => {
    const g = new THREE.CircleGeometry(3.6, 32);
    g.applyMatrix4(compose(c.x, c.y, c.z, c.yaw, 1, 1, 1, m4));
    return g;
  });
  const faceMesh = staticMesh(mergeGeometries(faceGeos)!, clockMat, false, false);
  faceGeos.forEach((g) => g.dispose());
  const handGeo = new THREE.BoxGeometry(1, 1, 1);
  handGeo.translate(0, 0.5, 0);
  const clockHands = instanced(handGeo, new THREE.MeshBasicMaterial({ color: "#151515" }), clockCentres.length * 2, true);
  meshes.push(faceMesh, clockHands);

  // terminus sign
  {
    const signMat = new THREE.MeshStandardMaterial({ map: terminusSign(), emissive: "#ffffff", emissiveIntensity: 0, roughness: 0.6 });
    const g = new THREE.PlaneGeometry(26, 4);
    const sign = staticMesh(g, signMat, false, false);
    sign.position.set((TERMINUS.hotel.minX + TERMINUS.hotel.maxX) / 2 + 6, 9.2, TERMINUS.hotel.maxZ + 0.45);
    sign.updateMatrix();
    meshes.push(sign);
    disposables.push(signMat.map!, signMat, g);
    sign.userData.night = signMat;
  }

  for (const m of meshes) {
    if (m instanceof THREE.Mesh || m instanceof THREE.LineSegments) {
      if (m.geometry !== UNIT_BOX) disposables.push(m.geometry);
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mm of mats) {
        disposables.push(mm);
        const map = (mm as THREE.MeshStandardMaterial).map;
        if (map) disposables.push(map);
      }
    }
  }

  return {
    meshes,
    glowMat,
    clockMat,
    clockHands,
    clockCentres,
    signalLamps,
    signals,
    arms,
    lcLamps,
    crossings,
    sidings,
    dispose() {
      for (const d of new Set(disposables)) d.dispose();
      lampGeo.dispose();
    },
  };
}

// ---- Structures ------------------------------------------------------------------------------------

function deckHalf(line: Line, s: number) {
  return halfSpacing(line, s) + 2.9;
}

function centrePts(line: Line, s0: number, s1: number, step = 2): SweepPoint[] {
  return sampleLine(line, s0, s1, () => 0, step);
}

function buildStructures(line: Line, brick: Builder, arches: Inst, blocks: Inst, steel: Inst) {
  for (const run of styleRuns(line)) {
    if (run.style === "none" || run.style === "ground") continue;
    const pts = centrePts(line, run.s0, run.s1);
    const sAt = (i: number) => run.s0 + ((run.s1 - run.s0) * i) / (pts.length - 1);

    if (run.style === "embankment") {
      brick.sweep(
        pts,
        (i) => {
          const hw = deckHalf(line, sAt(i)) + 0.4;
          const y = pts[i].y;
          const spread = hw + Math.max(0, y - 0.3) * 1.35;
          return [[-spread, -y - 0.05], [-hw, -0.3], [hw, -0.3], [spread, -y - 0.05]];
        },
        GRASS,
      );
      // stone copings along the top edges
      for (const side of [-1, 1])
        brick.sweep(pts, (i) => {
          const hw = deckHalf(line, sAt(i)) + 0.4;
          return [[side * (hw - 0.4), -0.31], [side * (hw - 0.4), 0.15], [side * hw, 0.15], [side * hw, -0.31]];
        }, STONE);
      // wing walls where the embankment meets the arches
      for (const s of [run.s0, run.s1]) {
        trackPoint(line, s, 0, tp);
        const hw = deckHalf(line, s);
        blocks.add(compose(tp.x, (tp.y - 0.3) / 2, tp.z, tp.h, 2 * hw + 6, tp.y - 0.3 + 0.4, 1.6, m4), BRICK_DARK);
      }
      continue;
    }

    if (run.style === "truss") {
      buildTruss(line, run.s0, run.s1, brick, blocks, steel);
      continue;
    }

    // viaduct
    const { spans } = viaductLayout(line, run.s0, run.s1);
    const girderAt = (s: number) => spans.some((sp) => sp.girder && s >= sp.s0 - 0.5 && s <= sp.s1 + 0.5);
    brick.sweep(
      pts,
      (i) => {
        const hw = deckHalf(line, sAt(i));
        return [[-hw, -1.3], [hw, -1.3], [hw, 0.85], [hw - 0.35, 0.85], [hw - 0.35, -0.3], [-hw + 0.35, -0.3], [-hw + 0.35, 0.85], [-hw, 0.85]];
      },
      (i) => (girderAt(sAt(i)) ? STEEL_GREY : BRICK),
      true,
    );
    for (const sp of spans) {
      trackPoint(line, sp.s0, 0, tp);
      trackPoint(line, sp.s1, 0, tq);
      const bottom = Math.min(tp.y, tq.y) - 1.3;
      if (bottom < 0.25) continue;
      const len = Math.hypot(tq.x - tp.x, tq.z - tp.z);
      const yaw = Math.atan2(-(tq.z - tp.z), tq.x - tp.x);
      const width = 2 * Math.min(deckHalf(line, sp.s0), deckHalf(line, sp.s1));
      const mx = (tp.x + tq.x) / 2, mz = (tp.z + tq.z) / 2;
      if (sp.girder) {
        for (const side of [-1, 1]) {
          const lat = side * (width / 2 - 0.7);
          trackPoint(line, sp.s0, lat, tp);
          trackPoint(line, sp.s1, lat, tq);
          steel.add(beamMatrix(tp.x, tp.y - 1.9, tp.z, tq.x, tq.y - 1.9, tq.z, 0.5, 1.2, m4), "#2f4f45");
        }
        for (const s of [sp.s0, sp.s1]) {
          trackPoint(line, s, 0, tp);
          const pb = tp.y - 1.3;
          if (pb < 0.3) continue;
          blocks.add(compose(tp.x, (pb - 0.4) / 2, tp.z, tp.h, width - 0.4, pb + 0.4, 2.4, m4), BRICK_DARK);
        }
      } else if (bottom > 2.6) {
        arches.add(compose(mx, -0.4, mz, yaw, len + 0.05, bottom + 0.4, width, m4), BRICK);
      } else {
        blocks.add(compose(mx, (bottom - 0.4) / 2, mz, yaw, len + 0.05, bottom + 0.4, width - 0.2, m4), BRICK_DARK);
      }
    }
  }
}

/** Unit arch block: 1 x 1 x 1, base at y 0, centred in x and z, with an arch tunnel along z. */
function archGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0.5, 1);
  shape.lineTo(-0.5, 1);
  shape.lineTo(-0.5, 0);
  const hole = new THREE.Path();
  hole.moveTo(-0.39, 0);
  hole.lineTo(0.39, 0);
  hole.lineTo(0.39, 0.56);
  hole.absellipse(0, 0.56, 0.39, 0.32, 0, Math.PI, false);
  hole.lineTo(-0.39, 0);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -0.5);
  // ExtrudeGeometry puts the shape in x/y and extrudes along z: x = along the viaduct, z = across. Rotate so
  // the tunnel runs across the deck (local z) — it already does.
  g.computeVertexNormals();
  return g;
}

function buildTruss(line: Line, s0: number, s1: number, brick: Builder, blocks: Inst, steel: Inst) {
  const a = s0 - 4, b = s1 + 4;
  const pts = centrePts(line, a, b, 2);
  brick.sweep(pts, () => [[-5.4, -1.2], [5.4, -1.2], [5.4, -0.3], [-5.4, -0.3]], STEEL_GREY, true);
  const panels = Math.max(6, Math.round((b - a) / 8));
  const pl = (b - a) / panels;
  const top = 7.4;
  const lat = 5.2;
  const P = (s: number, side: number, up: number) => {
    trackPoint(line, s, side * lat, tp);
    return [tp.x, tp.y - 0.9 + up, tp.z] as const;
  };
  const beam = (p: readonly number[], q: readonly number[], w: number) => steel.add(beamMatrix(p[0], p[1], p[2], q[0], q[1], q[2], w, w, m4), TRUSS);
  for (const side of [-1, 1]) {
    for (let i = 0; i < panels; i++) {
      const sA = a + i * pl, sB = a + (i + 1) * pl;
      beam(P(sA, side, 0), P(sB, side, 0), 0.7); // bottom chord
      if (i > 0 && i < panels - 1) beam(P(sA, side, top), P(sB, side, top), 0.7); // top chord
      if (i > 0) beam(P(sA, side, 0), P(sA, side, top), 0.4); // vertical
      if (i === 0) beam(P(sA, side, 0), P(sB, side, top), 0.7); // end post
      else if (i === panels - 1) beam(P(sA, side, top), P(sB, side, 0), 0.7);
      else if (i % 2 === 1) beam(P(sA, side, top), P(sB, side, 0), 0.45);
      else beam(P(sA, side, 0), P(sB, side, top), 0.45);
    }
  }
  for (let i = 1; i < panels; i++) {
    const s = a + i * pl;
    beam(P(s, -1, top), P(s, 1, top), 0.35);
    if (i < panels - 1) {
      beam(P(s, -1, top), P(s + pl, 1, top), 0.22);
      beam(P(s, 1, top), P(s + pl, -1, top), 0.22);
    }
  }
  // abutments on the banks and a pier mid-river
  for (const s of [a, (a + b) / 2, b]) {
    trackPoint(line, s, 0, tp);
    const mid = s !== a && s !== b;
    const h = tp.y - 1.2 + (mid ? 4 : 1);
    blocks.add(compose(tp.x, tp.y - 1.2 - h / 2, tp.z, tp.h, 13, h, mid ? 4 : 5, m4), mid ? "#9a9488" : BRICK_DARK);
  }
}

function buildCatenary(line: Line, steel: Inst, wire: number[]) {
  const sites = gantrySites(line);
  const tracks = (s: number) => (halfSpacing(line, s) < 0.2 ? [0] : [halfSpacing(line, s), -halfSpacing(line, s)]);
  for (const s of sites) {
    const half = halfSpacing(line, s) + 2.7;
    trackPoint(line, s, half, tp);
    trackPoint(line, s, -half, tq);
    const y0 = tp.y - 0.3;
    steel.add(beamMatrix(tp.x, y0, tp.z, tp.x, y0 + 7.1, tp.z, 0.3, 0.3, m4), STEEL_GREY);
    steel.add(beamMatrix(tq.x, y0, tq.z, tq.x, y0 + 7.1, tq.z, 0.3, 0.3, m4), STEEL_GREY);
    steel.add(beamMatrix(tp.x, y0 + 6.9, tp.z, tq.x, y0 + 6.9, tq.z, 0.25, 0.4, m4), STEEL_GREY);
  }
  for (let i = 0; i < sites.length - 1; i++) {
    const sA = sites[i], sB = sites[i + 1];
    const steps = Math.max(1, Math.ceil((sB - sA) / 12));
    for (let k = 0; k < steps; k++) {
      const u = sA + ((sB - sA) * k) / steps, v = sA + ((sB - sA) * (k + 1)) / steps;
      const tu = tracks(u), tv = tracks(v);
      for (let j = 0; j < Math.min(tu.length, tv.length); j++) {
        trackPoint(line, u, tu[j], tp);
        trackPoint(line, v, tv[j], tq);
        wire.push(tp.x, tp.y + 5.6, tp.z, tq.x, tq.y + 5.6, tq.z);
      }
    }
  }
}

// ---- Stations --------------------------------------------------------------------------------------

function buildStation(line: Line, st: Line["stations"][number], brick: Builder, blocks: Inst, steel: Inst, glow: Inst) {
  const pts = centrePts(line, st.s0, st.s1, 2);
  brick.sweep(pts, () => [[-PLATFORM_HALF, -0.3], [PLATFORM_HALF, -0.3], [PLATFORM_HALF, 0.95], [-PLATFORM_HALF, 0.95]], PLATFORM, true);
  for (const side of [-1, 1])
    brick.sweep(pts, () => [[side * (PLATFORM_HALF - 0.45), 1.03], [side * PLATFORM_HALF, 1.03]], EDGE_YELLOW); // 8 cm proud of the platform: no z-fighting
  // canopy over the middle of the platform
  const c0 = st.s0 + (st.s1 - st.s0) * 0.15, c1 = st.s1 - (st.s1 - st.s0) * 0.15;
  const cp = centrePts(line, c0, c1, 2);
  brick.sweep(cp, () => [[-2.9, 4.5], [0, 5.1], [2.9, 4.5], [2.9, 4.3], [0, 4.9], [-2.9, 4.3]], "#e9e4da", true);
  for (let s = c0 + 3; s < c1; s += 9) {
    trackPoint(line, s, 0, tp);
    steel.add(beamMatrix(tp.x, tp.y + 0.95, tp.z, tp.x, tp.y + 4.7, tp.z, 0.22, 0.22, m4), "#2f5d50");
    glow.add(compose(tp.x, tp.y + 4.25, tp.z, tp.h, 0.5, 0.12, 1.4, m4));
  }
  // stairs up from the street: a brick tower beside the viaduct, a covered footbridge to the island
  const sc = (st.s0 + st.s1) / 2;
  const hw = halfSpacing(line, sc) + 2.9;
  trackPoint(line, sc, 0, tp);
  const y = tp.y;
  if (st.elevated) {
    const side = st.hall;
    trackPoint(line, sc, side * (hw + 3.2), tq);
    blocks.add(compose(tq.x, (y + 7) / 2, tq.z, tq.h, 5, y + 7, 5, m4), BRICK);
    blocks.add(compose(tq.x, y + 7.3, tq.z, tq.h, 5.6, 0.6, 5.6, m4), SLATE);
    const mid = (side * (hw + 3.2)) / 2;
    trackPoint(line, sc, mid, tq);
    blocks.add(compose(tq.x, y + 6.4, tq.z, tq.h, hw + 3.2, 2.6, 2.6, m4), "#d8d2c4");
    glow.add(compose(tq.x, y + 6.4, tq.z, tq.h, hw + 3.0, 0.8, 2.7, m4));
    blocks.add(compose(tp.x, y + 3.6, tp.z, tp.h, 2.0, 5.4, 4, m4), "#d8d2c4");
    // booking hall at street level
    trackPoint(line, sc + 12, side * (hw + 9), tq);
    blocks.add(compose(tq.x, 2.6, tq.z, tq.h, 9, 5.2, 16, m4), BRICK);
    blocks.add(compose(tq.x, 5.6, tq.z, tq.h, 9.6, 0.8, 16.6, m4), SLATE);
    for (const d of [-5, 0, 5]) {
      trackPoint(line, sc + 12 + d, side * (hw + 4.45), tq);
      glow.add(compose(tq.x, 2.4, tq.z, tq.h, 0.12, 2.2, 2.4, m4));
    }
  } else {
    // terminal building across the buffer end
    trackPoint(line, line.L, 0, tq);
    const fx = Math.sin(tq.h), fz = Math.cos(tq.h), lx = Math.cos(tq.h), lz = -Math.sin(tq.h);
    const bx = tq.x + fx * 5, bz = tq.z + fz * 5;
    blocks.add(compose(bx, 3.2, bz, tq.h, 22, 6.4, 8, m4), BRICK);
    blocks.add(compose(bx, 7.0, bz, tq.h, 22.6, 1.2, 8.6, m4), SLATE);
    blocks.add(compose(bx, 8.8, bz, tq.h, 4, 3.6, 4, m4), STONE);
    for (const d of [-8, -4, 4, 8]) glow.add(compose(bx - fx * 4.05 + lx * d, 3.0, bz - fz * 4.05 + lz * d, tq.h, 2.2, 2.6, 0.12, m4));
  }
}

function buildBoards(): THREE.Mesh | null {
  const atlas = boardAtlas();
  const geos: THREE.BufferGeometry[] = [];
  const add = (name: string, x: number, y: number, z: number, yaw: number, w = 5.2, h = 0.65) => {
    const g = new THREE.PlaneGeometry(w, h);
    const [v0, v1] = boardRow(name);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) > 0.5 ? v1 : v0);
    // double-sided: a back face too
    const back = g.clone();
    back.rotateY(Math.PI);
    for (const gg of [g, back]) {
      gg.applyMatrix4(compose(x, y, z, yaw, 1, 1, 1, m4));
      geos.push(gg);
    }
  };
  for (const line of LINES)
    for (const st of line.stations) {
      if (!st.board) continue;
      for (const f of [0.25, 0.75]) {
        const s = st.s0 + (st.s1 - st.s0) * f;
        trackPoint(line, s, 0, tp);
        add(st.name, tp.x, tp.y + 3.4, tp.z, tp.h + Math.PI / 2);
      }
    }
  // terminus platforms
  for (const x of TERMINUS.islands) for (const z of [-372, -430]) add(TERMINUS.name, x, H + 3.4, z, Math.PI / 2, 4.2, 0.55);
  if (!geos.length) return null;
  const merged = mergeGeometries(geos)!;
  geos.forEach((g) => g.dispose());
  const mesh = staticMesh(merged, new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.6, emissive: "#ffffff", emissiveMap: atlas, emissiveIntensity: 0 }), false, false);
  mesh.userData.night = mesh.material;
  return mesh;
}

// ---- Level crossings -----------------------------------------------------------------------------------

/** Barrier arm along +x from the pivot: red/white stripes, a red tip lamp. */
function barrierArmGeometry() {
  const b = new Builder();
  const n = 8;
  for (let i = 0; i < n; i++) b.box(0.6 + (i + 0.5) * 0.6, 0, 0, 0.6, 0.16, 0.12, 0, i % 2 ? "#ffffff" : "#e3261b");
  b.box(0.3, 0, 0, 0.6, 0.3, 0.3, 0, "#2b2f33"); // counterweight end
  return b.build();
}

function buildCrossing(lc: LevelCrossing, k: number, brick: Builder, blocks: Inst, lamps: THREE.InstancedMesh): CrossingVisual {
  const line = lineById(lc.line);
  trackPoint(line, lc.s, 0, tp);
  const th = tp.h;
  const rh = lc.roadHeading;
  const rx = Math.sin(rh), rz = Math.cos(rh); // along the road
  const nx = Math.cos(rh), nz = -Math.sin(rh); // across the road (left of its direction)
  const sinA = Math.max(0.35, Math.abs(Math.sin(rh - th)));
  const zone = (halfSpacing(line, lc.s) + 2.2) / sinA; // along-road half length of the track zone
  // rubber crossing panels over the rails, the width of the road
  brick.box(lc.x, 0.2, lc.z, lc.roadHalf * 2, 0.3, ((halfSpacing(line, lc.s) + 1.6) * 2) / sinA, rh, "#55585d");
  for (const side of [-1, 1]) {
    // white stop lines on the road either side
    const d = side * (zone + 4.2);
    brick.box(lc.x + Math.sin(rh) * d, 0.1, lc.z + Math.cos(rh) * d, lc.roadHalf * 2, 0.06, 0.4, rh, "#f2f2f2");
  }
  const armPivots: CrossingVisual["armPivots"] = [];
  let lampIdx = k * 4;
  for (const side of [-1, 1]) {
    const d = side * (zone + 2.4);
    const cx = lc.x + rx * d, cz = lc.z + rz * d;
    for (const across of [-1, 1]) {
      const px = cx + nx * across * (lc.roadHalf + 0.8), pz = cz + nz * across * (lc.roadHalf + 0.8);
      blocks.add(compose(px, 0.6, pz, rh, 0.5, 1.2, 0.5, m4), "#f0f0f0");
      // arm points across the road toward its centre line
      const yaw = Math.atan2(-(-nz * across), -nx * across);
      armPivots.push({ x: px, y: 1.1, z: pz, yaw, len: lc.roadHalf + 0.6 });
    }
    // wig-wag light post on the left of approaching traffic (traffic arriving from this side drives on its left)
    const across = side > 0 ? -1 : 1;
    const lx = cx + rx * side * 1.8 + nx * across * (lc.roadHalf + 1.8);
    const lz = cz + rz * side * 1.8 + nz * across * (lc.roadHalf + 1.8);
    blocks.add(compose(lx, 1.6, lz, rh, 0.22, 3.2, 0.22, m4), "#202326");
    blocks.add(compose(lx, 2.75, lz, rh + Math.PI / 2, 1.9, 0.75, 0.25, m4), "#111314");
    blocks.add(compose(lx, 3.6, lz, rh + Math.PI / 2, 1.2, 0.35, 0.3, m4), "#f2c230");
    for (const off of [-0.6, 0.6]) {
      lamps.setMatrixAt(lampIdx, compose(lx + nx * off, 2.75, lz + nz * off, rh, 1, 1, 1, m4));
      lamps.setColorAt(lampIdx, new THREE.Color("#3a0b08"));
      lampIdx++;
    }
  }
  return { lc, armBase: k * 4, armPivots, lampBase: k * 4, lamps: 4 };
}

// ---- The terminus ----------------------------------------------------------------------------------

function buildTerminus(brick: Builder, glass: Builder, arches: Inst, blocks: Inst, steel: Inst, glow: Inst) {
  const U = TERMINUS.undercroft;
  const S = TERMINUS.shed;
  const Ht = TERMINUS.hotel;
  const cx = (S.minX + S.maxX) / 2;
  const cz = (S.minZ + S.maxZ) / 2;
  const len = S.maxZ - S.minZ;
  const r = (S.maxX - S.minX) / 2;

  // undercroft: solid core and an arcade of arches round the outside
  brick.box((U.minX + U.maxX) / 2, DECK_TOP / 2, (U.minZ + U.maxZ) / 2, U.maxX - U.minX - 2, DECK_TOP, U.maxZ - U.minZ - 2, 0, BRICK_DARK);
  brick.box((U.minX + U.maxX) / 2, DECK_TOP - 0.25, (U.minZ + U.maxZ) / 2, U.maxX - U.minX + 0.4, 0.5, U.maxZ - U.minZ + 0.4, 0, STONE);
  const bay = 8;
  for (const [x0, z0, x1, z1] of [
    [U.minX, U.minZ, U.minX, U.maxZ],
    [U.maxX, U.minZ, U.maxX, U.maxZ],
    [U.minX, U.minZ, U.maxX, U.minZ],
  ] as const) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.round(L / bay);
    const yaw = Math.atan2(-(z1 - z0), x1 - x0);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      arches.add(compose(x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t, yaw, L / n + 0.02, DECK_TOP - 0.5, 2.2, m4), BRICK);
    }
  }
  // platforms
  for (const x of TERMINUS.islands) {
    brick.box(x, H + 0.3, (TERMINUS.buffersZ + TERMINUS.platformEndZ) / 2 - 0.5, PLATFORM_HALF * 2, 1.3, TERMINUS.buffersZ - TERMINUS.platformEndZ, 0, PLATFORM);
    for (const side of [-1, 1]) brick.box(x + side * (PLATFORM_HALF - 0.22), H + 1.0, (TERMINUS.buffersZ + TERMINUS.platformEndZ) / 2 - 0.5, 0.44, 0.02, TERMINUS.buffersZ - TERMINUS.platformEndZ, 0, EDGE_YELLOW);
  }
  // concourse deck at the buffer end
  brick.box(cx, H + 0.3, -331.5, S.maxX - S.minX - 2, 1.3, 3, 0, PLATFORM);
  // buffer stops
  for (const x of TERMINUS.islands)
    for (const side of [-1, 1]) blocks.add(compose(x + side * ISLAND_HALF, H + 0.7, TERMINUS.buffersZ + 0.4, 0, 2.2, 1.0, 0.8, m4), "#c0392b");

  // side walls of the shed with a stone cornice
  const wallTop = DECK_TOP + 6.5;
  for (const x of [S.minX, S.maxX]) {
    brick.box(x, (DECK_TOP + wallTop) / 2, cz, 1.2, wallTop - DECK_TOP, len, 0, BRICK);
    brick.box(x, wallTop + 0.3, cz, 1.8, 0.6, len, 0, STONE);
    for (let z = S.minZ + 6; z < S.maxZ - 4; z += 8) glow.add(compose(x + (x < cx ? -0.62 : 0.62), DECK_TOP + 3.4, z, 0, 0.1, 3.2, 2.2, m4));
  }

  // the barrel vault: slate sides, glazed crown, sky-blue ribs
  const rise = 0.6;
  const vault = (t0: number, t1: number, color: string, target: Builder) => {
    const g = new THREE.CylinderGeometry(r, r, len, 40, 1, true, Math.PI / 2 + t0 * Math.PI, (t1 - t0) * Math.PI);
    g.rotateX(Math.PI / 2);
    g.scale(1, rise, 1);
    g.translate(cx, wallTop + 0.6, cz);
    target.geometry(g, m4.identity(), color);
    g.dispose();
  };
  vault(0, 0.24, "#5f7584", brick);
  vault(0.76, 1, "#5f7584", brick);
  vault(0.24, 0.76, "#cfe3ef", glass);
  const ribs = Math.round(len / 9);
  for (let i = 0; i <= ribs; i++) {
    const z = S.minZ + (len * i) / ribs;
    let px = cx + r, py = wallTop + 0.6;
    for (let k = 1; k <= 16; k++) {
      const a = (k / 16) * Math.PI;
      const qx = cx + Math.cos(a) * (r - 0.4), qy = wallTop + 0.6 + Math.sin(a) * (r - 0.4) * rise;
      steel.add(beamMatrix(px, py, z, qx, qy, z, 0.5, 0.5, m4), IRON_BLUE);
      px = qx;
      py = qy;
    }
  }
  // ridge lantern along the crown
  brick.box(cx, wallTop + 0.6 + r * rise + 0.6, cz, 3, 1.2, len - 2, 0, "#5f7584");
  // north gable: glazed screen with mullions
  {
    const g = new THREE.CircleGeometry(r, 40, 0, Math.PI);
    g.scale(1, rise, 1);
    g.translate(cx, wallTop + 0.6, S.minZ - 0.2);
    glass.geometry(g, m4.identity(), "#d7e8f2");
    g.dispose();
    brick.box(cx, (DECK_TOP + wallTop + 0.6) / 2, S.minZ - 0.2, 2 * r, wallTop + 0.6 - DECK_TOP, 0.8, 0, BRICK);
    for (let k = -4; k <= 4; k++) {
      const x = cx + (k / 5) * r;
      const yTop = wallTop + 0.6 + Math.sqrt(Math.max(0, 1 - (k / 5) ** 2)) * r * rise;
      steel.add(beamMatrix(x, wallTop + 0.6, S.minZ - 0.3, x, yTop, S.minZ - 0.3, 0.35, 0.35, m4), IRON_BLUE);
    }
  }

  // goods yard: long brick goods shed on the east side (coal-drops style)
  {
    const G = TERMINUS.goodsYard;
    const x = G.maxX - 4.5;
    blocks.add(compose(x, DECK_TOP + 3, (G.minZ + G.maxZ) / 2, 0, 7, 6, G.maxZ - G.minZ - 20, m4), BRICK);
    blocks.add(compose(x, DECK_TOP + 6.5, (G.minZ + G.maxZ) / 2, 0, 8, 1, G.maxZ - G.minZ - 19, m4), SLATE);
    for (let z = G.minZ + 16; z < G.maxZ - 12; z += 9) glow.add(compose(x - 3.55, DECK_TOP + 2.2, z, 0, 0.1, 2.4, 3, m4));
  }

  // the hotel (headhouse): red brick, stone bands, slate roof with gables, pinnacles
  const hx = (Ht.minX + Ht.maxX) / 2;
  const hz = (Ht.minZ + Ht.maxZ) / 2;
  const hw = Ht.maxX - Ht.minX;
  const hd = Ht.maxZ - Ht.minZ;
  const eaves = 22;
  brick.box(hx, eaves / 2, hz, hw, eaves, hd, 0, BRICK);
  for (const y of [5.6, 11.2, 16.8, eaves - 0.3]) brick.box(hx, y, hz, hw + 0.5, 0.45, hd + 0.5, 0, STONE);
  // roof prism along x
  const roofTop = eaves + 8;
  {
    const x0 = Ht.minX, x1 = Ht.maxX;
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    brick.quad(v(x0, eaves, Ht.maxZ + 0.3), v(x1, eaves, Ht.maxZ + 0.3), v(x1, roofTop, hz), v(x0, roofTop, hz), SLATE);
    brick.quad(v(x1, eaves, Ht.minZ - 0.3), v(x0, eaves, Ht.minZ - 0.3), v(x0, roofTop, hz), v(x1, roofTop, hz), SLATE);
    brick.tri(v(x0, eaves, Ht.minZ - 0.3), v(x0, eaves, Ht.maxZ + 0.3), v(x0, roofTop, hz), BRICK);
    brick.tri(v(x1, eaves, Ht.maxZ + 0.3), v(x1, eaves, Ht.minZ - 0.3), v(x1, roofTop, hz), BRICK);
    // gabled dormers along the front
    const gables = 9;
    for (let i = 0; i < gables; i++) {
      const gx = x0 + 12 + ((hw - 24) * i) / (gables - 1);
      const fz = Ht.maxZ + 0.35;
      brick.tri(v(gx - 3.2, eaves, fz), v(gx + 3.2, eaves, fz), v(gx, eaves + 6.5, fz), BRICK);
      brick.quad(v(gx - 3.2, eaves, fz), v(gx, eaves + 6.5, fz), v(gx, eaves + 6.5, fz - 4), v(gx - 3.2, eaves + 1, fz - 4), SLATE);
      brick.quad(v(gx, eaves + 6.5, fz), v(gx + 3.2, eaves, fz), v(gx + 3.2, eaves + 1, fz - 4), v(gx, eaves + 6.5, fz - 4), SLATE);
      glow.add(compose(gx, eaves + 2.2, fz + 0.05, 0, 1.3, 2.4, 0.1, m4));
    }
  }
  // windows: four floors of pointed gothic windows on the front
  for (let f = 0; f < 4; f++)
    for (let i = 0; i < 24; i++) {
      const x = Ht.minX + 4 + ((hw - 8) * i) / 23;
      if (Math.abs(x - TERMINUS.clock.x) < 8) continue;
      if (f === 0 && Math.abs(x - (hx + 6)) < 9) continue; // entrance
      glow.add(compose(x, 2.6 + f * 5.6, Ht.maxZ + 0.08, 0, 1.6, 2.8, 0.14, m4));
    }
  // entrance porch
  blocks.add(compose(hx + 6, 3.2, Ht.maxZ + 3, 0, 16, 6.4, 6, m4), BRICK_DARK);
  blocks.add(compose(hx + 6, 6.7, Ht.maxZ + 3, 0, 17, 0.8, 6.8, m4), STONE);
  glow.add(compose(hx + 6, 2.4, Ht.maxZ + 6.05, 0, 9, 4.2, 0.12, m4));
  // pinnacles along the roof line
  const cone = new THREE.ConeGeometry(1, 1, 4);
  for (let i = 0; i <= 10; i++) {
    const x = Ht.minX + (hw * i) / 10;
    for (const z of [Ht.maxZ, Ht.minZ]) {
      const g = cone.clone();
      g.applyMatrix4(compose(x, eaves + 2.6, z, Math.PI / 4, 0.9, 5.2, 0.9, m4));
      brick.geometry(g, m4.identity(), STONE);
      g.dispose();
    }
  }

  // clock tower (west) and the smaller east tower
  const clockCentres: { x: number; y: number; z: number; yaw: number }[] = [];
  const tower = (x: number, z: number, w: number, shaft: number, spire: number, clock: boolean) => {
    brick.box(x, shaft / 2, z, w, shaft, w, 0, BRICK);
    for (const y of [eaves - 0.3, shaft - 8, shaft - 0.3]) brick.box(x, y, z, w + 0.6, 0.5, w + 0.6, 0, STONE);
    brick.box(x, shaft + 1.5, z, w - 1, 3, w - 1, 0, STONE);
    const g = cone.clone();
    g.applyMatrix4(compose(x, shaft + 3 + spire / 2, z, Math.PI / 4, (w - 1) * 0.72, spire, (w - 1) * 0.72, m4));
    brick.geometry(g, m4.identity(), SLATE);
    g.dispose();
    for (const dx of [-1, 1])
      for (const dz of [-1, 1]) {
        const p = cone.clone();
        p.applyMatrix4(compose(x + (dx * w) / 2, shaft + 3.2, z + (dz * w) / 2, Math.PI / 4, 0.8, 6.4, 0.8, m4));
        brick.geometry(p, m4.identity(), STONE);
        p.dispose();
      }
    if (clock) {
      const y = shaft - 4;
      clockCentres.push({ x, y, z: z + w / 2 + 0.06, yaw: 0 });
      clockCentres.push({ x, y, z: z - w / 2 - 0.06, yaw: Math.PI });
      clockCentres.push({ x: x + w / 2 + 0.06, y, z, yaw: Math.PI / 2 });
      clockCentres.push({ x: x - w / 2 - 0.06, y, z, yaw: -Math.PI / 2 });
    }
    for (let f = 0; f < Math.floor((shaft - 10) / 6); f++) glow.add(compose(x, 6 + f * 6, z + w / 2 + 0.08, 0, 1.2, 3, 0.14, m4));
  };
  tower(TERMINUS.clock.x, TERMINUS.clock.z, TERMINUS.clock.w, 48, 16, true);
  tower(Ht.maxX - 6, TERMINUS.clock.z, 9, 34, 10, false);
  cone.dispose();
  return { clockCentres };
}

