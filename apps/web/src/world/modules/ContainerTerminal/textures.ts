// Container terminal: CanvasTextures (no network assets) and the container material. Client only.
import * as THREE from "three";
import { BRANDS, BRAND_ROWS, CONTAINER, type Brand } from "./layout";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}
function tex(c: HTMLCanvasElement, aniso = 4) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// Atlas: 512 x (256 * rows). Per brand row (canvas y0 = row * 256):
//   side = (0, y0) - (512, y0 + 128)
//   top  = (0, y0 + 128) - (384, y0 + 256)
//   end  = (384, y0 + 128) - (512, y0 + 256)
const AW = 512;
const RH = 256;

function drawMark(g: CanvasRenderingContext2D, b: Brand, cx: number, cy: number, r: number) {
  g.save();
  g.fillStyle = b.text;
  g.strokeStyle = b.text;
  if (b.mark === "star") {
    g.beginPath();
    for (let i = 0; i < 14; i++) {
      const a = (i * Math.PI) / 7 - Math.PI / 2;
      const rr = i % 2 ? r * 0.42 : r;
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
  } else if (b.mark === "wave") {
    g.lineWidth = r * 0.28;
    for (const dy of [-0.35, 0.25]) {
      g.beginPath();
      for (let x = -r; x <= r; x += 2) g.lineTo(cx + x, cy + dy * r + Math.sin((x / r) * Math.PI * 1.5) * r * 0.22);
      g.stroke();
    }
  } else if (b.mark === "ring") {
    g.lineWidth = r * 0.3;
    g.beginPath();
    g.arc(cx, cy, r * 0.75, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
}

function drawRow(g: CanvasRenderingContext2D, b: Brand, y0: number, reefer: boolean) {
  g.fillStyle = b.base;
  g.fillRect(0, y0, AW, RH);
  // side corrugation
  for (let x = 10; x < AW - 8; x += 8) {
    g.fillStyle = "rgba(0,0,0,0.13)";
    g.fillRect(x, y0 + 7, 4, 114);
    g.fillStyle = "rgba(255,255,255,0.13)";
    g.fillRect(x + 4, y0 + 7, 2, 114);
  }
  g.fillStyle = "rgba(0,0,0,0.32)";
  g.fillRect(0, y0, AW, 7);
  g.fillRect(0, y0 + 121, AW, 7);
  g.fillRect(0, y0, 9, 128);
  g.fillRect(AW - 9, y0, 9, 128);
  if (b.name) {
    const mark = b.mark ? 44 : 0;
    g.fillStyle = b.text;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const size = b.name.length > 8 ? 40 : 52;
    g.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
    g.fillText(b.name, AW / 2 + mark / 2, y0 + (b.sub ? 54 : 64));
    if (b.mark) {
      const w = g.measureText(b.name).width;
      drawMark(g, b, AW / 2 - w / 2 - 6, y0 + 64, 22);
    }
    if (b.sub) {
      g.font = "bold 18px Arial, sans-serif";
      g.fillText(b.sub, AW / 2, y0 + 92);
    }
  } else {
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.font = "bold 13px monospace";
    g.textAlign = "left";
    g.fillText("RVTU 482113 4", 18, y0 + 24);
    g.fillText("45G1", 18, y0 + 40);
  }
  // top
  const ty = y0 + 128;
  g.fillStyle = "rgba(255,255,255,0.07)";
  g.fillRect(0, ty, 384, 128);
  for (let x = 8; x < 380; x += 11) {
    g.fillStyle = "rgba(0,0,0,0.11)";
    g.fillRect(x, ty + 7, 4, 114);
  }
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.lineWidth = 6;
  g.strokeRect(3, ty + 3, 378, 122);
  if (b.name && !reefer) {
    g.fillStyle = b.text;
    g.globalAlpha = 0.65;
    g.font = `900 60px "Arial Black", Impact, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(b.name.split(" ")[0], 192, ty + 66);
    g.globalAlpha = 1;
  }
  // end: doors (or the reefer machinery face)
  const ex = 384;
  g.fillStyle = "rgba(0,0,0,0.08)";
  g.fillRect(ex, ty, 128, 128);
  g.fillStyle = "rgba(0,0,0,0.42)";
  g.fillRect(ex, ty, 128, 7);
  g.fillRect(ex, ty + 121, 128, 7);
  g.fillRect(ex, ty, 6, 128);
  g.fillRect(ex + 122, ty, 6, 128);
  if (reefer) {
    g.fillStyle = "#c9ced3";
    g.fillRect(ex + 14, ty + 16, 100, 96);
    g.fillStyle = "#3b4148";
    for (let k = 0; k < 5; k++) g.fillRect(ex + 22, ty + 26 + k * 16, 84, 8);
    g.fillStyle = "#1d4f8a";
    g.fillRect(ex + 14, ty + 100, 100, 12);
  } else {
    g.fillRect(ex + 63, ty + 7, 2, 114);
    for (const x of [ex + 16, ex + 42, ex + 86, ex + 110]) g.fillRect(x, ty + 7, 3, 114);
    for (const x of [ex + 14, ex + 40, ex + 84, ex + 108]) g.fillRect(x, ty + 60, 7, 3);
  }
}

export function containerAtlas() {
  const [c, g] = canvas(AW, RH * BRAND_ROWS);
  BRANDS.forEach((b, i) => drawRow(g, b, i * RH, i === BRAND_ROWS - 1));
  return tex(c, 8);
}

/** BoxGeometry(w, h, l) (long axis z) mapped onto atlas row 0; the shader shifts v by the instance's brand row. */
export function containerGeometry(w = CONTAINER.w, h = CONTAINER.h, l = CONTAINER.l) {
  const geo = new THREE.BoxGeometry(w, h, l);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const H = RH * BRAND_ROWS;
  const v = (py: number) => 1 - py / H;
  // face order: px, nx, py, ny, pz, nz
  const side: [number, number, number, number, boolean] = [0, 1, v(128), v(0), false];
  const top: [number, number, number, number, boolean] = [0, 0.75, v(256), v(128), true];
  const end: [number, number, number, number, boolean] = [0.75, 1, v(256), v(128), false];
  [side, side, top, top, end, end].forEach(([u0, u1, v0, v1, swap], f) => {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      let u = uv.getX(i);
      let vv = uv.getY(i);
      if (swap) [u, vv] = [1 - vv, u];
      uv.setXY(i, u0 + u * (u1 - u0), v0 + vv * (v1 - v0));
    }
  });
  uv.needsUpdate = true;
  return geo;
}

/** Give a geometry its own per-instance brand attribute (one per InstancedMesh). */
export function withBrandAttribute(geo: THREE.BufferGeometry, count: number) {
  const g = geo.clone();
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  attr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute("aBrand", attr);
  return g;
}

/** Standard material that reads the instance's atlas row from `aBrand`. */
export function containerMaterial(map: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ color: "#ffffff", map, roughness: 0.78, metalness: 0.08 });
  const rowH = 1 / BRAND_ROWS;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aBrand;")
      .replace("#include <uv_vertex>", `#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv.y -= aBrand * ${rowH.toFixed(6)};\n#endif`);
  };
  m.customProgramCacheKey = () => "ct-container-atlas";
  return m;
}

/** Blinking LEDs (reefer power lights, beacons): per-instance phase from the instance position, GPU-timed. */
export function blinkMaterial(color: string, uTime: { value: number }, rate = 1.3) {
  const m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying float vBlink;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip = instanceMatrix[3].xyz;
#else
  vec3 ip = vec3(0.0);
#endif
  float ph = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
  float c = fract(uTime * ${rate.toFixed(3)} + ph);
  vBlink = c < 0.18 ? 1.0 : (c < 0.5 ? 0.25 : 0.12);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vBlink;")
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );", "vec4 diffuseColor = vec4( diffuse * (0.35 + vBlink * 2.2), opacity );");
  };
  m.customProgramCacheKey = () => `ct-blink-${rate}`;
  return m;
}

/** Sign board: text on a coloured panel. */
export function signTexture(text: string, bg: string, fg: string, w = 1024, h = 160, sub?: string) {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.lineWidth = 6;
  g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `900 ${Math.round(h * (sub ? 0.44 : 0.56))}px "Arial Black", Impact, sans-serif`;
  g.fillText(text, w / 2, sub ? h * 0.4 : h / 2);
  if (sub) {
    g.font = `bold ${Math.round(h * 0.2)}px Arial, sans-serif`;
    g.fillText(sub, w / 2, h * 0.78);
  }
  return tex(c);
}

/** Ship name, white on transparent. */
export function hullNameTexture(name: string) {
  const [c, g] = canvas(2048, 160);
  g.fillStyle = "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `900 112px "Arial Black", Impact, sans-serif`;
  g.fillText(name, 1024, 84);
  return tex(c);
}

/** Yellow/black hazard stripes (X-ray portal, barriers). */
export function hazardTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = "#f5c518";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#1b1b1b";
  for (let k = -128; k < 256; k += 32) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + 16, 0);
    g.lineTo(k + 16 + 128, 128);
    g.lineTo(k + 128, 128);
    g.closePath();
    g.fill();
  }
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}
