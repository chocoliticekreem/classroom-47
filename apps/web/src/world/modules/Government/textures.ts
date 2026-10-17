// Canvas-drawn atlases (no network assets): flags (4 x 2 cells) and signs (2 x 4 cells).
import { CanvasTexture, SRGBColorSpace } from "three";

export const FLAG_COLS = 4;
export const FLAG_ROWS = 2;
const FW = 128;
const FH = 80;

/** UV rect of flag design `i`: [u0, v0, u1, v1]. */
export function flagUV(i: number): [number, number, number, number] {
  const c = i % FLAG_COLS;
  const r = Math.floor(i / FLAG_COLS);
  const pad = 1 / (FW * FLAG_COLS);
  return [c / FLAG_COLS + pad, 1 - (r + 1) / FLAG_ROWS + pad, (c + 1) / FLAG_COLS - pad, 1 - r / FLAG_ROWS - pad];
}

function unionish(g: CanvasRenderingContext2D) {
  g.fillStyle = "#1f2f74";
  g.fillRect(0, 0, FW, FH);
  const diag = (w: number, col: string) => {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(FW, FH);
    g.moveTo(FW, 0);
    g.lineTo(0, FH);
    g.stroke();
  };
  diag(16, "#ffffff");
  diag(6, "#c8102e");
  g.fillStyle = "#ffffff";
  g.fillRect(FW / 2 - 13, 0, 26, FH);
  g.fillRect(0, FH / 2 - 13, FW, 26);
  g.fillStyle = "#c8102e";
  g.fillRect(FW / 2 - 8, 0, 16, FH);
  g.fillRect(0, FH / 2 - 8, FW, 16);
}

function stripes(g: CanvasRenderingContext2D) {
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 ? "#ffffff" : "#b22234";
    g.fillRect(0, (i * FH) / 13, FW, FH / 13 + 1);
  }
  g.fillStyle = "#3c3b6e";
  g.fillRect(0, 0, FW * 0.42, FH * (7 / 13));
  g.fillStyle = "#ffffff";
  for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) g.fillRect(4 + x * 8.5 + (y % 2) * 4, 4 + y * 8, 2.5, 2.5);
}

const DRAW: ((g: CanvasRenderingContext2D) => void)[] = [
  unionish,
  stripes,
  (g) => {
    ["#169b62", "#ffffff", "#ff883e"].forEach((c, i) => {
      g.fillStyle = c;
      g.fillRect((i * FW) / 3, 0, FW / 3 + 1, FH);
    });
  },
  (g) => {
    ["#111111", "#dd0000", "#ffce00"].forEach((c, i) => {
      g.fillStyle = c;
      g.fillRect(0, (i * FH) / 3, FW, FH / 3 + 1);
    });
  },
  (g) => {
    g.fillStyle = "#006aa7";
    g.fillRect(0, 0, FW, FH);
    g.fillStyle = "#fecc00";
    g.fillRect(36, 0, 16, FH);
    g.fillRect(0, FH / 2 - 8, FW, 16);
  },
  // the city flag: Hamyway orange with a white rivet ring
  (g) => {
    g.fillStyle = "#ff6a1a";
    g.fillRect(0, 0, FW, FH);
    g.strokeStyle = "#ffffff";
    g.lineWidth = 9;
    g.beginPath();
    g.arc(FW / 2, FH / 2, 22, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(FW / 2, FH / 2, 8, 0, Math.PI * 2);
    g.fill();
  },
  (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, FW, FH);
    g.fillStyle = "#bc002d";
    g.beginPath();
    g.arc(FW / 2, FH / 2, 22, 0, Math.PI * 2);
    g.fill();
  },
  (g) => {
    g.fillStyle = "#003399";
    g.fillRect(0, 0, FW, FH);
    g.fillStyle = "#ffcc00";
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.arc(FW / 2 + Math.cos(a) * 24, FH / 2 + Math.sin(a) * 24, 3.4, 0, Math.PI * 2);
      g.fill();
    }
  },
];

export function makeFlagAtlas(): CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = FW * FLAG_COLS;
  cv.height = FH * FLAG_ROWS;
  const g = cv.getContext("2d")!;
  DRAW.forEach((draw, i) => {
    g.save();
    g.translate((i % FLAG_COLS) * FW, Math.floor(i / FLAG_COLS) * FH);
    g.beginPath();
    g.rect(0, 0, FW, FH);
    g.clip();
    draw(g);
    g.restore();
  });
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---- Signs ------------------------------------------------------------------------------------------------------

export const SIGN = {
  ministry: 0,
  mailroom: 1,
  downing: 2,
  parliament: 3,
  embassy: 4,
  no10: 5,
  police: 6,
  residence: 7,
} as const;

const SW = 512;
const SH = 128;
const SIGN_COLS = 2;
const SIGN_ROWS = 4;

export function signUV(i: number): [number, number, number, number] {
  const c = i % SIGN_COLS;
  const r = Math.floor(i / SIGN_COLS);
  return [c / SIGN_COLS, 1 - (r + 1) / SIGN_ROWS, (c + 1) / SIGN_COLS, 1 - r / SIGN_ROWS];
}

interface SignStyle {
  text: string;
  bg: string;
  fg: string;
  border?: string;
  font?: number;
}

const SIGNS: SignStyle[] = [
  { text: "MINISTRY OF TRANSPORT", bg: "#e6dfcf", fg: "#2b2a28", font: 48 },
  { text: "SECURE MAILROOM", bg: "#1d4f91", fg: "#ffffff", font: 56 },
  { text: "DOWNING STREET SW1", bg: "#ffffff", fg: "#111111", border: "#c8102e", font: 50 },
  { text: "HOUSES OF PARLIAMENT", bg: "#e3d3a4", fg: "#2b2418", font: 48 },
  { text: "EMBASSY", bg: "#14213d", fg: "#e2c26a", font: 72 },
  { text: "10", bg: "#111111", fg: "#f4f4f4", font: 96 },
  { text: "ARMED POLICE · NO ENTRY", bg: "#c8102e", fg: "#ffffff", font: 44 },
  { text: "THE RESIDENCE", bg: "#f4f1ea", fg: "#3a3a3a", font: 60 },
];

export function makeSignAtlas(): CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = SW * SIGN_COLS;
  cv.height = SH * SIGN_ROWS;
  const g = cv.getContext("2d")!;
  SIGNS.forEach((s, i) => {
    const x = (i % SIGN_COLS) * SW;
    const y = Math.floor(i / SIGN_COLS) * SH;
    g.fillStyle = s.bg;
    g.fillRect(x, y, SW, SH);
    if (s.border) {
      g.strokeStyle = s.border;
      g.lineWidth = 10;
      g.strokeRect(x + 8, y + 8, SW - 16, SH - 16);
    }
    g.fillStyle = s.fg;
    g.font = `bold ${s.font ?? 52}px "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(s.text, x + SW / 2, y + SH / 2 + 3, SW - 36);
  });
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
