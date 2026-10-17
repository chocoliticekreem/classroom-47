// CanvasTextures for the roadworks kit: LED arrow board (animated atlas), rear chevrons, barrier stripes,
// and the "ROAD CLOSED / DIVERSION" sign. Browser-only (uses document), call from inside the Canvas.
import { CanvasTexture, NearestFilter, SRGBColorSpace } from "three";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function finish(c: HTMLCanvasElement) {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export const ARROW_FRAMES = 4;
const COLS = 20;
const ROWS = 13;

/** Dot-matrix arrow board, one frame per quarter of the atlas: 1, 2, 3 chevrons lit, then all lit with corner lamps. */
export function makeArrowAtlas() {
  const fw = 200;
  const fh = 140;
  const [c, g] = canvas(fw * ARROW_FRAMES, fh);
  const pitch = fw / COLS;
  const r = pitch * 0.36;
  const mid = (ROWS - 1) / 2;
  const tips = [7, 12, 17]; // chevron tips (columns), pointing right
  for (let f = 0; f < ARROW_FRAMES; f++) {
    const ox = f * fw;
    g.fillStyle = "#0b0b0b";
    g.fillRect(ox, 0, fw, fh);
    const litChevrons = f === 3 ? 3 : f + 1;
    for (let col = 0; col < COLS; col++)
      for (let row = 0; row < ROWS; row++) {
        let lit = false;
        const dy = Math.abs(row - mid);
        for (let k = 0; k < litChevrons; k++) {
          const back = tips[k] - col; // columns behind the tip
          if (back >= 0 && dy <= 5.5 && Math.abs(back - dy) < 1.1) lit = true;
        }
        g.beginPath();
        g.arc(ox + (col + 0.5) * pitch, (row + 0.5) * (fh / ROWS), r, 0, Math.PI * 2);
        g.fillStyle = lit ? "#ffb21c" : "#262219";
        g.fill();
      }
    // corner lamps flash on alternate frames
    const corner = f % 2 === 0;
    for (const [cx, cy] of [
      [8, 8],
      [fw - 8, 8],
      [8, fh - 8],
      [fw - 8, fh - 8],
    ]) {
      g.beginPath();
      g.arc(ox + cx, cy, 6, 0, Math.PI * 2);
      g.fillStyle = corner ? "#fff1b0" : "#3a3020";
      g.fill();
    }
  }
  const t = finish(c);
  t.magFilter = NearestFilter;
  t.repeat.set(1 / ARROW_FRAMES, 1);
  return t;
}

/** Red/white rear chevrons ("Battenburg" style rear of a UK highways truck). */
export function makeChevrons() {
  const [c, g] = canvas(256, 96);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 256, 96);
  g.fillStyle = "#e01e1e";
  const w = 32;
  for (let x = -128; x < 256 + 128; x += w * 2) {
    // inverted V chevrons meeting in the centre
    g.beginPath();
    g.moveTo(128 + (x - 128) * 0.5, 0);
    g.lineTo(128 + (x - 128) * 0.5 + w, 0);
    g.lineTo(x + w + (x < 128 ? -48 : 48), 96);
    g.lineTo(x + (x < 128 ? -48 : 48), 96);
    g.closePath();
    g.fill();
  }
  return finish(c);
}

/** Red and white blocks for barrier boards. */
export function makeBarrierStripes() {
  const [c, g] = canvas(128, 16);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? "#ffffff" : "#e01e1e";
    g.fillRect(i * 16, 0, 16, 16);
  }
  const t = finish(c);
  t.magFilter = NearestFilter;
  return t;
}

/** "ROAD CLOSED" over a yellow "DIVERSION" panel. */
export function makeClosedSign() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 256, 256);
  // red bordered closure panel
  g.strokeStyle = "#d81b1b";
  g.lineWidth = 16;
  g.strokeRect(12, 12, 232, 140);
  g.fillStyle = "#111111";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "bold 50px Arial, Helvetica, sans-serif";
  g.fillText("ROAD", 128, 58);
  g.fillText("CLOSED", 128, 108);
  // diversion panel
  g.fillStyle = "#ffd21a";
  g.fillRect(0, 168, 256, 88);
  g.fillStyle = "#111111";
  g.font = "bold 34px Arial, Helvetica, sans-serif";
  g.fillText("DIVERSION", 112, 212);
  g.beginPath();
  g.moveTo(208, 196);
  g.lineTo(240, 212);
  g.lineTo(208, 228);
  g.closePath();
  g.fill();
  g.fillRect(196, 206, 16, 12);
  return finish(c);
}
