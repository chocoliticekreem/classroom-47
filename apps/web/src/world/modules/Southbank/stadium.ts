// The football stadium: a rounded bowl with two tiers of red seats, a pale outer wall, a ring roof,
// the white Wembley-style arch, roof-edge floodlights that glow at night, a mown pitch and ~4500
// crowd specks doing a Mexican wave on the GPU.
import * as THREE from "three";
import { SB_FEATURES } from "../../districts/southbank";
import { Bag, instanced, merge } from "./kit";
import { crowdMaterial } from "./materials";
import { mulberry32 } from "./night";
import type { Glow } from "./streets";
import { makePitch } from "./textures";
import { lampMaterial } from "./streets";

const S = SB_FEATURES.stadium;
const N = 128; // perimeter segments
const EXP = 4; // superellipse exponent (rounded rectangle)

/** Point on the superellipse of half-axes a (x) and b (z) at parameter t. */
function se(a: number, b: number, t: number): [number, number] {
  const c = Math.cos(t), s = Math.sin(t);
  return [a * Math.sign(c) * Math.pow(Math.abs(c), 2 / EXP), b * Math.sign(s) * Math.pow(Math.abs(s), 2 / EXP)];
}

interface Ring {
  a: number;
  b: number;
  y: number;
}

/** A band between two rings (inner -> outer), as a non-indexed triangle list. */
function band(r0: Ring, r1: Ring): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = (i / N) * Math.PI * 2, t1 = ((i + 1) / N) * Math.PI * 2;
    const [ax, az] = se(r0.a, r0.b, t0), [bx, bz] = se(r0.a, r0.b, t1);
    const [cx, cz] = se(r1.a, r1.b, t1), [dx, dz] = se(r1.a, r1.b, t0);
    pos.push(ax, r0.y, az, cx, r1.y, cz, bx, r0.y, bz, ax, r0.y, az, dx, r1.y, dz, cx, r1.y, cz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function buildStadium(bag: Bag, glow: Glow) {
  const group = new THREE.Group();
  group.position.set(S.x, 0, S.z);
  bag.add(group);
  const add = (g: THREE.BufferGeometry, m: THREE.Material, cast = false) => {
    const mesh = new THREE.Mesh(bag.keep(g), m);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  const inner: Ring = { a: 55, b: 39, y: 0.6 };
  const mid: Ring = { a: 61.5, b: 46.5, y: 11 };
  const mid2: Ring = { a: 62, b: 47, y: 13.5 };
  const outer: Ring = { a: S.rx, b: S.rz, y: 26 };

  // concourse apron + pitch surround
  const apron = new THREE.Shape();
  for (let i = 0; i <= N; i++) {
    const [x, z] = se(S.rx + 8, S.rz + 7, (i / N) * Math.PI * 2);
    if (i === 0) apron.moveTo(x, -z);
    else apron.lineTo(x, -z);
  }
  add(new THREE.ShapeGeometry(apron, 1).rotateX(-Math.PI / 2).translate(0, 0.03, 0), bag.keep(new THREE.MeshStandardMaterial({ color: "#a9a49b", roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 })));
  const surround = new THREE.Shape();
  for (let i = 0; i <= N; i++) {
    const [x, z] = se(inner.a + 1, inner.b + 1, (i / N) * Math.PI * 2);
    if (i === 0) surround.moveTo(x, -z);
    else surround.lineTo(x, -z);
  }
  add(new THREE.ShapeGeometry(surround, 1).rotateX(-Math.PI / 2).translate(0, 0.06, 0), bag.keep(new THREE.MeshStandardMaterial({ color: "#2f7a33", roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })));

  // pitch: lit by the floodlights at night (emissive)
  const pitchTex = bag.keep(makePitch());
  const pitchMat = bag.keep(new THREE.MeshStandardMaterial({ map: pitchTex, emissiveMap: pitchTex, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  glow.std.push({ mat: pitchMat, k: 0.55 });
  add(new THREE.PlaneGeometry(100, 64).rotateX(-Math.PI / 2).translate(0, 0.1, 0), pitchMat);

  // seating tiers + the gap fascia between them + outer wall
  const seats = bag.keep(new THREE.MeshStandardMaterial({ color: "#b3202a", roughness: 0.8, side: THREE.DoubleSide, flatShading: true }));
  add(band(inner, mid), seats);
  add(band(mid2, outer), seats, true);
  const conc = bag.keep(new THREE.MeshStandardMaterial({ color: "#e9e8e4", roughness: 0.75, side: THREE.DoubleSide, flatShading: true }));
  add(band(mid, { ...mid, y: mid2.y }), conc);
  add(band({ ...mid, y: mid2.y }, mid2), conc);
  add(band({ a: inner.a, b: inner.b, y: 0 }, inner), conc);
  add(band({ a: S.rx, b: S.rz, y: 0 }, { a: S.rx, b: S.rz, y: 31 }), conc, true);
  // a glowing glazed concourse band round the outside
  const bandGlow = lampMaterial(bag, glow, "#5e7486", "#ffe2a8", 1.6);
  add(band({ a: S.rx + 0.15, b: S.rz + 0.15, y: 3 }, { a: S.rx + 0.15, b: S.rz + 0.15, y: 6.5 }), bandGlow);

  // roof ring over the upper tier (translucent membrane)
  const roof = bag.keep(new THREE.MeshStandardMaterial({ color: "#f4f4f2", roughness: 0.6, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false }));
  add(band({ a: 63.5, b: 49, y: 30.5 }, { a: S.rx + 0.5, b: S.rz + 0.5, y: 31.2 }), roof);

  // roof-edge floodlight banks: grey by day, blazing at night
  const flood = lampMaterial(bag, glow, "#d7dadf", "#f4fbff", 3.2);
  const banks = 36;
  const bankGeo = bag.keep(new THREE.BoxGeometry(5, 0.8, 1.2));
  const bankMesh = instanced(bankGeo, flood, banks, (i, set) => {
    const t = (i / banks) * Math.PI * 2;
    const [x, z] = se(63.8, 49.2, t);
    const [x2, z2] = se(63.8, 49.2, t + 0.01);
    set(x, 30.2, z, 1, 1, 1, Math.atan2(x2 - x, z2 - z) + Math.PI / 2, 0.5);
    return null;
  }, { receive: false });
  group.add(bankMesh);

  // the arch: a white tube on a parabola, leaning north, feet just outside the bowl
  const H = 110, half = 80, tilt = 0.26;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 32; i++) {
    const u = -1 + (2 * i) / 32;
    const h = H * (1 - u * u);
    pts.push(new THREE.Vector3(u * half, h * Math.cos(tilt), -h * Math.sin(tilt)));
  }
  const archMat = bag.keep(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.35, metalness: 0.2, emissive: new THREE.Color("#dfe8ff"), emissiveIntensity: 0 }));
  glow.std.push({ mat: archMat, k: 0.6 });
  add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 1.7, 10, false), archMat, true);
  // arch feet
  for (const sx of [-half, half]) {
    const foot = add(new THREE.CylinderGeometry(3, 4, 4, 8).translate(0, 2, 0), conc);
    foot.position.x = sx;
  }
  // cables from the arch down to the roof edge, merged into one mesh
  const cables: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), cm = new THREE.Vector3();
  const q = new THREE.Quaternion(), m4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
  for (let i = 7; i <= 25; i += 2) {
    const a = pts[i];
    const zEdge = 49 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(a.x) / 64, 4)), 0.25) * 0.98;
    for (const bz of [zEdge, -zEdge]) {
      const end = new THREE.Vector3(a.x, 31, bz);
      const len = a.distanceTo(end);
      dir.copy(end).sub(a).normalize();
      q.setFromUnitVectors(up, dir);
      cm.copy(a).add(end).multiplyScalar(0.5);
      cables.push(new THREE.CylinderGeometry(0.12, 0.12, len, 3, 1, true).applyMatrix4(m4.compose(cm, q, one)));
    }
  }
  add(merge(cables), bag.keep(new THREE.MeshBasicMaterial({ color: "#c9ccd2" })));

  // the crowd: specks on both tiers, home end red and white, away end blue and yellow
  const rand = mulberry32(4242);
  const specks: [number, number, number, number, string][] = [];
  const tier = (r0: Ring, r1: Ring, rows: number) => {
    for (let r = 0; r < rows; r++) {
      const u = (r + 0.5) / rows;
      const a = r0.a + (r1.a - r0.a) * u, b = r0.b + (r1.b - r0.b) * u, y = r0.y + (r1.y - r0.y) * u;
      const per = Math.round((2 * (a + b) * 1.15) / 1.05);
      for (let i = 0; i < per; i++) {
        if (rand() < 0.1) continue;
        const t = ((i + rand() * 0.3) / per) * Math.PI * 2;
        const [x, z] = se(a, b, t);
        const away = x > 0 && Math.abs(z) < b * 0.55 && x > a * 0.8;
        const col = away
          ? rand() < 0.6 ? "#1f4fbf" : "#f2c230"
          : rand() < 0.62 ? "#d0142a" : rand() < 0.8 ? "#f5f5f5" : ["#2b2b2b", "#3e5c76", "#e0b080"][Math.floor(rand() * 3)];
        specks.push([x, y, z, Math.atan2(z, x) + Math.PI, col]);
      }
    }
  };
  tier(inner, mid, 10);
  tier(mid2, outer, 11);
  const speckGeo = bag.keep(new THREE.BoxGeometry(0.6, 0.95, 0.5).translate(0, 0.48, 0));
  const crowd = instanced(speckGeo, bag.keep(crowdMaterial()), specks.length, (i, set) => {
    const [x, y, z] = specks[i];
    set(x, y, z, 1, 1, 1, 0);
    return specks[i][4];
  }, { receive: false });
  const ph = new Float32Array(specks.length);
  specks.forEach((s, i) => (ph[i] = s[3]));
  speckGeo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(ph, 1));
  crowd.frustumCulled = false;
  group.add(crowd);

  // players: two little teams dotted about the pitch
  const players: [number, number, string][] = [];
  for (let i = 0; i < 22; i++) players.push([(rand() - 0.5) * 90, (rand() - 0.5) * 56, i < 11 ? "#d0142a" : "#1f4fbf"]);
  players.push([0, 0, "#f5f5f5"]); // the ball
  const playerMesh = instanced(bag.keep(new THREE.BoxGeometry(0.8, 1.9, 0.6).translate(0, 0.95, 0)), bag.keep(new THREE.MeshLambertMaterial()), players.length, (i, set) => {
    const [x, z] = players[i];
    if (i === 22) set(x, 0.1, z, 0.6, 0.35, 0.8, 0);
    else set(x, 0.1, z, 1, 1, 1, rand() * 6);
    return players[i][2];
  }, { receive: false });
  group.add(playerMesh);

  return group;
}
