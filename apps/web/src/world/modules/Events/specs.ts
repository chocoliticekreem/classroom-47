// Event vehicles as lists of coloured boxes, balls and lamps (local frame: front +z, ground y = 0).
// Drawn by VehicleRenderer as three instanced meshes in total, however many vehicles are out. Pure data.
import type { VehicleKind } from "../../registry";

export type Shape = "box" | "ball" | "lamp";
/** Lamp behaviour: blue strobes (two phases), steady head/tail, party colours, amber. */
export type LampMode = "blueA" | "blueB" | "red" | "head" | "tail" | "party" | "amber";

export interface Part {
  shape: Shape;
  p: [number, number, number];
  s: [number, number, number];
  c: string;
  lamp?: LampMode;
  phase?: number;
}

export interface VehicleSpec {
  name: string;
  kind: VehicleKind;
  half: number; // half length (physics footprint)
  halfWidth: number;
  parts: Part[];
}

const box = (p: Part["p"], s: Part["s"], c: string): Part => ({ shape: "box", p, s, c });
const ball = (p: Part["p"], s: Part["s"], c: string): Part => ({ shape: "ball", p, s, c });
const lamp = (p: Part["p"], s: Part["s"], mode: LampMode, phase = 0): Part => ({ shape: "lamp", p, s, c: "#ffffff", lamp: mode, phase });

const DARK = "#17171b";
const GLASS = "#1c2a38";
const BLACK = "#0d0d10";
const CHROME = "#b9bec4";
const WHITE = "#f4f4ee";
const POLICE_BLUE = "#173a9e";
const HI_VIS = "#e6f01e";
const NHS_GREEN = "#18a048";

function wheels(halfW: number, z: number, r: number, out: Part[]) {
  for (const x of [halfW, -halfW]) for (const zz of [z, -z]) out.push(box([x, r, zz], [0.26, r * 2, r * 2], DARK));
}

function lights(halfW: number, halfL: number, y: number, out: Part[], w = 0.36) {
  for (const x of [halfW * 0.65, -halfW * 0.65]) {
    out.push(lamp([x, y, halfL + 0.02], [w, 0.14, 0.05], "head"));
    out.push(lamp([x, y, -halfL - 0.02], [w, 0.14, 0.05], "tail"));
  }
}

/** Two-row blue/yellow chequer along both sides (Battenburg). */
function battenburg(halfW: number, y: number, rowH: number, z0: number, z1: number, cols: number, a: string, b: string, out: Part[]) {
  const cw = (z1 - z0) / cols;
  for (const side of [1, -1])
    for (let r = 0; r < 2; r++)
      for (let i = 0; i < cols; i++)
        out.push(box([side * (halfW + 0.012), y + (r - 0.5) * rowH, z0 + (i + 0.5) * cw], [0.02, rowH, cw], (i + r) % 2 === 0 ? a : b));
}

export function outrider(): VehicleSpec {
  const parts: Part[] = [
    box([0, 0.62, 0.05], [0.42, 0.42, 1.55], WHITE),
    box([0, 0.85, 0.62], [0.55, 0.45, 0.42], POLICE_BLUE), // fairing
    box([0, 0.34, 0.72], [0.12, 0.66, 0.66], DARK),
    box([0, 0.34, -0.72], [0.12, 0.66, 0.66], DARK),
    box([0, 0.85, -0.6], [0.6, 0.35, 0.5], WHITE), // panniers
    box([0, 1.32, -0.08], [0.5, 0.62, 0.32], HI_VIS), // rider
    box([0, 1.74, -0.04], [0.3, 0.3, 0.32], WHITE), // helmet
    box([0.17, 0.95, 0.05], [0.13, 0.5, 0.5], DARK), // legs
    box([-0.17, 0.95, 0.05], [0.13, 0.5, 0.5], DARK),
    lamp([0.16, 1.08, 0.86], [0.12, 0.1, 0.06], "blueA"),
    lamp([-0.16, 1.08, 0.86], [0.12, 0.1, 0.06], "blueB"),
    lamp([0, 1.15, -0.86], [0.2, 0.12, 0.06], "blueA", 0.5),
    lamp([0, 0.9, 0.85], [0.18, 0.12, 0.05], "head"),
  ];
  return { name: "outrider", kind: "police", half: 1.1, halfWidth: 0.45, parts };
}

export function policeCar(): VehicleSpec {
  const parts: Part[] = [
    box([0, 0.62, 0], [1.85, 0.72, 4.4], WHITE),
    box([0, 1.26, -0.25], [1.66, 0.56, 2.3], GLASS),
    box([0, 1.55, -0.25], [1.6, 0.04, 2.1], WHITE),
    lamp([-0.4, 1.62, -0.1], [0.66, 0.15, 0.34], "blueA"),
    lamp([0.4, 1.62, -0.1], [0.66, 0.15, 0.34], "blueB"),
  ];
  battenburg(0.925, 0.62, 0.3, -2.1, 2.1, 8, POLICE_BLUE, HI_VIS, parts);
  wheels(0.88, 1.38, 0.36, parts);
  lights(0.92, 2.2, 0.72, parts);
  return { name: "police car", kind: "police", half: 2.2, halfWidth: 0.95, parts };
}

export function suv(): VehicleSpec {
  const parts: Part[] = [
    box([0, 0.88, 0], [2.0, 1.0, 5.0], BLACK),
    box([0, 1.66, -0.35], [1.86, 0.62, 3.3], GLASS),
    box([0, 2.0, -0.35], [1.82, 0.07, 3.1], BLACK),
    box([0, 0.75, 2.52], [1.4, 0.4, 0.06], CHROME),
    lamp([0.35, 0.95, 2.53], [0.2, 0.08, 0.04], "blueA"),
    lamp([-0.35, 0.95, 2.53], [0.2, 0.08, 0.04], "blueB"),
  ];
  wheels(0.95, 1.6, 0.42, parts);
  lights(1.0, 2.5, 1.0, parts);
  return { name: "SUV", kind: "motorcade", half: 2.5, halfWidth: 1.0, parts };
}

/** The presidential limousine: long, black, flags on the front wings. */
export function limousine(): VehicleSpec {
  const parts: Part[] = [
    box([0, 0.82, 0], [2.04, 0.96, 6.3], BLACK),
    box([0, 1.56, -0.45], [1.86, 0.6, 3.5], GLASS),
    box([0, 1.88, -0.45], [1.82, 0.06, 3.3], BLACK),
    box([0, 0.72, 3.16], [1.5, 0.42, 0.06], CHROME),
    box([1.03, 0.85, 0], [0.02, 0.06, 6.0], CHROME),
    box([-1.03, 0.85, 0], [0.02, 0.06, 6.0], CHROME),
  ];
  for (const x of [0.86, -0.86]) {
    parts.push(box([x, 1.62, 2.75], [0.04, 0.72, 0.04], CHROME)); // flag staff
    parts.push(box([x, 1.82, 2.5], [0.025, 0.34, 0.48], "#c8102e")); // flag: red field
    parts.push(box([x, 1.88, 2.5], [0.03, 0.08, 0.48], "#ffffff")); // white stripe
    parts.push(box([x, 1.9, 2.62], [0.035, 0.16, 0.2], "#012169")); // blue canton
  }
  wheels(0.96, 2.15, 0.42, parts);
  lights(1.0, 3.15, 0.9, parts);
  parts.push(lamp([0.4, 0.62, 3.18], [0.16, 0.08, 0.04], "blueA"));
  parts.push(lamp([-0.4, 0.62, 3.18], [0.16, 0.08, 0.04], "blueB"));
  return { name: "presidential limousine", kind: "motorcade", half: 3.15, halfWidth: 1.02, parts };
}

export function ambulance(): VehicleSpec {
  const parts: Part[] = [
    box([0, 1.35, -0.35], [2.1, 2.1, 4.4], "#f2f2ea"),
    box([0, 0.9, 2.2], [2.0, 1.2, 1.0], "#f2f2ea"),
    box([0, 1.72, 1.78], [1.86, 0.55, 0.12], GLASS),
    lamp([0.7, 2.47, 1.7], [0.4, 0.14, 0.24], "blueA"),
    lamp([-0.7, 2.47, 1.7], [0.4, 0.14, 0.24], "blueB"),
    lamp([0.8, 2.47, -2.5], [0.3, 0.14, 0.2], "blueB"),
    lamp([-0.8, 2.47, -2.5], [0.3, 0.14, 0.2], "blueA"),
  ];
  battenburg(1.05, 1.0, 0.36, -2.5, 1.8, 8, NHS_GREEN, HI_VIS, parts);
  wheels(0.95, 1.7, 0.42, parts);
  lights(1.0, 2.72, 0.9, parts);
  return { name: "ambulance", kind: "motorcade", half: 2.8, halfWidth: 1.05, parts };
}

/** The sweeper: a dark unmarked saloon at the back, one blue lamp on the dash. */
export function sweeper(): VehicleSpec {
  const parts: Part[] = [
    box([0, 0.6, 0], [1.86, 0.62, 4.6], "#2b2f36"),
    box([0, 1.14, -0.2], [1.62, 0.5, 2.3], GLASS),
    box([0, 1.4, -0.2], [1.58, 0.05, 2.1], "#2b2f36"),
    lamp([0.3, 1.0, 0.95], [0.22, 0.12, 0.08], "blueA"),
    lamp([-0.3, 1.0, 0.95], [0.22, 0.12, 0.08], "blueB"),
  ];
  wheels(0.88, 1.5, 0.36, parts);
  lights(0.93, 2.3, 0.7, parts);
  return { name: "sweeper", kind: "police", half: 2.3, halfWidth: 0.95, parts };
}

export function blackCab(): VehicleSpec {
  const parts: Part[] = [
    box([0, 0.78, 0], [1.8, 0.92, 4.4], "#141414"),
    box([0, 1.5, -0.2], [1.7, 0.6, 2.5], GLASS),
    box([0, 1.82, -0.2], [1.66, 0.06, 2.4], "#141414"),
    lamp([0, 1.94, 0.6], [0.5, 0.16, 0.2], "amber"),
  ];
  wheels(0.86, 1.45, 0.38, parts);
  lights(0.9, 2.22, 0.8, parts);
  return { name: "black cab", kind: "taxi", half: 2.25, halfWidth: 0.92, parts };
}

export function redBus(): VehicleSpec {
  const parts: Part[] = [
    box([0, 2.25, 0], [2.5, 4.0, 10.4], "#d42a1e"),
    box([0, 1.85, 0.1], [2.53, 0.8, 9.6], GLASS),
    box([0, 3.45, 0], [2.53, 0.8, 10.0], GLASS),
    box([0, 4.28, 0], [2.4, 0.06, 10.2], "#b0221a"),
    box([0, 3.0, 5.21], [2.0, 0.35, 0.04], "#111"), // destination blind
  ];
  wheels(1.15, 3.6, 0.5, parts);
  lights(1.25, 5.21, 0.8, parts);
  return { name: "bus", kind: "bus", half: 5.3, halfWidth: 1.3, parts };
}

const FLOAT_THEMES = [
  { base: "#ff6a1a", deco: ["#ffd60a", "#ffffff"], label: "Hamyway" },
  { base: "#3a86ff", deco: ["#ff006e", "#ffd60a"], label: "Samba" },
  { base: "#06d6a0", deco: ["#f72585", "#ffffff"], label: "Steel band" },
  { base: "#8338ec", deco: ["#ffbe0b", "#3a86ff"], label: "Dragon" },
  { base: "#ff006e", deco: ["#ffffff", "#06d6a0"], label: "Mardi gras" },
];

/** A carnival float: tractor unit + decorated flatbed, a rim of party lights and a sound tower. */
export function carnivalFloat(i: number): VehicleSpec {
  const th = FLOAT_THEMES[i % FLOAT_THEMES.length];
  const parts: Part[] = [
    box([0, 1.1, 4.6], [2.1, 1.6, 1.8], th.deco[1] === "#ffffff" ? "#2a2a2a" : WHITE), // tractor cab
    box([0, 1.55, 5.0], [1.9, 0.5, 0.1], GLASS),
    box([0, 0.75, -0.6], [3.3, 0.7, 8.6], th.base), // flatbed + skirt
    box([0, 1.12, -0.6], [3.4, 0.06, 8.8], th.deco[0]), // deck trim
  ];
  const variant = i % 3;
  if (variant === 0) {
    parts.push(ball([0, 2.8, -1.0], [2.8, 2.8, 2.8], th.deco[0]));
    parts.push(ball([0, 4.5, -1.0], [1.2, 1.2, 1.2], th.deco[1]));
  } else if (variant === 1) {
    for (const x of [1.3, -1.3]) parts.push(box([x, 2.6, -0.6], [0.3, 3.0, 0.3], th.deco[1]));
    parts.push(box([0, 4.1, -0.6], [3.0, 0.5, 0.5], th.deco[0])); // arch
    parts.push(ball([0, 2.2, -2.8], [1.6, 1.6, 1.6], th.deco[0]));
  } else {
    parts.push(box([0, 1.9, -2.2], [2.4, 1.4, 2.6], th.deco[0]));
    parts.push(ball([0, 3.1, -2.2], [1.5, 1.5, 1.5], th.deco[1]));
    parts.push(box([0, 2.3, 1.6], [0.9, 2.2, 0.9], th.deco[1])); // dragon neck
    parts.push(ball([0, 3.6, 2.0], [1.2, 0.9, 1.5], th.deco[0]));
  }
  // sound tower (speakers) at the back
  parts.push(box([0, 2.0, -4.4], [2.2, 1.7, 0.8], "#111"));
  for (const x of [0.55, -0.55]) parts.push(ball([x, 2.0, -4.0], [0.6, 0.6, 0.1], "#444"));
  // rim of party lights
  for (let k = 0; k < 9; k++) {
    const z = 3.6 - k * 1.05;
    parts.push(lamp([1.72, 1.2, z], [0.12, 0.18, 0.18], "party", k * 0.11));
    parts.push(lamp([-1.72, 1.2, z], [0.12, 0.18, 0.18], "party", k * 0.11 + 0.5));
  }
  for (let k = 0; k < 5; k++) parts.push(lamp([-1.0 + k * 0.5, 2.95, -4.4], [0.3, 0.14, 0.3], "party", k * 0.2));
  wheels(1.0, 3.6, 0.45, parts);
  return { name: `${th.label} float`, kind: "motorcade", half: 5.4, halfWidth: 1.75, parts };
}
