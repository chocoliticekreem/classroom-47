// Elevated Underground-style metro: viaducts, stations (platform, canopy, stairs, roundels),
// shuttling 4-car trains with sliding doors, and platform crowds boarding and alighting.
// Trains run on their own track (not in the road registry). Everything is instanced.
import * as THREE from "three";
import { growWaiting, planVisit } from "./crowd";
import { Rig, finishStatic, frame, instanced, local, stairsGeometry, std } from "./kit";
import { METRO_LINES, buildTrack, pillarSites, projectS, trackPose, type MetroLine, type Track, type TrackPose } from "./metroLayout";
import { buildShuttle, doorOpenAmount, sampleShuttle, type Shuttle, type TrainSample } from "./motion";
import { END, PassengerPool, ST } from "./passengers";
import { mulberry32 } from "./rng";
import { roundelTexture } from "./textures";

const TRACK_LAT = 1.9; // each track's offset from the viaduct centre line
const CARS = 4;
const CAR_LEN = 7;
const PITCH = 7.4;
const DOORS = [-1.8, 1.8]; // door centres along each car
const SEG = 4; // viaduct segment length
const PLATFORM_HALF = 15;
const PLAT_Y = 0.9; // platform top above the beam top
const MAX_WAIT = 12;
const ARRIVAL_RATE = 0.1;
const CAPACITY = 160;
const SHUTTLE = { vmax: 13, accel: 1.0, dwell: 7.5 };

interface Frame {
  x: number;
  z: number;
  h: number;
}

interface Platform {
  line: number;
  station: number;
  side: number; // +1 / -1: which track it serves
  fr: Frame; // centre line at the station, rotated so +lateral points at this platform
  y: number; // platform surface height
  ground: number; // relative y of the ground (-H)
  stairTop: number; // along of the stair top
  agents: Int16Array;
  n: number;
}

interface Train {
  line: number;
  side: number;
  offset: number;
  sample: TrainSample;
  prevStation: number;
  onboard: number;
  visit: Platform | null;
  alightLeft: number;
  boardLeft: number;
  releaseT: number;
  doorK: number;
}

function at(fr: Frame, along: number, lat: number, out: { x: number; z: number }) {
  const c = Math.cos(fr.h), s = Math.sin(fr.h);
  out.x = fr.x + lat * c + along * s;
  out.z = fr.z - lat * s + along * c;
  return out;
}

const stairRun = (H: number) => Math.min(16, (H + PLAT_Y) * 1.05);

export function createMetro(pool: PassengerPool, seed = 77) {
  const rand = mulberry32(seed);
  const pt = { x: 0, z: 0 };
  const pose: TrackPose = { x: 0, z: 0, h: 0 };
  const m4 = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const col = new THREE.Color();

  const tracks: Track[] = METRO_LINES.map((l) => buildTrack(l.points, l.radius));
  const stationS: number[][] = METRO_LINES.map((l, i) => l.stations.map((s) => projectS(tracks[i], s.x, s.z)));
  const shuttles: Shuttle[] = stationS.map((ss) => buildShuttle(ss, SHUTTLE));

  // --- shared geometry & materials --------------------------------------------------------------
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8).translate(0, 0.5, 0);
  const pillarGeo = new THREE.CylinderGeometry(0.55, 0.7, 1, 8).translate(0, 0.5, 0);
  const stairGeo = stairsGeometry(16);
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const concrete = std("#c9c4ba");
  const concreteDark = std("#a8a39a");
  const ballast = std("#4a4640");
  const steel = std("#8a9096", { roughness: 0.45, metalness: 0.3 });
  const tint = std("#ffffff"); // instance-coloured (line colours)
  const platformMat = std("#d9d5cc");
  const yellow = std("#f2c200");
  const canopyMat = std("#f1f1ec");
  const fenceMat = std("#33383d");
  const geos: THREE.BufferGeometry[] = [unitBox, unitCyl, pillarGeo, stairGeo, planeGeo];
  const mats: THREE.Material[] = [concrete, concreteDark, ballast, steel, tint, platformMat, yellow, canopyMat, fenceMat];
  const texs: THREE.Texture[] = [];
  const statics: THREE.InstancedMesh[] = [];

  // --- viaducts --------------------------------------------------------------------------------
  type Seg = { line: number; s: number };
  const segs: Seg[] = [];
  const parapets: { line: number; s: number; side: number }[] = [];
  const pillars: { line: number; s: number }[] = [];
  METRO_LINES.forEach((l, li) => {
    const t = tracks[li];
    const n = Math.ceil(t.length / SEG);
    for (let k = 0; k < n; k++) {
      const s = Math.min(t.length - SEG / 2, (k + 0.5) * SEG);
      segs.push({ line: li, s });
      const nearStation = stationS[li].some((ss) => Math.abs(ss - s) < PLATFORM_HALF + SEG / 2);
      if (!nearStation) for (const side of [-1, 1]) parapets.push({ line: li, s, side });
    }
    for (const s of pillarSites(t, 20)) pillars.push({ line: li, s });
  });

  const beam = instanced(unitBox, concrete, segs.length);
  const bed = instanced(unitBox, ballast, segs.length * 2);
  const rails = instanced(unitBox, steel, segs.length * 4);
  const parapet = instanced(unitBox, tint, parapets.length);
  const pillarM = instanced(pillarGeo, concreteDark, pillars.length);
  const caps = instanced(unitBox, concreteDark, pillars.length);
  beam.castShadow = true;
  pillarM.castShadow = true;
  const segFrame = (li: number, s: number, y: number) => {
    trackPose(tracks[li], s, pose);
    return frame(pose.x, y, pose.z, pose.h, m4);
  };
  segs.forEach((sg, i) => {
    const H = METRO_LINES[sg.line].height;
    const F = segFrame(sg.line, sg.s, H);
    beam.setMatrixAt(i, tmp.multiplyMatrices(F, local(0, -0.55, 0, 0, 7.6, 1.1, SEG + 0.08)));
    [-1, 1].forEach((side, k) => {
      bed.setMatrixAt(i * 2 + k, tmp.multiplyMatrices(F, local(side * TRACK_LAT, 0.08, 0, 0, 2.5, 0.16, SEG)));
      [-0.72, 0.72].forEach((r, j) =>
        rails.setMatrixAt(i * 4 + k * 2 + j, tmp.multiplyMatrices(F, local(side * TRACK_LAT + r, 0.24, 0, 0, 0.12, 0.14, SEG + 0.02))),
      );
    });
  });
  parapets.forEach((p, i) => {
    const F = segFrame(p.line, p.s, METRO_LINES[p.line].height);
    parapet.setMatrixAt(i, tmp.multiplyMatrices(F, local(p.side * 3.7, 0.3, 0, 0, 0.22, 0.6, SEG + 0.08)));
    parapet.setColorAt(i, col.set(METRO_LINES[p.line].color));
  });
  pillars.forEach((p, i) => {
    const H = METRO_LINES[p.line].height;
    const F = segFrame(p.line, p.s, 0);
    pillarM.setMatrixAt(i, tmp.multiplyMatrices(F, local(0, 0, 0, 0, 1, H - 1.4, 1)));
    caps.setMatrixAt(i, tmp.multiplyMatrices(F, local(0, H - 1.5, 0, 0, 6.2, 0.7, 1.8)));
  });
  statics.push(beam, bed, rails, parapet, pillarM, caps);

  // --- stations ---------------------------------------------------------------------------------
  const platforms: Platform[] = [];
  const undergroundTex = roundelTexture("UNDERGROUND", "#e1251b");
  texs.push(undergroundTex);
  const smallRoundel = new THREE.MeshStandardMaterial({ map: undergroundTex, alphaTest: 0.5, roughness: 0.7 });
  mats.push(smallRoundel);

  METRO_LINES.forEach((line: MetroLine, li) => {
    const H = line.height;
    const run = stairRun(H);
    const top = -16 + run;
    const nSt = line.stations.length;
    const rig = new Rig(nSt * 2);
    const fenceLen = PLATFORM_HALF - (top + 1.6);
    const fascia = std(line.color);
    mats.push(fascia);
    rig.part(unitBox, platformMat, [local(4.6, 0.15, 0, 0, 2.4, 1.5, PLATFORM_HALF * 2)], true);
    rig.part(unitBox, yellow, [local(3.55, PLAT_Y + 0.01, 0, 0, 0.22, 0.02, PLATFORM_HALF * 2)]);
    rig.part(unitBox, canopyMat, [local(4.7, PLAT_Y + 3.35, 2, 0, 3.0, 0.16, 24)], true);
    rig.part(unitBox, fascia, [local(6.2, PLAT_Y + 3.2, 2, 0, 0.12, 0.42, 24), local(3.2, PLAT_Y + 3.2, 2, 0, 0.12, 0.42, 24)]);
    rig.part(unitCyl, fenceMat, [
      ...[-8, 2, 12].map((a) => local(5.4, PLAT_Y, a, 0, 0.16, 3.35, 0.16)),
      local(4.7, PLAT_Y + 3.4, 7, 0, 0.12, 1.4, 0.12), // roundel post on the canopy
      local(4.75, -H, -17.5, 0, 0.12, 3.4, 0.12), // street roundel post at the stair foot
    ]);
    rig.part(unitBox, fenceMat, [local(5.75, PLAT_Y + 0.55, top + 1.6 + fenceLen / 2, 0, 0.05, 1.1, fenceLen)]);
    rig.part(stairGeo, concrete, [local(6.4, -H, -16, 0, 1.2, H + PLAT_Y, run)], true);
    rig.part(planeGeo, smallRoundel, [
      local(4.75, -H + 3.3, -17.5, 0, 1.0, 1.0, 1),
      local(4.75, -H + 3.3, -17.5, Math.PI, 1.0, 1.0, 1),
    ]);

    line.stations.forEach((st, si) => {
      const s = stationS[li][si];
      trackPose(tracks[li], s, pose);
      // big roundel with the station name, both sides, standing on each canopy
      const tex = roundelTexture(st.name, line.id === "red" ? "#e1251b" : "#1c5fd6");
      const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.7, side: THREE.FrontSide });
      texs.push(tex);
      mats.push(mat);
      const sign = instanced(planeGeo, mat, 4);
      [-1, 1].forEach((side, k) => {
        const fr: Frame = { x: pose.x, z: pose.z, h: side > 0 ? pose.h : pose.h + Math.PI };
        frame(fr.x, H, fr.z, fr.h, m4);
        rig.set(si * 2 + k, m4);
        sign.setMatrixAt(k * 2, tmp.multiplyMatrices(m4, local(4.75, PLAT_Y + 5.6, 7, Math.PI / 2, 2.6, 2.6, 1)));
        sign.setMatrixAt(k * 2 + 1, tmp.multiplyMatrices(m4, local(4.65, PLAT_Y + 5.6, 7, -Math.PI / 2, 2.6, 2.6, 1)));
        platforms.push({
          line: li, station: si, side, fr, y: H + PLAT_Y, ground: -H, stairTop: top,
          agents: new Int16Array(MAX_WAIT), n: 0,
        });
      });
      statics.push(sign);
    });
    rig.commit();
    for (const m of rig.meshes) statics.push(m);
  });
  for (const m of statics) finishStatic(m);

  const platformOf = (li: number, si: number, side: number) =>
    platforms.find((p) => p.line === li && p.station === si && p.side === side)!;

  // --- platform crowds ---------------------------------------------------------------------------
  const slot = (k: number) => ({ along: 2 + (k % 6) * 2.0, lat: 4.3 + Math.floor(k / 6) * 0.75 });

  function addWaiting(p: Platform, walkIn: boolean) {
    if (p.n >= MAX_WAIT) return;
    const sl = slot(p.n);
    let i: number;
    if (walkIn) {
      at(p.fr, -19, 6.4, pt);
      i = pool.spawn(pt.x, 0, pt.z);
      if (i < 0) return;
      at(p.fr, -16, 6.4, pt);
      pool.addWaypoint(i, pt.x, 0, pt.z);
      at(p.fr, p.stairTop + 0.2, 6.4, pt);
      pool.addWaypoint(i, pt.x, p.y, pt.z);
      at(p.fr, p.stairTop + 1.1, 5.0, pt);
      pool.addWaypoint(i, pt.x, p.y, pt.z);
      at(p.fr, sl.along, sl.lat, pt);
      pool.addWaypoint(i, pt.x, p.y, pt.z);
    } else {
      at(p.fr, sl.along, sl.lat, pt);
      i = pool.spawn(pt.x, p.y, pt.z);
      if (i < 0) return;
    }
    // face the track
    pool.finish(i, END.IDLE, Math.atan2(-Math.cos(p.fr.h), Math.sin(p.fr.h)) + (rand() - 0.5) * 0.6);
    p.agents[p.n++] = i;
  }

  function takeWaiting(p: Platform): number {
    while (p.n > 0) {
      const i = p.agents[0];
      p.agents.copyWithin(0, 1, p.n);
      p.n--;
      if (pool.state[i] === ST.IDLE || pool.state[i] === ST.WALK) return i;
    }
    return -1;
  }

  for (const p of platforms) {
    const n = 2 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) addWaiting(p, false);
  }

  // door centres along the platform frame (train symmetric about the station centre)
  const doorAlong: number[] = [];
  for (let c = 0; c < CARS; c++) for (const d of DOORS) doorAlong.push((c - (CARS - 1) / 2) * PITCH + d);

  // --- trains -------------------------------------------------------------------------------------
  const trains: Train[] = [];
  METRO_LINES.forEach((_, li) => {
    [-1, 1].forEach((side, k) => {
      trains.push({
        line: li, side, offset: k * shuttles[li].cycle * 0.5 + li * 11,
        sample: { s: 0, station: -1, dwellT: -1, moving: true }, prevStation: -1,
        onboard: 20 + Math.floor(rand() * 40), visit: null, alightLeft: 0, boardLeft: 0, releaseT: 0, doorK: 0,
      });
    });
  });
  const carCount = trains.length * CARS;
  const windowMat = std("#1a2430", { roughness: 0.3, emissive: new THREE.Color("#fff1c9"), emissiveIntensity: 0 });
  const bodyMat = std("#eef0f2", { roughness: 0.5 });
  const roofMat = std("#9aa3ab");
  const darkMat = std("#23272b");
  mats.push(windowMat, bodyMat, roofMat, darkMat);
  const carRig = new Rig(carCount);
  carRig.part(unitBox, bodyMat, [local(0, 1.85, 0, 0, 2.7, 2.7, CAR_LEN)], true);
  carRig.part(unitBox, roofMat, [local(0, 3.25, 0, 0, 2.4, 0.22, CAR_LEN - 0.2)]);
  carRig.part(unitBox, darkMat, [
    local(0, 0.38, 0, 0, 2.2, 0.5, CAR_LEN - 1.2), // bogies
    local(0, 2.0, 0, 0, 2.3, 1.5, CAR_LEN + 0.04), // ends / windscreens
    ...DOORS.flatMap((d) => [-1, 1].map((sd) => local(sd * 1.355, 1.6, d, 0, 0.05, 1.95, 1.24))), // doorways
  ]);
  carRig.part(unitBox, windowMat, [local(0, 2.2, 0, 0, 2.74, 0.8, CAR_LEN - 0.8)]);
  const stripe = carRig.part(unitBox, tint, [local(0, 1.2, 0, 0, 2.76, 0.32, CAR_LEN + 0.02)]);
  trains.forEach((tr, ti) => {
    for (let c = 0; c < CARS; c++) stripe.setColorAt(ti * CARS + c, col.set(METRO_LINES[tr.line].color));
  });
  stripe.instanceColor!.needsUpdate = true;
  // sliding door leaves: per car 2 doors x 2 leaves x 2 sides
  const LEAVES = DOORS.length * 2 * 2;
  const leaves = instanced(unitBox, tint, carCount * LEAVES, true);
  for (let i = 0; i < carCount; i++) {
    const tr = trains[Math.floor(i / CARS)];
    for (let k = 0; k < LEAVES; k++) leaves.setColorAt(i * LEAVES + k, col.set(METRO_LINES[tr.line].color));
  }
  leaves.instanceColor!.needsUpdate = true;
  const leafLocal = new THREE.Matrix4();

  // --- per-frame ----------------------------------------------------------------------------------
  function beginVisit(tr: Train, p: Platform) {
    tr.visit = p;
    const v = planVisit(p.n, tr.onboard, CAPACITY, rand, 6);
    tr.alightLeft = v.alight;
    tr.boardLeft = v.board;
    tr.releaseT = 0;
  }

  function stepVisit(tr: Train, dt: number, open: number) {
    const p = tr.visit!;
    if (open < 0.6) return;
    tr.releaseT -= dt;
    if (tr.releaseT > 0) return;
    tr.releaseT = 0.2;
    tr.doorK = (tr.doorK + 3) % doorAlong.length;
    const da = doorAlong[tr.doorK];
    if (tr.alightLeft > 0) {
      tr.alightLeft--;
      tr.onboard = Math.max(0, tr.onboard - 1);
      at(p.fr, da, TRACK_LAT + 1.1, pt);
      const i = pool.spawn(pt.x, p.y, pt.z);
      if (i < 0) return;
      at(p.fr, da, 3.9, pt);
      pool.addWaypoint(i, pt.x, p.y, pt.z);
      at(p.fr, p.stairTop + 1.1, 5.0, pt);
      pool.addWaypoint(i, pt.x, p.y, pt.z);
      at(p.fr, p.stairTop + 0.2, 6.4, pt);
      pool.addWaypoint(i, pt.x, p.y, pt.z);
      at(p.fr, -16, 6.4, pt);
      pool.addWaypoint(i, pt.x, 0, pt.z);
      at(p.fr, -20 - rand() * 4, 5.2 + rand(), pt);
      pool.addWaypoint(i, pt.x, 0, pt.z);
      pool.speed[i] = 1.8;
      pool.finish(i, END.VANISH, 0);
    } else if (tr.boardLeft > 0) {
      const i = takeWaiting(p);
      if (i < 0) {
        tr.boardLeft = 0;
        return;
      }
      tr.boardLeft--;
      tr.onboard++;
      // nearest door to where they stand
      const dx = pool.x[i] - p.fr.x, dz = pool.z[i] - p.fr.z;
      const along = dx * Math.sin(p.fr.h) + dz * Math.cos(p.fr.h);
      let best = doorAlong[0];
      for (const d of doorAlong) if (Math.abs(d - along) < Math.abs(best - along)) best = d;
      pool.clearPath(i);
      at(p.fr, best, 3.7, pt);
      pool.addWaypoint(i, pt.x, p.y, pt.z);
      at(p.fr, best, TRACK_LAT + 1.0, pt);
      pool.addWaypoint(i, pt.x, p.y, pt.z);
      pool.speed[i] = 2.3;
      pool.finish(i, END.BOARD, 0);
    }
  }

  let simT = 0;
  const carM = new THREE.Matrix4();
  function tick(dt: number, simulate: boolean, night: number) {
    windowMat.emissiveIntensity = night * 1.1;
    if (simulate) {
      simT += dt;
      for (const p of platforms) {
        const n = growWaiting(p.n, dt, ARRIVAL_RATE, MAX_WAIT, rand);
        if (n > p.n) addWaiting(p, true);
      }
    }
    trains.forEach((tr, ti) => {
      const li = tr.line;
      const H = METRO_LINES[li].height;
      sampleShuttle(shuttles[li], simT + tr.offset, tr.sample);
      const st = tr.sample.station;
      if (simulate) {
        if (st >= 0 && tr.prevStation !== st) beginVisit(tr, platformOf(li, st, tr.side));
        if (st < 0) tr.visit = null;
        tr.prevStation = st;
      }
      const open = st >= 0 ? doorOpenAmount(tr.sample.dwellT, SHUTTLE.dwell) : 0;
      if (simulate && tr.visit) stepVisit(tr, dt, open);

      for (let c = 0; c < CARS; c++) {
        const ci = ti * CARS + c;
        trackPose(tracks[li], tr.sample.s + (c - (CARS - 1) / 2) * PITCH, pose);
        const cx = pose.x + tr.side * TRACK_LAT * Math.cos(pose.h);
        const cz = pose.z - tr.side * TRACK_LAT * Math.sin(pose.h);
        frame(cx, H, cz, pose.h, carM);
        carRig.set(ci, carM);
        let k = 0;
        for (const d of DOORS)
          for (const sd of [-1, 1]) {
            const o = sd === tr.side ? open : 0;
            for (const lf of [-1, 1]) {
              local(sd * 1.375, 1.6, d + lf * (0.31 + o * 0.58), 0, 0.07, 1.95, 0.62, leafLocal);
              leaves.setMatrixAt(ci * LEAVES + k++, tmp.multiplyMatrices(carM, leafLocal));
            }
          }
      }
    });
    carRig.commit();
    leaves.instanceMatrix.needsUpdate = true;
  }

  const meshes: THREE.Object3D[] = [...statics, ...carRig.meshes, leaves];
  return {
    meshes,
    tick,
    dispose() {
      for (const m of meshes) if (m instanceof THREE.InstancedMesh) m.dispose();
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
    },
  };
}
