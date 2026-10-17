// Procedural canvas textures: road sign atlas, neon sign atlas, billboard ads and the animated LED wall.
// All brands are fictional (plus our own Hamyway Delivery). No network fonts: system sans-serif only.
import { CanvasTexture, SRGBColorSpace } from "three";

const FONT = "system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  return { c, ctx };
}

function tex(c: HTMLCanvasElement, aniso = 4) {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// ---------------------------------------------------------------- road signs

/** Sign atlas cells (left to right). UV rects are [u0, v0, u1, v1]. */
export const SIGN_CELLS = ["speed", "giveWay", "keepLeft", "bus"] as const;
export type SignCell = (typeof SIGN_CELLS)[number];
export function signRect(cell: SignCell): [number, number, number, number] {
  const i = SIGN_CELLS.indexOf(cell);
  return [i / 4, 0, (i + 1) / 4, 1];
}

export function signAtlas() {
  const S = 128;
  const { c, ctx } = canvas(S * 4, S);
  ctx.clearRect(0, 0, c.width, c.height);
  // 30 mph roundel
  ctx.save();
  ctx.translate(S * 0.5, S * 0.5);
  ctx.fillStyle = "#d4161f";
  ctx.beginPath();
  ctx.arc(0, 0, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, 0, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#111111";
  ctx.font = `bold 52px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("30", 0, 3);
  ctx.restore();
  // give way: inverted red triangle
  ctx.save();
  ctx.translate(S * 1.5, S * 0.5);
  const tri = (r: number) => {
    ctx.beginPath();
    ctx.moveTo(-r, -r * 0.62);
    ctx.lineTo(r, -r * 0.62);
    ctx.lineTo(0, r * 1.0);
    ctx.closePath();
  };
  ctx.fillStyle = "#d4161f";
  tri(62);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  tri(42);
  ctx.fill();
  ctx.fillStyle = "#111111";
  ctx.font = `bold 15px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("GIVE", 0, -12);
  ctx.fillText("WAY", 0, 5);
  ctx.restore();
  // keep left: blue roundel with a white arrow down-left
  ctx.save();
  ctx.translate(S * 2.5, S * 0.5);
  ctx.fillStyle = "#1d5fbf";
  ctx.beginPath();
  ctx.arc(0, 0, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.rotate(Math.PI * 0.75);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-9, -30, 18, 44);
  ctx.beginPath();
  ctx.moveTo(-26, 10);
  ctx.lineTo(26, 10);
  ctx.lineTo(0, 38);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // bus stop flag
  ctx.save();
  ctx.translate(S * 3, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(6, 6, S - 12, S - 12);
  ctx.strokeStyle = "#c8102e";
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, S - 12, S - 12);
  ctx.fillStyle = "#c8102e";
  ctx.beginPath();
  ctx.arc(S / 2, 52, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 22px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("BUS", S / 2, 53);
  ctx.fillStyle = "#1b2a5a";
  ctx.font = `bold 17px ${FONT}`;
  ctx.fillText("STOP", S / 2, 100);
  ctx.restore();
  return tex(c);
}

// ---------------------------------------------------------------- neon

export const NEON_WORDS: { text: string; color: string; script?: boolean }[] = [
  { text: "OPEN 24H", color: "#ff3b6b" },
  { text: "PIZZA", color: "#ffb52e" },
  { text: "KEBAB", color: "#4dff8a" },
  { text: "Noodles", color: "#3ad8ff", script: true },
  { text: "Cocktails", color: "#ff4df0", script: true },
  { text: "CAFE", color: "#ffe14d" },
  { text: "VINYL", color: "#b06bff" },
  { text: "LAUNDRETTE", color: "#58f5ff" },
];
/** Neon atlas: 2 columns x 4 rows of 4:1 cells. */
export function neonRect(i: number): [number, number, number, number] {
  const col = i % 2;
  const row = Math.floor(i / 2);
  return [col / 2, 1 - (row + 1) / 4, (col + 1) / 2, 1 - row / 4];
}

export function neonAtlas() {
  const W = 512;
  const H = 128;
  const { c, ctx } = canvas(W * 2, H * 4);
  NEON_WORDS.forEach((w, i) => {
    const x0 = (i % 2) * W;
    const y0 = Math.floor(i / 2) * H;
    ctx.fillStyle = "#120b18";
    ctx.fillRect(x0, y0, W, H);
    ctx.save();
    ctx.shadowColor = w.color;
    ctx.strokeStyle = w.color;
    ctx.lineWidth = 5;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.roundRect(x0 + 10, y0 + 10, W - 20, H - 20, 26);
    ctx.stroke();
    const size = w.text.length > 8 ? 54 : 72;
    ctx.font = w.script ? `italic bold ${size}px ${FONT}` : `bold ${size}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // two passes: coloured glow, then a hot near-white core
    ctx.fillStyle = w.color;
    ctx.shadowBlur = 26;
    ctx.fillText(w.text, x0 + W / 2, y0 + H / 2 + 3);
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#fff6fb";
    ctx.globalAlpha = 0.55;
    ctx.fillText(w.text, x0 + W / 2, y0 + H / 2 + 3);
    ctx.restore();
  });
  return tex(c);
}

// ---------------------------------------------------------------- billboard ads

type Ad = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function vanSilhouette(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, body: string, accent: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(0, 0, 150, 70, 10);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(150, 14);
  ctx.lineTo(188, 30);
  ctx.lineTo(196, 70);
  ctx.lineTo(150, 70);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#28323c";
  ctx.beginPath();
  ctx.moveTo(156, 22);
  ctx.lineTo(182, 33);
  ctx.lineTo(186, 46);
  ctx.lineTo(156, 46);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(0, 40, 150, 10);
  ctx.fillStyle = "#16181b";
  for (const wx of [36, 160]) {
    ctx.beginPath();
    ctx.arc(wx, 72, 15, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function speedLines(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x - 90 + i * 14, y + i * 22);
    ctx.lineTo(x - 20, y + i * 22);
    ctx.stroke();
  }
}

const ADS: Ad[] = [
  // Hamyway Delivery (hero)
  (ctx, w, h) => {
    ctx.fillStyle = "#ff6a1a";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#ff8a45";
    ctx.beginPath();
    ctx.arc(w * 0.82, h * 0.5, h * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 120px ${FONT}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText("HAMYWAY", 48, 150);
    ctx.font = `bold 44px ${FONT}`;
    ctx.fillText("Delivered before", 52, 238);
    ctx.fillText("you missed it.", 52, 290);
    ctx.font = `600 24px ${FONT}`;
    ctx.globalAlpha = 0.9;
    ctx.fillText("rivet.delivery  ·  same-day across the city", 52, 348);
    ctx.globalAlpha = 1;
    speedLines(ctx, w * 0.63, h * 0.47, "#ffffff");
    vanSilhouette(ctx, w * 0.63, h * 0.38, 1.55, "#ffffff", "#ff6a1a");
  },
  // Glowmilk
  (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#9be7ff");
    g.addColorStop(1, "#e3f9ff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#1b4f8a";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.roundRect(w * 0.72, 60, 150, 270, 24);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1b4f8a";
    ctx.font = `900 96px ${FONT}`;
    ctx.fillText("GLOWMILK", 48, 160);
    ctx.font = `bold 40px ${FONT}`;
    ctx.fillText("Mornings, but brighter.", 52, 240);
    ctx.font = `bold 30px ${FONT}`;
    ctx.fillText("MILK", w * 0.72 + 38, 210);
  },
  // Nimbus Air
  (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#1a2a6c");
    g.addColorStop(1, "#5b7bd5");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (const [x, y, r] of [[720, 260, 60], [790, 240, 80], [870, 270, 55], [200, 330, 40], [260, 320, 55]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffffff";
    ctx.save();
    ctx.translate(800, 120);
    ctx.rotate(-0.18);
    ctx.fillRect(-120, -10, 240, 20);
    ctx.fillRect(-30, -60, 40, 120);
    ctx.restore();
    ctx.font = `900 92px ${FONT}`;
    ctx.fillText("NIMBUS AIR", 48, 140);
    ctx.font = `bold 38px ${FONT}`;
    ctx.fillText("Fly above it all.", 52, 210);
  },
  // Kettle & Co tea
  (ctx, w, h) => {
    ctx.fillStyle = "#1f4d3a";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#f3e3c3";
    ctx.font = `italic 900 90px Georgia, serif`;
    ctx.fillText("Kettle & Co.", 48, 150);
    ctx.font = `bold 40px ${FONT}`;
    ctx.fillText("A proper brew since 1891.", 52, 230);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(w * 0.74, 150, 170, 150, 20);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(w * 0.74 + 185, 225, 38, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 6;
    for (const dx of [40, 85, 130]) {
      ctx.beginPath();
      ctx.moveTo(w * 0.74 + dx, 130);
      ctx.bezierCurveTo(w * 0.74 + dx - 20, 100, w * 0.74 + dx + 20, 80, w * 0.74 + dx, 50);
      ctx.stroke();
    }
  },
  // Zephyr phone
  (ctx, w, h) => {
    ctx.fillStyle = "#0b0b10";
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(w * 0.68, 0, w, h);
    g.addColorStop(0, "#ff4df0");
    g.addColorStop(1, "#3ad8ff");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(w * 0.72, 30, 170, 330, 30);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `200 100px ${FONT}`;
    ctx.fillText("zephyr 9", 48, 160);
    ctx.font = `400 38px ${FONT}`;
    ctx.fillText("It just thinks.", 52, 230);
  },
  // Banger Burgers
  (ctx, w, h) => {
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#d62828";
    ctx.font = `900 104px ${FONT}`;
    ctx.fillText("BANGER", 48, 140);
    ctx.fillText("BURGERS", 48, 250);
    ctx.font = `bold 34px ${FONT}`;
    ctx.fillStyle = "#3a1c0a";
    ctx.fillText("Double stack. Zero regrets.", 52, 320);
    const cx = w * 0.82;
    const layers: [string, number][] = [["#e9a03b", 34], ["#3fae49", 12], ["#7a3b16", 30], ["#f6c445", 10], ["#e9a03b", 28]];
    let y = 110;
    for (const [col, hh] of layers) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.roundRect(cx - 120, y, 240, hh, 14);
      ctx.fill();
      y += hh + 4;
    }
  },
  // Hamyway Express (dark)
  (ctx, w, h) => {
    ctx.fillStyle = "#14161c";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#ff6a1a";
    ctx.fillRect(0, h - 26, w, 26);
    ctx.font = `900 84px ${FONT}`;
    ctx.fillText("HAMYWAY EXPRESS", 48, 130);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold 42px ${FONT}`;
    ctx.fillText("Ordered at 9. On your desk by 12.", 52, 210);
    ctx.font = `600 26px ${FONT}`;
    ctx.fillStyle = "#c8ccd4";
    ctx.fillText("AI-routed around every jam, crash and roadwork.", 52, 270);
    vanSilhouette(ctx, w * 0.7, h * 0.55, 1.0, "#ffffff", "#ff6a1a");
  },
  // Sofa Kingdom
  (ctx, w, h) => {
    ctx.fillStyle = "#6c2bd9";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 92px ${FONT}`;
    ctx.fillText("SOFA KINGDOM", 48, 140);
    ctx.fillStyle = "#ffe14d";
    ctx.font = `900 120px ${FONT}`;
    ctx.fillText("SALE", 52, 280);
    ctx.fillStyle = "#ff8fb1";
    ctx.beginPath();
    ctx.roundRect(w * 0.62, 200, 330, 110, 26);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(w * 0.62, 150, 330, 70, 26);
    ctx.fill();
  },
];

/** One texture per ad (1024 x 384, matches the 12 x 4.5 m board). */
export function adTextures() {
  return ADS.map((draw) => {
    const { c, ctx } = canvas(1024, 384);
    draw(ctx, c.width, c.height);
    return tex(c, 8);
  });
}

// ---------------------------------------------------------------- LED wall

/** Screen regions on the 1024 x 1024 LED canvas, in pixels: x, y, w, h. */
export const LED_REGIONS = {
  west: [0, 0, 640, 384],
  south: [0, 384, 640, 384],
  westTicker: [0, 768, 640, 64],
  southTicker: [0, 832, 640, 64],
  westTop: [640, 0, 384, 172],
  southTop: [640, 172, 384, 172],
} as const;
export type LedScreen = keyof typeof LED_REGIONS;
export const LED_SIZE = 1024;

/** UV rect for a region (v up, canvas y down). */
export function ledRect(s: LedScreen): [number, number, number, number] {
  const [x, y, w, h] = LED_REGIONS[s];
  return [x / LED_SIZE, 1 - (y + h) / LED_SIZE, (x + w) / LED_SIZE, 1 - y / LED_SIZE];
}

interface Slide {
  bg: [string, string];
  title: string;
  sub: string;
  fg: string;
  shape: "rings" | "stripes" | "dots" | "van" | "wave";
}

const SLIDES: Slide[] = [
  { bg: ["#ff6a1a", "#ff2e63"], title: "HAMYWAY", sub: "Delivered before you missed it", fg: "#ffffff", shape: "van" },
  { bg: ["#00c6ff", "#0072ff"], title: "GLOWMILK", sub: "Mornings, but brighter", fg: "#ffffff", shape: "dots" },
  { bg: ["#f7971e", "#ffd200"], title: "BANGER", sub: "Burgers that slap", fg: "#3a0d0d", shape: "stripes" },
  { bg: ["#8e2de2", "#4a00e0"], title: "zephyr 9", sub: "It just thinks", fg: "#ffffff", shape: "rings" },
  { bg: ["#11998e", "#38ef7d"], title: "NIMBUS AIR", sub: "Fly above it all", fg: "#ffffff", shape: "wave" },
  { bg: ["#fc466b", "#3f5efb"], title: "NEON NIGHTS", sub: "Now showing · West End", fg: "#ffffff", shape: "rings" },
  { bg: ["#232526", "#414345"], title: "HAMYWAY EXPRESS", sub: "AI-routed. Always on time.", fg: "#ff6a1a", shape: "van" },
  { bg: ["#ee0979", "#ff6a00"], title: "FIZZ!", sub: "Taste the static", fg: "#ffffff", shape: "dots" },
];

const TICKERS = [
  "HAMYWAY DELIVERY  ★  98.7% ON TIME TODAY  ★  1,204 PARCELS OUT FOR DELIVERY  ★  ",
  "BREAKING: TRAFFIC REROUTED AROUND A-RING  ★  GLOWMILK  ★  NIMBUS AIR: LONDON → EVERYWHERE  ★  ",
];

function drawSlide(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: Slide, t: number, wipe: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, s.bg[0]);
  g.addColorStop(1, s.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  if (s.shape === "rings") {
    ctx.lineWidth = Math.max(4, h * 0.03);
    for (let i = 0; i < 6; i++) {
      const r = ((t * 60 + i * h * 0.25) % (w * 0.9)) + 10;
      ctx.beginPath();
      ctx.arc(x + w * 0.75, y + h * 0.5, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (s.shape === "stripes") {
    for (let i = -4; i < 16; i++) {
      const sx = x + ((i * 70 + t * 80) % (w + 280)) - 140;
      ctx.beginPath();
      ctx.moveTo(sx, y + h);
      ctx.lineTo(sx + 35, y + h);
      ctx.lineTo(sx + 35 + h * 0.6, y);
      ctx.lineTo(sx + h * 0.6, y);
      ctx.fill();
    }
  } else if (s.shape === "dots") {
    for (let i = 0; i < 24; i++) {
      const px = x + ((i * 97 + t * 40 * (1 + (i % 3))) % w);
      const py = y + h - ((i * 53 + t * 70) % h);
      ctx.beginPath();
      ctx.arc(px, py, 6 + (i % 4) * 5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (s.shape === "wave") {
    ctx.lineWidth = Math.max(3, h * 0.02);
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      for (let px = 0; px <= w; px += 16) {
        const py = y + h * (0.55 + k * 0.1) + Math.sin(px * 0.02 + t * 2 + k) * h * 0.05;
        if (px === 0) ctx.moveTo(x + px, py);
        else ctx.lineTo(x + px, py);
      }
      ctx.stroke();
    }
  } else {
    // van zooming across
    ctx.globalAlpha = 0.9;
    const vx = x + ((t * 160) % (w + 400)) - 300;
    speedLines(ctx, vx, y + h * 0.62, "#ffffff");
    vanSilhouette(ctx, vx, y + h * 0.55, h / 260, "#ffffff", "#ff6a1a");
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = s.fg;
  ctx.textBaseline = "alphabetic";
  const big = Math.min(h * 0.36, (w * 1.6) / Math.max(4, s.title.length));
  ctx.font = `900 ${big}px ${FONT}`;
  const pulse = 1 + Math.sin(t * 3) * 0.02;
  ctx.save();
  ctx.translate(x + w * 0.06, y + h * 0.5);
  ctx.scale(pulse, pulse);
  ctx.fillText(s.title, 0, 0);
  ctx.restore();
  ctx.font = `bold ${Math.max(14, big * 0.32)}px ${FONT}`;
  ctx.fillText(s.sub, x + w * 0.06, y + h * 0.5 + big * 0.55);
  // wipe transition (black bar sweeping across)
  if (wipe > 0) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(x, y, w * wipe, h);
  }
  ctx.restore();
}

/** Paints the whole LED wall for time t (seconds). Cheap enough to run a few times a second. */
export class LedPainter {
  readonly texture: CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private readonly offsets: Record<LedScreen, number> = { west: 0, south: 3, westTop: 5, southTop: 1, westTicker: 0, southTicker: 0 };

  constructor() {
    const { c, ctx } = canvas(LED_SIZE, LED_SIZE);
    this.ctx = ctx;
    this.texture = tex(c, 4);
    this.paint(0);
  }

  paint(t: number) {
    const ctx = this.ctx;
    for (const s of ["west", "south", "westTop", "southTop"] as const) {
      const [x, y, w, h] = LED_REGIONS[s];
      const period = s.endsWith("Top") ? 4 : 6;
      const phase = t / period + this.offsets[s] * 0.37;
      const k = Math.floor(phase);
      const local = (phase - k) * period;
      const slide = SLIDES[(k + this.offsets[s]) % SLIDES.length];
      const wipe = local < 0.5 ? 1 - local / 0.5 : 0;
      drawSlide(ctx, x, y, w, h, slide, t, wipe);
      // LED pixel grid
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      for (let gy = y; gy < y + h; gy += 6) ctx.fillRect(x, gy, w, 1);
    }
    TICKERS.forEach((text, i) => {
      const [x, y, w, h] = LED_REGIONS[i === 0 ? "westTicker" : "southTicker"];
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.fillStyle = "#050507";
      ctx.fillRect(x, y, w, h);
      ctx.font = `bold ${h * 0.62}px ${FONT}`;
      ctx.textBaseline = "middle";
      ctx.fillStyle = i === 0 ? "#ffb21a" : "#4df0ff";
      const tw = ctx.measureText(text).width;
      const off = (t * 140) % tw;
      for (let px = x - off; px < x + w; px += tw) ctx.fillText(text, px, y + h / 2);
      ctx.restore();
    });
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}
