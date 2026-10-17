// Canvas textures for road signs and closure overlays. No network assets.
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function finish(c: HTMLCanvasElement) {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';

/** Blue motorway sign: small route line on top, big destination below. */
export function signTexture(top: string, main: string) {
  const [c, g] = canvas(512, 208);
  g.fillStyle = "#1d4fa8";
  g.fillRect(0, 0, 512, 208);
  g.strokeStyle = "#ffffff";
  g.lineWidth = 8;
  g.beginPath();
  g.roundRect(10, 10, 492, 188, 18);
  g.stroke();
  g.textAlign = "center";
  g.textBaseline = "middle";
  // route shield
  g.fillStyle = "#ffffff";
  g.font = `bold 34px ${FONT}`;
  const tw = g.measureText(top).width + 30;
  g.beginPath();
  g.roundRect(256 - tw / 2, 26, tw, 46, 8);
  g.fill();
  g.fillStyle = "#1d4fa8";
  g.fillText(top, 256, 50);
  g.fillStyle = "#ffffff";
  let size = 78;
  g.font = `bold ${size}px ${FONT}`;
  while (g.measureText(main).width > 460 && size > 30) {
    size -= 4;
    g.font = `bold ${size}px ${FONT}`;
  }
  g.fillText(main, 256, 138);
  return finish(c);
}

/** Diagonal red/amber hazard hatch, tiles seamlessly. */
export function hatchTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = "#ffb300";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#ff1e1e";
  for (let i = -2; i < 4; i++) {
    g.beginPath();
    g.moveTo(i * 64, 0);
    g.lineTo(i * 64 + 32, 0);
    g.lineTo(i * 64 + 32 + 128, 128);
    g.lineTo(i * 64 + 128, 128);
    g.closePath();
    g.fill();
  }
  const t = finish(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  return t;
}

/** "ROAD CLOSED" barrier board with red/white chevrons at each end. */
export function closedBoardTexture() {
  const [c, g] = canvas(512, 96);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = "#e01010";
  for (const x0 of [0, 412]) {
    g.save();
    g.beginPath();
    g.rect(x0, 0, 100, 96);
    g.clip();
    for (let i = -3; i < 6; i++) {
      g.beginPath();
      g.moveTo(x0 + i * 40, 96);
      g.lineTo(x0 + i * 40 + 20, 96);
      g.lineTo(x0 + i * 40 + 116, 0);
      g.lineTo(x0 + i * 40 + 96, 0);
      g.closePath();
      g.fill();
    }
    g.restore();
  }
  g.fillStyle = "#e01010";
  g.font = `900 52px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("ROAD CLOSED", 256, 50);
  g.strokeStyle = "#e01010";
  g.lineWidth = 6;
  g.strokeRect(3, 3, 506, 90);
  return finish(c);
}
