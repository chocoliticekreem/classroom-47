// Shared materials and canvas-drawn sign textures for all landmarks (client only: uses document).
import {
  CanvasTexture,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  type Texture,
} from "three";

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  draw(g);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";

function signTex(text: string, bg: string, fg: string, opts: { border?: string; w?: number; h?: number; size?: number } = {}) {
  const w = opts.w ?? 1024;
  const h = opts.h ?? 256;
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    if (opts.border) {
      g.strokeStyle = opts.border;
      g.lineWidth = h * 0.08;
      g.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12);
    }
    g.fillStyle = fg;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `bold ${opts.size ?? Math.round(h * 0.62)}px ${FONT}`;
    g.fillText(text, w / 2, h / 2 + h * 0.03);
  });
}

function clockTex() {
  const s = 512;
  return canvasTex(s, s, (g) => {
    const c = s / 2;
    // gilded surround
    g.fillStyle = "#c9962b";
    g.fillRect(0, 0, s, s);
    const grd = g.createRadialGradient(c, c, s * 0.1, c, c, s * 0.5);
    grd.addColorStop(0, "#fff7dc");
    grd.addColorStop(0.82, "#f3e2ad");
    grd.addColorStop(0.83, "#d9a93a");
    grd.addColorStop(1, "#a8761a");
    g.fillStyle = grd;
    g.beginPath();
    g.arc(c, c, s * 0.5, 0, Math.PI * 2);
    g.fill();
    // minute ring
    g.strokeStyle = "#1c1a16";
    g.lineWidth = 6;
    g.beginPath();
    g.arc(c, c, s * 0.39, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const r0 = s * (i % 5 === 0 ? 0.33 : 0.36);
      g.lineWidth = i % 5 === 0 ? 9 : 4;
      g.beginPath();
      g.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0);
      g.lineTo(c + Math.sin(a) * s * 0.39, c - Math.cos(a) * s * 0.39);
      g.stroke();
    }
    const numerals = ["XII", "I", "II", "III", "IIII", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
    g.fillStyle = "#1c1a16";
    g.font = `bold 40px Georgia, "Times New Roman", serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    numerals.forEach((n, i) => {
      const a = (i / 12) * Math.PI * 2;
      g.save();
      g.translate(c + Math.sin(a) * s * 0.26, c - Math.cos(a) * s * 0.26);
      g.rotate(a);
      g.fillText(n, 0, 0);
      g.restore();
    });
    // gothic tracery hint: inner rosette
    g.strokeStyle = "rgba(160,120,40,0.55)";
    g.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.arc(c + Math.sin(a) * s * 0.1, c - Math.cos(a) * s * 0.1, s * 0.1, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = "#c9962b";
    g.beginPath();
    g.arc(c, c, s * 0.03, 0, Math.PI * 2);
    g.fill();
  });
}

function lit(map: Texture) {
  return new MeshBasicMaterial({ map, toneMapped: false });
}

export function makeMaterials() {
  const textures = {
    police: signTex("POLICE", "#13307a", "#ffffff", { border: "#ffffff" }),
    ae: signTex("A&E", "#d0202a", "#ffffff", { w: 512, h: 160 }),
    hospital: signTex("HOSPITAL", "#0b5fb3", "#ffffff"),
    depot: signTex("HIGHWAYS DEPOT", "#ff7a1a", "#1b1b1b", { border: "#1b1b1b", size: 120 }),
    eye: signTex("HAMYWAY EYE", "#ff6a1a", "#ffffff", { size: 150 }),
    clock: clockTex(),
  };
  const signs = {
    police: lit(textures.police),
    ae: lit(textures.ae),
    hospital: lit(textures.hospital),
    depot: lit(textures.depot),
    eye: lit(textures.eye),
    clock: lit(textures.clock),
  };
  const mats = {
    solid: new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }),
    glow: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    glass: new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.25,
      metalness: 0.3,
      emissive: "#ffc865",
      emissiveIntensity: 0,
      flatShading: true,
    }),
    water: new MeshStandardMaterial({ color: "#3d93c9", roughness: 0.12, metalness: 0.15, flatShading: true }),
    hands: new MeshStandardMaterial({ color: "#14120f", roughness: 0.5, metalness: 0.4 }),
    signs,
  };

  let last = -1;
  /** Apply the day/night look. Cheap; skips work when nothing changed. */
  const setNight = (f: number) => {
    const q = Math.round(f * 100) / 100;
    if (q === last) return;
    last = q;
    mats.glow.color.setScalar(0.65 + 0.85 * q);
    mats.glass.emissiveIntensity = 0.9 * q;
    for (const s of Object.values(signs)) s.color.setScalar(0.85 + 0.45 * q);
  };

  const dispose = () => {
    for (const t of Object.values(textures)) t.dispose();
    const all: Material[] = [mats.solid, mats.glow, mats.glass, mats.water, mats.hands, ...Object.values(signs)];
    for (const m of all) m.dispose();
  };

  return { ...mats, setNight, dispose };
}

export type LandmarkMaterials = ReturnType<typeof makeMaterials>;
