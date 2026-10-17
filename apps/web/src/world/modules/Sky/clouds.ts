// Seeded low-poly cloud layout for the Sky module (static instance matrices; drift happens in the shader).
import { Euler, InstancedBufferAttribute, Matrix4, Quaternion, Vector3 } from "three";

export const CLOUD_COUNT = 70;
export const CLOUD_SPAN = 3600; // clouds wrap over x, z in [-1800, 1800]
/** Clouds shown at clear sky; the rest fade in (by count) as cover rises. */
export const CLEAR_CLOUDS = 26;

export interface CloudLayout {
  puffs: number;
  /** puffEnd[c] = number of puffs in clouds 0..c-1 (so puffEnd[n] is the instance count for n clouds) */
  puffEnd: Uint16Array;
  matrices: Float32Array; // 16 per puff
  anchors: InstancedBufferAttribute; // vec2 per puff: its cloud's centre (x, z)
}

export function buildClouds(seed = 1337): CloudLayout {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const mats: number[] = [];
  const anchors: number[] = [];
  const puffEnd = new Uint16Array(CLOUD_COUNT + 1);
  const m = new Matrix4();
  const q = new Quaternion();
  const e = new Euler();
  const p = new Vector3();
  const sc = new Vector3();
  let n = 0;
  for (let c = 0; c < CLOUD_COUNT; c++) {
    const cx = -CLOUD_SPAN / 2 + rnd() * CLOUD_SPAN;
    const cz = -CLOUD_SPAN / 2 + rnd() * CLOUD_SPAN;
    const cy = 170 + rnd() * 110;
    const puffs = 4 + Math.floor(rnd() * 5);
    const size = 16 + rnd() * 18;
    for (let i = 0; i < puffs; i++) {
      const along = (i / (puffs - 1) - 0.5) * size * 2.6;
      const r = size * (0.65 + rnd() * 0.5) * (1 - Math.abs(along) / (size * 3.2));
      p.set(cx + along, cy + (rnd() - 0.3) * size * 0.35, cz + (rnd() - 0.5) * size * 0.9);
      sc.set(r * 1.25, r * 0.7, r);
      q.setFromEuler(e.set(rnd() * 0.4, rnd() * Math.PI * 2, rnd() * 0.4));
      m.compose(p, q, sc);
      for (let k = 0; k < 16; k++) mats.push(m.elements[k]);
      anchors.push(cx, cz);
      n++;
    }
    puffEnd[c + 1] = n;
  }
  return {
    puffs: n,
    puffEnd,
    matrices: Float32Array.from(mats),
    anchors: new InstancedBufferAttribute(Float32Array.from(anchors), 2),
  };
}
