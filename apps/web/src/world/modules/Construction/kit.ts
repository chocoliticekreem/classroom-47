// Geometry batching and canvas textures for the Construction module. Client only (textures need a DOM).
import * as THREE from "three";

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const Y_UP = new THREE.Vector3(0, 1, 0);

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpNM = new THREE.Matrix3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpC = new THREE.Color();

export type UvMap = { rect: [number, number, number, number] } | { repeat: [number, number] };

/** Accumulates transformed, vertex-coloured triangles into one BufferGeometry (one draw call). */
export class Batch {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  private extra: number[] = [];
  /** Optional per-vertex float written into attribute "aFlag" (e.g. 1 for a worker's swinging arm). */
  flag = 0;

  get vertexCount() {
    return this.pos.length / 3;
  }

  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.ColorRepresentation, uv?: UvMap) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    const t = g.getAttribute("uv");
    tmpNM.getNormalMatrix(m);
    tmpC.set(color);
    for (let i = 0; i < p.count; i++) {
      tmpV.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(tmpV.x, tmpV.y, tmpV.z);
      if (n) tmpN.fromBufferAttribute(n, i).applyMatrix3(tmpNM).normalize();
      else tmpN.set(0, 1, 0);
      this.nor.push(tmpN.x, tmpN.y, tmpN.z);
      this.col.push(tmpC.r, tmpC.g, tmpC.b);
      let u = t ? t.getX(i) : 0;
      let v = t ? t.getY(i) : 0;
      if (uv && "rect" in uv) {
        const [u0, v0, u1, v1] = uv.rect;
        u = u0 + u * (u1 - u0);
        v = v0 + v * (v1 - v0);
      } else if (uv) {
        u *= uv.repeat[0];
        v *= uv.repeat[1];
      }
      this.uv.push(u, v);
      this.extra.push(this.flag);
    }
    if (g !== geo) g.dispose();
  }

  /** Axis-aligned box (before `yaw` about its own centre) centred at (x, y, z). */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, yaw = 0, uv?: UvMap) {
    tmpQ.setFromAxisAngle(Y_UP, yaw);
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
    this.add(UNIT_BOX, tmpM, color, uv);
  }

  /** Box with arbitrary transform: unit box scaled by s, rotated by q, at p. */
  boxQ(p: THREE.Vector3, q: THREE.Quaternion, s: THREE.Vector3, color: THREE.ColorRepresentation, uv?: UvMap) {
    tmpM.compose(p, q, s);
    this.add(UNIT_BOX, tmpM, color, uv);
  }

  /** A square-section beam from a to b. */
  member(ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number, color: THREE.ColorRepresentation) {
    tmpDir.set(bx - ax, by - ay, bz - az);
    const len = tmpDir.length();
    if (len < 1e-4) return;
    tmpDir.divideScalar(len);
    tmpQ.setFromUnitVectors(Y_UP, tmpDir);
    tmpM.compose(tmpP.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), tmpQ, tmpS.set(t, len, t));
    this.add(UNIT_BOX, tmpM, color);
  }

  /** A geometry placed at (x, y, z) with yaw. */
  place(geo: THREE.BufferGeometry, x: number, y: number, z: number, color: THREE.ColorRepresentation, yaw = 0, sx = 1, sy = 1, sz = 1) {
    tmpQ.setFromAxisAngle(Y_UP, yaw);
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
    this.add(geo, tmpM, color);
  }

  /** A vertical quad in the local xz frame: from (ax, az) to (bx, bz), y0..y1, uv repeated. */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, color: THREE.ColorRepresentation, uRep: number, vRep: number) {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const nx = dz / len;
    const nz = -dx / len;
    tmpC.set(color);
    const quad = [
      [ax, y0, az, 0, 0], [bx, y0, bz, uRep, 0], [bx, y1, bz, uRep, vRep],
      [ax, y0, az, 0, 0], [bx, y1, bz, uRep, vRep], [ax, y1, az, 0, vRep],
    ];
    for (const [x, y, z, u, v] of quad) {
      this.pos.push(x, y, z);
      this.nor.push(nx, 0, nz);
      this.col.push(tmpC.r, tmpC.g, tmpC.b);
      this.uv.push(u, v);
      this.extra.push(this.flag);
    }
  }

  build(withFlag = false): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    if (withFlag) g.setAttribute("aFlag", new THREE.Float32BufferAttribute(this.extra, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// --- Canvas textures ------------------------------------------------------------------------------

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function tex(c: HTMLCanvasElement, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const ORANGE = "#ff6a1a";

/** Hoarding ads, 2 x 2 atlas of 512 x 256 boards. Use adRect(i) for the UVs of board i. */
export function adAtlas() {
  const [c, g] = canvas(1024, 512);
  const boards: ((x: number, y: number) => void)[] = [
    (x, y) => {
      g.fillStyle = ORANGE;
      g.fillRect(x, y, 512, 256);
      g.fillStyle = "#ffffff";
      g.font = "900 92px Arial, Helvetica, sans-serif";
      g.fillText("HAMYWAY", x + 34, y + 120);
      g.font = "700 30px Arial, Helvetica, sans-serif";
      g.fillText("Building the city that", x + 36, y + 172);
      g.fillText("delivers tomorrow.", x + 36, y + 208);
      g.beginPath();
      g.arc(x + 430, y + 92, 52, 0, Math.PI * 2);
      g.lineWidth = 14;
      g.strokeStyle = "#ffffff";
      g.stroke();
    },
    (x, y) => {
      g.fillStyle = "#1b1f2a";
      g.fillRect(x, y, 512, 256);
      g.fillStyle = ORANGE;
      g.fillRect(x, y + 206, 512, 50);
      g.fillStyle = "#ffffff";
      g.font = "800 46px Arial, Helvetica, sans-serif";
      g.fillText("HAMYWAY TOWER", x + 30, y + 78);
      g.font = "600 30px Arial, Helvetica, sans-serif";
      g.fillText("42 floors of same-day.", x + 30, y + 128);
      g.fillStyle = "#1b1f2a";
      g.font = "800 28px Arial, Helvetica, sans-serif";
      g.fillText("OPENING 2027", x + 30, y + 242);
    },
    (x, y) => {
      g.fillStyle = "#f4efe6";
      g.fillRect(x, y, 512, 256);
      g.fillStyle = ORANGE;
      g.fillRect(x, y, 24, 256);
      g.fillStyle = "#222";
      g.font = "800 40px Arial, Helvetica, sans-serif";
      g.fillText("Parcels on time,", x + 50, y + 92);
      g.fillText("every time.", x + 50, y + 142);
      g.fillStyle = ORANGE;
      g.font = "900 44px Arial, Helvetica, sans-serif";
      g.fillText("HAMYWAY", x + 50, y + 214);
    },
    (x, y) => {
      g.fillStyle = "#2c6e49";
      g.fillRect(x, y, 512, 256);
      g.fillStyle = "#ffffff";
      g.font = "800 36px Arial, Helvetica, sans-serif";
      g.fillText("SITE SAFETY", x + 30, y + 64);
      g.font = "600 26px Arial, Helvetica, sans-serif";
      g.fillText("Hard hats  ·  Hi-vis  ·  Boots", x + 30, y + 112);
      g.fillStyle = ORANGE;
      g.fillRect(x + 30, y + 150, 220, 64);
      g.fillStyle = "#ffffff";
      g.font = "900 40px Arial, Helvetica, sans-serif";
      g.fillText("HAMYWAY", x + 52, y + 196);
    },
  ];
  boards.forEach((draw, i) => draw((i % 2) * 512, Math.floor(i / 2) * 256));
  // border lines between boards
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.lineWidth = 6;
  for (let i = 0; i < 4; i++) g.strokeRect((i % 2) * 512 + 3, Math.floor(i / 2) * 256 + 3, 506, 250);
  return tex(c);
}

/** UV rect [u0, v0, u1, v1] for ad board i (0..3). Canvas y is flipped in UV space. */
export function adRect(i: number): [number, number, number, number] {
  const col = i % 2;
  const row = Math.floor(i / 2) % 2;
  return [col * 0.5, 1 - (row + 1) * 0.5, (col + 1) * 0.5, 1 - row * 0.5];
}

/** Curtain wall for one storey: glass panes with mullions. Returns the colour map and a night emissive map. */
export function glazing() {
  const W = 256;
  const H = 64;
  const [c, g] = canvas(W, H);
  const [e, ge] = canvas(W, H);
  ge.fillStyle = "#000";
  ge.fillRect(0, 0, W, H);
  const panes = 8;
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < panes; i++) {
    const x = (i * W) / panes;
    const grad = g.createLinearGradient(x, 0, x + W / panes, H);
    grad.addColorStop(0, "#5f86a6");
    grad.addColorStop(1, "#9cc0d8");
    g.fillStyle = grad;
    g.fillRect(x, 0, W / panes, H);
    if (rnd() < 0.55) {
      ge.fillStyle = rnd() < 0.7 ? "#ffd9a0" : "#e8f0ff";
      ge.fillRect(x + 3, 6, W / panes - 6, H - 14);
    }
  }
  g.fillStyle = "#3a4048";
  for (let i = 0; i <= panes; i++) g.fillRect((i * W) / panes - 2, 0, 4, H);
  g.fillRect(0, 0, W, 5);
  g.fillRect(0, H - 8, W, 8);
  ge.fillStyle = "#000";
  for (let i = 0; i <= panes; i++) ge.fillRect((i * W) / panes - 2, 0, 4, H);
  return { map: tex(c), emissive: tex(e) };
}

/** Scaffold lift (2.5 m x 2 m): tubes, toe boards and semi-open safety netting. Cut out with alphaTest. */
export function scaffoldNet() {
  const [c, g] = canvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  // netting: dense diamond mesh
  g.strokeStyle = "rgba(38,120,104,1)";
  g.lineWidth = 2.2;
  for (let k = -128; k < 256; k += 9) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + 128, 128);
    g.stroke();
    g.beginPath();
    g.moveTo(k, 128);
    g.lineTo(k + 128, 0);
    g.stroke();
  }
  // a band of solid sheeting at the bottom (debris screen)
  g.fillStyle = "rgba(48,132,116,1)";
  g.fillRect(0, 84, 128, 30);
  // tubes and boards
  g.fillStyle = "#c9cdd2";
  g.fillRect(0, 0, 7, 128);
  g.fillRect(0, 0, 128, 6);
  g.fillStyle = "#e0b030";
  g.fillRect(0, 114, 128, 10);
  return tex(c, true);
}
