// Geometry helpers: paint primitives with vertex colours and merge them, so a multi-coloured
// prop is a single geometry (one draw call when instanced).
import { BufferAttribute, Color, type BufferGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const tmp = new Color();

/** Adds a flat vertex colour to a geometry (returns it, for chaining). */
export function paint<T extends BufferGeometry>(geo: T, hex: string): T {
  tmp.set(hex);
  const n = geo.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = tmp.r;
    arr[i * 3 + 1] = tmp.g;
    arr[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new BufferAttribute(arr, 3));
  return geo;
}

/** Merge painted parts into one geometry. Mixed indexed / non-indexed parts are flattened first. */
export function merge(parts: BufferGeometry[]): BufferGeometry {
  const mixed = parts.some((p) => p.index) && parts.some((p) => !p.index);
  const ready = mixed ? parts.map((p) => (p.index ? p.toNonIndexed() : p)) : parts;
  const out = mergeGeometries(ready, false);
  for (const p of parts) p.dispose();
  for (const p of ready) p.dispose();
  if (!out) throw new Error("Life: geometry merge failed");
  return out;
}
