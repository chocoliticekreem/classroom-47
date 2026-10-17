// Canvas textures for the railway: station name boards (one atlas), the terminus clock face and sign,
// container corrugation and barrier stripes.
import * as THREE from "three";
import { canvasTexture, fitFont, railArrows } from "./kit";

export const BOARD_NAMES = ["King's Hamyway", "Airport Parkway", "Old Town", "Hampstead Heath", "Shoreditch"] as const;
const ROW = 128;

/** Station boards, one per row: BR-blue with white lettering and the double-arrow. */
export function boardAtlas() {
  return canvasTexture(1024, ROW * BOARD_NAMES.length, (c) => {
    BOARD_NAMES.forEach((name, i) => {
      const y = i * ROW;
      c.fillStyle = "#1d2c55";
      c.fillRect(0, y, 1024, ROW);
      c.fillStyle = "#ffffff";
      c.fillRect(0, y + 6, 1024, 6);
      c.fillRect(0, y + ROW - 12, 1024, 6);
      railArrows(c, 24, y + 30, 110, 66, "#ffffff");
      c.fillStyle = "#ffffff";
      fitFont(c, name, 820, 76);
      c.textBaseline = "middle";
      c.fillText(name, 160, y + ROW / 2 + 2);
    });
  });
}

/** UV rect (v0, v1) of a board row in the atlas (flipY: row 0 is at the top). */
export function boardRow(name: string): [number, number] {
  const i = Math.max(0, BOARD_NAMES.indexOf(name as (typeof BOARD_NAMES)[number]));
  const n = BOARD_NAMES.length;
  return [1 - (i + 1) / n, 1 - i / n];
}

export function clockFace() {
  return canvasTexture(256, 256, (c) => {
    c.fillStyle = "#2b2b2b";
    c.fillRect(0, 0, 256, 256);
    c.beginPath();
    c.arc(128, 128, 118, 0, Math.PI * 2);
    c.fillStyle = "#c9a13b";
    c.fill();
    c.beginPath();
    c.arc(128, 128, 108, 0, Math.PI * 2);
    c.fillStyle = "#f7f1de";
    c.fill();
    c.fillStyle = "#1b1b1b";
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * Math.PI * 2;
      const r0 = k % 5 === 0 ? 86 : 96;
      c.save();
      c.translate(128 + Math.sin(a) * ((r0 + 102) / 2), 128 - Math.cos(a) * ((r0 + 102) / 2));
      c.rotate(a);
      c.fillRect(k % 5 === 0 ? -3 : -1, -(102 - r0) / 2, k % 5 === 0 ? 6 : 2, 102 - r0);
      c.restore();
    }
    c.font = "bold 22px Georgia, serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    const roman = ["XII", "III", "VI", "IX"];
    roman.forEach((r, i) => {
      const a = (i / 4) * Math.PI * 2;
      c.fillText(r, 128 + Math.sin(a) * 68, 128 - Math.cos(a) * 68);
    });
  });
}

export function terminusSign() {
  return canvasTexture(1024, 160, (c) => {
    c.fillStyle = "#14213d";
    c.fillRect(0, 0, 1024, 160);
    c.strokeStyle = "#c9a13b";
    c.lineWidth = 8;
    c.strokeRect(8, 8, 1008, 144);
    c.fillStyle = "#f3e7c4";
    c.font = "bold 92px Georgia, serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("KING'S HAMYWAY", 512, 84);
  });
}

/** Corrugated container side: vertical ribs, light, multiplied by the instance colour. */
export function corrugation() {
  const t = canvasTexture(64, 64, (c) => {
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, 64, 64);
    for (let x = 0; x < 64; x += 8) {
      c.fillStyle = "#c8c8c8";
      c.fillRect(x, 0, 3, 64);
      c.fillStyle = "#e4e4e4";
      c.fillRect(x + 3, 0, 1, 64);
    }
    c.fillStyle = "#9a9a9a";
    c.fillRect(0, 0, 64, 3);
    c.fillRect(0, 61, 64, 3);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
