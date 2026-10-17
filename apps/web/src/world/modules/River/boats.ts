// River craft, built from primitives in local space: +z is the bow, waterline at y = 0. Each archetype
// is one merged vertex-coloured geometry rendered as an InstancedMesh.
import type * as THREE from "three";
import { GeoBuilder } from "./builder";

/** Thames sightseeing boat: long white hull, blue band, glazed saloon, open top deck with benches. */
export function tourBoat(): THREE.BufferGeometry {
  const B = new GeoBuilder();
  B.box(0, 0.3, 0, 5.4, 1.4, 22, "#f2f2ee");
  B.cone(0, 0.3, 11.9, 2.7, 1.8, "#f2f2ee", 4, Math.PI / 4).box(0, 0.75, 0, 5.5, 0.35, 22.1, "#1f4e8c");
  B.box(0, 1.9, -1, 4.6, 1.9, 16, "#9cc6dd"); // glazed saloon
  B.box(0, 2.9, -1, 4.8, 0.15, 16.4, "#f2f2ee");
  for (let z = -7; z <= 5; z += 2.4) B.box(0, 3.25, z, 3.6, 0.5, 0.5, "#c0392b"); // top-deck benches
  B.box(0, 3.4, 8, 2.2, 1.3, 2.2, "#f2f2ee"); // wheelhouse
  B.box(0, 4.1, -9.5, 0.08, 1.2, 0.08, "#cfcfcf").box(0.35, 4.45, -9.5, 0.7, 0.45, 0.04, "#c8102e"); // flag
  return B.build();
}

/** Thames River Police launch: dark blue hull, white cabin, yellow/blue battenberg, blue beacon. */
export function policeLaunch(): THREE.BufferGeometry {
  const B = new GeoBuilder();
  B.box(0, 0.35, -0.5, 3.6, 1.2, 11, "#1b2a4a");
  B.cone(0, 0.35, 5.6, 1.8, 2.2, "#1b2a4a", 4, Math.PI / 4);
  for (let k = 0; k < 8; k++) B.box(0, 1.0, -5 + k * 1.3, 3.65, 0.3, 1.3, k % 2 ? "#f6d21b" : "#1d5fbf");
  B.box(0, 1.9, 0.5, 2.8, 1.6, 4.6, "#f4f4f2");
  B.box(0, 2.75, 0.5, 3.0, 0.12, 5.0, "#1b2a4a");
  B.box(0, 3.0, 0.3, 0.9, 0.3, 0.4, "#2f7bff");
  return B.build();
}

/** A rowing eight: needle shell, eight rowers in kit, oars out to both sides, cox at the stern. */
export function rowingEight(): THREE.BufferGeometry {
  const B = new GeoBuilder();
  B.box(0, 0.12, 0, 0.62, 0.28, 17.5, "#f2efe6");
  B.cone(0, 0.12, 9.3, 0.31, 1.2, "#f2efe6", 4, Math.PI / 4);
  for (let k = 0; k < 8; k++) {
    const z = -6 + k * 1.45;
    B.box(0, 0.6, z, 0.45, 0.75, 0.35, "#1d3f8f"); // rower
    B.box(0, 1.08, z, 0.26, 0.26, 0.26, "#e2b48c"); // head
    const s = k % 2 ? 1 : -1;
    B.beam(0, 0.45, z, s * 3.6, 0.05, z - 0.4, 0.05, 0.05, "#d9d9d9"); // oar
    B.box(s * 3.6, 0.05, z - 0.4, 0.5, 0.04, 0.18, "#c8102e"); // blade
  }
  B.box(0, 0.5, -8, 0.4, 0.6, 0.4, "#f6d21b"); // cox
  return B.build();
}

/** Thames Clipper catamaran: twin navy hulls, white superstructure, red band, raked roof. */
export function clipper(): THREE.BufferGeometry {
  const B = new GeoBuilder();
  for (const sx of [-1, 1]) {
    B.box(sx * 2.6, 0.35, 0, 2.2, 1.3, 27, "#16213e");
    B.cone(sx * 2.6, 0.35, 14.3, 1.1, 1.8, "#16213e", 4, Math.PI / 4);
  }
  B.box(0, 1.6, -0.5, 7.6, 1.4, 21, "#f4f4f2");
  B.box(0, 1.7, -0.5, 7.7, 0.45, 21.1, "#c8102e");
  B.box(0, 2.0, 0.2, 7.2, 0.7, 19.5, "#2b3f5c"); // window band
  B.box(0, 2.6, -1.0, 7.0, 0.35, 19, "#e8e8e6");
  B.box(0, 3.2, 7.2, 3.0, 1.1, 2.6, "#2b3f5c"); // bridge
  return B.build();
}

/** A three-masted tall ship (barque): black hull with a white strake, square sails, bowsprit. */
export function tallShip(): THREE.BufferGeometry {
  const B = new GeoBuilder();
  B.box(0, 0.6, -1, 8.6, 4.2, 40, "#1c1c1f");
  B.cone(0, 0.6, 21.6, 4.3, 7, "#1c1c1f", 4, Math.PI / 4);
  B.box(0, 2.1, -1, 8.7, 0.6, 40.1, "#f1ece0");
  B.box(0, 2.85, -1, 8.2, 0.12, 40, "#9a7a52"); // deck
  B.box(0, 4.0, -18, 8.2, 2.4, 6, "#3b2a1f"); // poop deck house
  B.beam(0, 3.2, 21, 0, 6.5, 33, 0.35, 0.35, "#3b2a1f"); // bowsprit
  const masts: [number, number][] = [[11, 32], [0, 35], [-11, 29]];
  for (const [z, h] of masts) {
    B.cyl(0, 2.8 + h / 2, z, 0.25, 0.45, h, "#4a3526", 6);
    const yards = z < -5 ? 3 : 4;
    for (let k = 0; k < yards; k++) {
      const y = 9 + k * ((h - 9) / yards);
      const w = 15 - k * 2.6;
      B.box(0, y + 0.4, z, w, 0.22, 0.22, "#4a3526"); // yard
      B.box(0, y - 2.2, z + 0.35, w - 0.8, 4.6 - k * 0.4, 0.18, k === 0 ? "#efe7d2" : "#f6f0e1"); // square sail
    }
    B.box(0.35, 2.8 + h + 0.8, z, 0.7, 1.0, 0.05, "#c8102e"); // pennant
  }
  // jibs
  B.beam(0, 7, 23, 0, 24, 12, 0.12, 4.5, "#f6f0e1");
  // stays / rigging lines
  for (const [z, h] of masts) for (const sx of [-1, 1]) B.beam(sx * 4.2, 3, z - 3, 0, 2.8 + h * 0.85, z, 0.06, 0.06, "#2a2a2a");
  return B.build();
}
