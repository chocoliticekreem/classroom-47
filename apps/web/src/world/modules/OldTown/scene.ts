// Assembles the whole Old Town into a handful of merged geometries (one draw call each).
import { BufferGeometry, Float32BufferAttribute } from "three";
import { GeoBuilder, T, jitter } from "./kit";
import { bakeHouse, newHouseGeo } from "./houses";
import { boatParts, buildLandmarks } from "./landmarks";
import { buildLayout, mulberry32, type OldTownLayout } from "./layout";

function trees(b: GeoBuilder, L: OldTownLayout) {
  const r = mulberry32(9);
  b.setFrame();
  for (const t of L.trees) {
    const s = t.s;
    const shade = r();
    if (t.kind === 2) {
      b.box("#5b4030", t.x, 0, t.z, 0.4 * s, 1.2 * s, 0.4 * s);
      b.add(T.cone8, jitter("#2f5a34", shade, 0.15), t.x, 4 * s, t.z, 3.4 * s, 6.5 * s, 3.4 * s);
    } else if (t.kind === 1) {
      b.box("#8a7a62", t.x, 0, t.z, 0.5 * s, 4.5 * s, 0.5 * s);
      b.add(T.blob0, jitter("#5d8a3c", shade, 0.18), t.x, 6.6 * s, t.z, 6 * s, 5 * s, 6 * s, shade * 3);
      b.add(T.blob0, jitter("#6b9644", 1 - shade, 0.18), t.x + 1.2 * s, 8.2 * s, t.z - 0.8 * s, 4.2 * s, 3.6 * s, 4.2 * s, shade * 5);
    } else {
      b.box("#5e4532", t.x, 0, t.z, 0.4 * s, 2.4 * s, 0.4 * s);
      b.add(T.blob0, jitter("#4f7f39", shade, 0.2), t.x, 4.2 * s, t.z, 4.6 * s, 4 * s, 4.6 * s, shade * 4);
    }
  }
}

function lamps(b: GeoBuilder, glow: GeoBuilder, L: OldTownLayout) {
  b.setFrame();
  glow.setFrame();
  const IRON = "#1f2b25";
  for (const [x, z] of L.lamps) {
    b.box(IRON, x, 0, z, 0.36, 0.5, 0.36);
    b.box(IRON, x, 0.5, z, 0.14, 3.5, 0.14);
    b.box(IRON, x, 3.95, z, 0.5, 0.1, 0.5);
    glow.add(T.box, "#ffc46b", x, 4.32, z, 0.4, 0.62, 0.4);
    b.add(T.cone4, IRON, x, 4.83, z, 0.72, 0.42, 0.72, Math.PI / 4);
  }
}

export interface OldTownScene {
  layout: OldTownLayout;
  low: BufferGeometry | null; // houses under 12 m, trees, lamps, railings (no shadow casting)
  tall: BufferGeometry | null; // taller houses (cast shadows)
  stone: BufferGeometry | null; // landmarks (cast shadows, flood-lit at night)
  windows: BufferGeometry | null; // house windows with aLit
  glow: BufferGeometry | null; // lamps, stained glass, clock faces
  pave: BufferGeometry | null;
  lawn: BufferGeometry | null;
  water: BufferGeometry | null;
}

export function buildOldTown(seed = 1701): OldTownScene {
  const layout = buildLayout(seed);
  const H = newHouseGeo();
  for (const h of layout.houses) bakeHouse(H, h);
  const lm = buildLandmarks(layout);
  trees(H.low, layout);
  lamps(H.low, lm.glow, layout);
  // railings and other small landmark bits go with the low set
  const low = mergeInto(H.low, lm.low);
  return {
    layout,
    low,
    tall: H.tall.build(),
    stone: lm.stone.build(),
    windows: H.windows.build(),
    glow: lm.glow.build(),
    pave: lm.pave.build(),
    lawn: lm.lawn.build(),
    water: lm.water.build(),
  };
}

function mergeInto(a: GeoBuilder, b: GeoBuilder): BufferGeometry | null {
  const ga = a.build();
  const gb = b.build();
  if (!ga || !gb) return ga ?? gb;
  const out = new BufferGeometry();
  for (const name of ["position", "normal", "color"]) {
    const x = ga.getAttribute(name).array as Float32Array;
    const y = gb.getAttribute(name).array as Float32Array;
    const m = new Float32Array(x.length + y.length);
    m.set(x);
    m.set(y, x.length);
    out.setAttribute(name, new Float32BufferAttribute(m, 3));
  }
  ga.dispose();
  gb.dispose();
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** A narrowboat (for the two that cruise the canal). */
export function boatGeometry() {
  const b = new GeoBuilder();
  boatParts(b, 16, "#8b1e24", "#f0c84a");
  return b.build()!;
}

/** A small person: dark legs, white torso (tinted per instance via aLit), skin-tone head. Feet at y = 0, facing +z. */
export function personGeometry() {
  const b = new GeoBuilder(true); // aLit marks the torso, which takes the per-person shirt colour
  b.add(T.box, "#3a3f4a", 0, 0.42, 0, 0.42, 0.84, 0.26);
  b.litValue = 1;
  b.add(T.box, "#ffffff", 0, 1.2, 0, 0.5, 0.72, 0.3);
  b.litValue = 0;
  b.add(T.box, "#f0c8a8", 0, 1.72, 0, 0.26, 0.28, 0.26);
  return b.build()!;
}
