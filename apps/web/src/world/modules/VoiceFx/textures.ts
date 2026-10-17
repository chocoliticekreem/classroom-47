// Canvas-drawn sprite textures for VoiceFx (no network assets). Created once, on the client.
import { CanvasTexture, SRGBColorSpace } from "three";

export interface VoiceTextures {
  phone: CanvasTexture;
  ring: CanvasTexture;
  envelope: CanvasTexture;
  check: CanvasTexture;
}

let cached: VoiceTextures | null = null;

function canvas(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  draw(g, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const ORANGE = "#ff6a1a";

export function voiceTextures(): VoiceTextures {
  if (cached) return cached;
  cached = {
    // An orange disc with a white handset.
    phone: canvas(256, (g, s) => {
      g.fillStyle = ORANGE;
      g.beginPath();
      g.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = s * 0.03;
      g.strokeStyle = "#ffffff";
      g.stroke();
      g.save();
      g.translate(s / 2, s / 2);
      g.rotate(-Math.PI / 4);
      g.fillStyle = "#ffffff";
      const w = s * 0.13;
      const h = s * 0.5;
      g.beginPath();
      g.roundRect(-w / 2, -h / 2, w, h, w / 2); // handle
      g.fill();
      g.beginPath();
      g.roundRect(-w * 1.25, -h / 2 - w * 0.2, w * 2.5, w * 1.05, w * 0.45); // earpiece
      g.roundRect(-w * 1.25, h / 2 - w * 0.85, w * 2.5, w * 1.05, w * 0.45); // mouthpiece
      g.fill();
      g.restore();
    }),
    ring: canvas(256, (g, s) => {
      g.strokeStyle = "#ffffff";
      g.lineWidth = s * 0.05;
      g.beginPath();
      g.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2);
      g.stroke();
    }),
    envelope: canvas(256, (g, s) => {
      const x = s * 0.1;
      const y = s * 0.24;
      const w = s * 0.8;
      const h = s * 0.52;
      g.fillStyle = "#ffffff";
      g.strokeStyle = ORANGE;
      g.lineWidth = s * 0.04;
      g.beginPath();
      g.roundRect(x, y, w, h, s * 0.05);
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(s / 2, y + h * 0.58);
      g.lineTo(x + w, y);
      g.stroke();
    }),
    check: canvas(256, (g, s) => {
      g.fillStyle = "#3ecf8e";
      g.beginPath();
      g.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#ffffff";
      g.lineWidth = s * 0.09;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      g.moveTo(s * 0.28, s * 0.52);
      g.lineTo(s * 0.44, s * 0.67);
      g.lineTo(s * 0.73, s * 0.35);
      g.stroke();
    }),
  };
  return cached;
}
