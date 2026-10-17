// Builds every static streetscape object (instanced) from the pure placement. No React here.
import {
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { generateCity } from "../Buildings/layout";
import {
  binGeometry, billboardGeometry, bollardGeometry, carGeometry, lampGeometry, lampGlassGeometry, merge, neonPylonGeometry,
  paint, poleGeometry, shrubGeometry, signPostGeometry, treeGeometry, atlasPlane,
} from "./geo";
import { AD_COUNT, BILLBOARD, buildStreetscape, mulberry32, type Prop, type PropKind } from "./placement";
import { LedPainter, NEON_WORDS, adTextures, ledRect, neonAtlas, neonRect, signAtlas, signRect, type LedScreen } from "./textures";

const BUILDINGS_SEED = 20261010; // must match modules/Buildings.tsx so shop neon sits above its awnings

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _c = new Color();
const _up = new Vector3(0, 1, 0);

interface Inst {
  x: number;
  y?: number;
  z: number;
  yaw: number;
  sx?: number;
  sy?: number;
  sz?: number;
  color?: string;
}

function instanced(geo: BufferGeometry, mat: Material, items: Inst[], receive = false) {
  const mesh = new InstancedMesh(geo, mat, Math.max(1, items.length));
  mesh.count = items.length;
  items.forEach((it, i) => {
    _p.set(it.x, it.y ?? 0, it.z);
    _q.setFromAxisAngle(_up, it.yaw);
    _s.set(it.sx ?? 1, it.sy ?? it.sx ?? 1, it.sz ?? it.sx ?? 1);
    mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    if (it.color) mesh.setColorAt(i, _c.set(it.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.receiveShadow = receive;
  mesh.computeBoundingSphere();
  return mesh;
}

const CAR_COLOURS = ["#c8102e", "#1d3557", "#f1faee", "#2b2d42", "#8d99ae", "#e9c46a", "#264653", "#9b2226", "#ffffff", "#3a5a40", "#d4d4d4", "#111111", "#4361ee", "#f4a261"];
const TREE_TINTS = ["#ffffff", "#f0ffe6", "#e3f5d6", "#fbf6dc", "#d9efd0"];
const SHRUB_COLOURS = ["#4c7d3a", "#5e8f45", "#3f6e33", "#6d9a4a", "#7a8f3a"];

export interface NeonFace {
  x: number;
  y: number;
  z: number;
  yaw: number;
  w: number;
  h: number;
  word: number;
}

/** Shop neon flush with the facade above every other downtown awning, plus faces for the roadside pylons. */
export function neonFaces(props: Prop[]): NeonFace[] {
  const out: NeonFace[] = [];
  const r = mulberry32(777);
  for (const a of generateCity(BUILDINGS_SEED).awnings) {
    if (r() < 0.45 || a.w < 2.6) continue;
    const nx = Math.sin(a.ry);
    const nz = Math.cos(a.ry);
    out.push({ x: a.x - nx * 0.93, y: 4.5, z: a.z - nz * 0.93, yaw: a.ry, w: Math.min(3.2, a.w - 0.8), h: Math.min(3.2, a.w - 0.8) / 4, word: Math.floor(r() * NEON_WORDS.length) });
  }
  for (const p of props) {
    if (p.kind !== "neon") continue;
    const word = Math.floor(p.v * NEON_WORDS.length);
    // blade sign: faces run along the road, readable both ways
    for (const flip of [0, Math.PI]) {
      const yaw = p.yaw + Math.PI / 2 + flip;
      out.push({ x: p.x + Math.sin(yaw) * 0.13, y: 4.55, z: p.z + Math.cos(yaw) * 0.13, yaw, w: 2.4, h: 0.6, word });
    }
  }
  return out;
}

export interface Built {
  objects: Object3D[];
  /** 0 = day, 1 = night */
  setNight: (k: number) => void;
  led: LedPainter;
  dispose: () => void;
}

export function build(): Built {
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  const objects: Object3D[] = [];
  const S = buildStreetscape();
  const byKind = (k: PropKind) => S.props.filter((p) => p.kind === k);

  const vc = keep(new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }));
  const add = (geo: BufferGeometry, mat: Material, items: Inst[], receive = false) => {
    keep(geo);
    if (items.length) objects.push(instanced(geo, mat, items, receive));
  };

  // --- trees, lamps, bins, bollards, parked cars
  add(treeGeometry(), vc, byKind("tree").map((p) => ({ ...p, yaw: p.yaw, sx: 0.85 + p.v * 0.45, color: TREE_TINTS[Math.floor(p.v * TREE_TINTS.length)] })));
  const lamps = byKind("lamp");
  add(lampGeometry(), vc, lamps);
  const lampGlass = keep(new MeshStandardMaterial({ color: "#fff1c9", emissive: "#ffcf7a", emissiveIntensity: 0, roughness: 0.4 }));
  add(lampGlassGeometry(), lampGlass, lamps);
  add(binGeometry(), vc, byKind("bin"));
  add(bollardGeometry(), vc, byKind("bollard"));
  add(carGeometry(), vc, byKind("car").map((p) => ({ ...p, color: CAR_COLOURS[Math.floor(p.v * CAR_COLOURS.length)] })));

  // --- road signs and bus stop flags (atlas faces, one draw per sign type)
  const signs = keep(signAtlas());
  const signMat = keep(new MeshStandardMaterial({ map: signs, alphaTest: 0.4, roughness: 0.6 }));
  const signKinds: [PropKind, "speed" | "giveWay" | "keepLeft"][] = [["signSpeed", "speed"], ["signGiveWay", "giveWay"], ["signKeepLeft", "keepLeft"]];
  add(signPostGeometry(), vc, signKinds.flatMap(([k]) => byKind(k)));
  for (const [k, cell] of signKinds) add(atlasPlane(0.8, 0.8, signRect(cell)).translate(0, 2.25, 0.005), signMat, byKind(k));
  const stops = byKind("busStop");
  add(poleGeometry(3.1), vc, stops);
  add(atlasPlane(0.62, 0.62, signRect("bus")).translate(0, 2.75, 0.06), signMat, stops);
  add(atlasPlane(0.62, 0.62, signRect("bus")).rotateY(Math.PI).translate(0, 2.75, -0.06), signMat, stops);

  // --- highway verges and embankment shrubs
  const vergeGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.035, 0);
  const vergeMat = keep(new MeshStandardMaterial({ color: "#7aa653", roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
  add(vergeGeo, vergeMat, S.verges.map((v) => ({ x: v.x, z: v.z, yaw: v.yaw, sx: v.len, sy: 1, sz: v.width })), true);
  add(shrubGeometry(), vc, S.shrubs.map((s) => ({ x: s.x, z: s.z, yaw: s.v * 6.28, sx: s.s * 1.3, sy: s.s, sz: s.s * 1.1, color: SHRUB_COLOURS[Math.floor(s.v * SHRUB_COLOURS.length)] })));

  // --- neon: roadside pylons + shop signs downtown (one draw per word, shared atlas)
  add(neonPylonGeometry(), vc, byKind("neon").map((p) => ({ ...p, yaw: p.yaw + Math.PI / 2 })));
  const neonTex = keep(neonAtlas());
  const neonMat = keep(new MeshStandardMaterial({ map: neonTex, emissiveMap: neonTex, emissive: "#ffffff", emissiveIntensity: 0.4, roughness: 0.5 }));
  const faces = neonFaces(S.props);
  NEON_WORDS.forEach((_, i) => {
    const list = faces.filter((f) => f.word === i);
    add(atlasPlane(1, 1, neonRect(i)), neonMat, list.map((f) => ({ x: f.x, y: f.y, z: f.z, yaw: f.yaw, sx: f.w, sy: f.h, sz: 1 })));
  });

  // --- billboards
  const ads = adTextures().map(keep);
  const adMats = ads.map((t: Texture) => keep(new MeshStandardMaterial({ map: t, emissiveMap: t, emissive: "#ffffff", emissiveIntensity: 0.12, roughness: 0.6 })));
  add(billboardGeometry(), vc, S.billboards);
  const adPlane = new PlaneGeometry(BILLBOARD.width, BILLBOARD.height).translate(0, BILLBOARD.legs + BILLBOARD.height / 2, 0.22);
  keep(adPlane);
  for (let i = 0; i < AD_COUNT; i++) {
    const list = S.billboards.filter((b) => b.ad === i);
    if (list.length) objects.push(instanced(adPlane, adMats[i], list));
  }

  // --- Piccadilly-style LED wall on the downtown corner facing junction g_1_-1
  const led = new LedPainter();
  keep(led);
  const ledMat = keep(new MeshBasicMaterial({ map: led.texture, toneMapped: false }));
  const { podium, screens } = ledWall();
  keep(podium);
  keep(screens);
  const podiumMesh = new InstancedMesh(podium, vc, 1);
  podiumMesh.setMatrixAt(0, _m.identity());
  podiumMesh.computeBoundingSphere();
  podiumMesh.castShadow = true;
  objects.push(podiumMesh);
  const screenMesh = new InstancedMesh(screens, ledMat, 1);
  screenMesh.setMatrixAt(0, _m.identity());
  screenMesh.computeBoundingSphere();
  objects.push(screenMesh);

  return {
    objects,
    led,
    setNight(k) {
      lampGlass.emissiveIntensity = k * 2.6;
      neonMat.emissiveIntensity = 0.45 + k * 2.2;
      for (const m of adMats) m.emissiveIntensity = 0.12 + k * 0.55;
      const b = 0.9 + k * 0.6; // LEDs are bright by day and blooming by night
      ledMat.color.setRGB(b, b, b);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      for (const o of objects) if (o instanceof InstancedMesh) o.dispose();
    },
  };
}

/** Corner of downtown block (60, -60): buildable edge at x = 47 (west face) and z = -47 (south face). */
export const LED_CORNER = { x: 47, z: -47 } as const;

interface ScreenSpec {
  screen: LedScreen;
  face: "west" | "south";
  along: number; // centre distance from the corner along the face
  y: number; // centre height
  w: number;
  h: number;
}

const SCREENS: ScreenSpec[] = [
  { screen: "west", face: "west", along: 8, y: 10.6, w: 15, h: 9 },
  { screen: "south", face: "south", along: 8, y: 10.6, w: 15, h: 9 },
  { screen: "westTicker", face: "west", along: 8, y: 5.25, w: 15, h: 1.5 },
  { screen: "southTicker", face: "south", along: 8, y: 5.25, w: 15, h: 1.5 },
  { screen: "westTop", face: "west", along: 5.2, y: 17.7, w: 9, h: 4 },
  { screen: "southTop", face: "south", along: 5.2, y: 17.7, w: 9, h: 4 },
];

/** Screen centre and yaw in world space (exported for tests). */
export function screenPlacement(s: Pick<ScreenSpec, "face" | "along">, inset = -0.25) {
  const { x, z } = LED_CORNER;
  return s.face === "west"
    ? { x: x + inset, z: z - s.along, yaw: -Math.PI / 2 }
    : { x: x + s.along, z: z - inset, yaw: 0 };
}

function ledWall() {
  const { x: cx, z: cz } = LED_CORNER;
  const H = 21;
  const parts: BufferGeometry[] = [
    // L-shaped podium ("pavilion") the screens hang on
    paint(new BoxGeometry(6, H, 16).translate(cx + 3, H / 2, cz - 8), "#2a2c33"),
    paint(new BoxGeometry(10, H, 6).translate(cx + 11, H / 2, cz - 3), "#2a2c33"),
    paint(new BoxGeometry(6.4, 0.6, 16.4).translate(cx + 3, H + 0.3, cz - 8), "#c9c1ad"),
    paint(new BoxGeometry(10.4, 0.6, 6.4).translate(cx + 11, H + 0.3, cz - 3), "#c9c1ad"),
  ];
  const screens: BufferGeometry[] = [];
  for (const s of SCREENS) {
    const p = screenPlacement(s);
    const bez = screenPlacement(s, -0.1);
    parts.push(paint(new BoxGeometry(s.w + 0.4, s.h + 0.4, 0.2).rotateY(p.yaw).translate(bez.x, s.y, bez.z), "#0c0c10"));
    screens.push(atlasPlane(s.w, s.h, ledRect(s.screen)).rotateY(p.yaw).translate(p.x, s.y, p.z));
  }
  return { podium: merge(parts), screens: mergeTextured(screens) };
}

function mergeTextured(parts: BufferGeometry[]) {
  const out = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!out) throw new Error("Streetscape: LED screen merge failed");
  return out;
}
