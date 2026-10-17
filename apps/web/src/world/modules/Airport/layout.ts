// London Hamyway City Airport: every coordinate in one place (pure data, no three.js).
// Runway 09/27 runs along x at the north of the zone. Landings and take-offs use runway 09 (eastbound):
// arrivals come in low from the far west, departures climb out east/north-east over the suburbs.
// Ground layout, north (-z) to south (+z): runway, taxiway, apron with stands, terminal + cargo sheds,
// service road, car park / fuel farm. Fire station and control tower sit at the west end.
import { edgeKey } from "../../roads";

export const RWY = { z: -412, x0: -436, x1: -252, halfW: 11 } as const; // x0 = threshold 09 (west end)
export const RWY_LEN = RWY.x1 - RWY.x0;
export const TOUCHDOWN_X = -412; // normal touchdown point (aiming point ~24 m past the threshold)
export const EMERGENCY_TOUCHDOWN_X = -362; // lands long and hard
export const EMERGENCY_STOP_X = -300;

export const TAXI = { z: -386, x0: -432, x1: -262, halfW: 5 } as const;
export const EXIT_X = -266; // high-speed exit at the east end (runway -> taxiway)
export const HOLD = { x: -430, z: -395 } as const; // holding point for runway 09, west end
export const LINEUP_X = -424; // where departures start their roll
export const ROTATE_X = -336; // lift-off point

export const APRON = { minX: -426, maxX: -302, minZ: -375, maxZ: -326 } as const;
export const STAND_Z = -348; // planes park nose-south (facing +z) with their origin here
export const STAND_ENTRY_Z = TAXI.z; // stand lead-in leaves the taxiway centreline here

export interface Stand {
  id: string;
  x: number;
  cargo: boolean;
  bridge: boolean;
}
export const STANDS: readonly Stand[] = [
  { id: "A1", x: -410, cargo: false, bridge: true },
  { id: "A2", x: -384, cargo: false, bridge: true },
  { id: "A3", x: -358, cargo: false, bridge: true },
  { id: "C1", x: -328, cargo: true, bridge: false },
];
export const standById = (id: string) => STANDS.find((s) => s.id === id)!;

// Buildings (centres/extents)
export const TERMINAL = { minX: -424, maxX: -346, frontZ: -322, backZ: -300, bulge: 4, height: 8 } as const;
export const CARGO_SHED = { minX: -298, maxX: -271, minZ: -368, maxZ: -340, height: 10 } as const;
export const TOWER = { x: -443, z: -362, height: 25 } as const;
export const FIRE_STATION = { minX: -458, maxX: -432, minZ: -334, maxZ: -312 } as const;
export const FUEL_FARM = { x: -442, z: -272 } as const;
export const CAR_PARK = { minX: -420, maxX: -346, minZ: -286, maxZ: -262 } as const;
export const SERVICE_ROAD_Z = -292; // landside road from the fire station to the terminal node
export const WINDSOCK = { x: -262, z: -432 } as const;
export const APPROACH_LIGHTS = { x0: -441, spacing: 3, bars: 6, perBar: 5 } as const;

// Emergency crew homes (in front of the fire station, facing the airfield = -z).
export const CREW_HOMES = [
  { x: -452, z: -340, yaw: Math.PI },
  { x: -444, z: -340, yaw: Math.PI },
  { x: -436, z: -340, yaw: Math.PI },
] as const;

/** Airside crews leave the station west-about and drive the grass strip north of the runway. */
export const CREW_WEST_X = -458.5;
export const CREW_NORTH_Z = -431;
/** Where the emergency crews wait beside the runway while the plane lands (north side). */
export const RUNWAY_STANDBY = [
  { x: -352, z: -429 },
  { x: -334, z: -429 },
  { x: -316, z: -432 },
] as const;
/** Once the plane has stopped at EMERGENCY_STOP_X: tenders either side of the burning engine, ambulance by the crowd. */
export const RUNWAY_ATTACK = [
  { x: -318, z: -426 },
  { x: -280, z: -427 },
  { x: -292, z: -435 },
] as const;
/** Landside route to the road network. */
export const CREW_EAST_X = -428;

/** Where a crashing plane comes down. `a`/`b`: a road edge right beside it that is always closed (field sites). */
export interface CrashSite {
  x: number;
  z: number;
  kind: "city" | "field";
  where: string; // for the HUD note, e.g. "into downtown"
  a?: string;
  b?: string;
}

/** The rare alternative: just south of the airport, beside a road so traffic is hit. */
export const CRASH_SITES: readonly CrashSite[] = [
  { x: -243, z: -168, kind: "field", a: "h_0", b: "h_15", where: "near the A-Ring NW" },
  { x: -236, z: -250, kind: "field", a: "h_0", b: "airport_gate", where: "on the airport approach road" },
];
export const crashEdge = (s: CrashSite) => (s.a && s.b ? edgeKey(s.a, s.b) : null);

/** Radius of the destroyed area (buildings collapse, roads sealed off within DAMAGE_RADIUS + 10). */
export const DAMAGE_RADIUS = 28;

/** Downtown block centres the jet can hit (none of them is a reserved landmark cell). */
export const DOWNTOWN_TARGETS: readonly [number, number][] = [-100, -60, 60, 100].flatMap((x) =>
  [-100, -60, 60, 100].map((z) => [x, z] as [number, number]),
);

/** Built-up spots in the outer districts. */
export const DISTRICT_TARGETS: readonly CrashSite[] = [
  { x: -215, z: 318, kind: "city", where: "into Southbank" },
  { x: -330, z: 395, kind: "city", where: "into Southbank" },
  { x: -125, z: 395, kind: "city", where: "into Southbank" },
  { x: 222, z: -345, kind: "city", where: "into Shoreditch" },
  { x: 128, z: -385, kind: "city", where: "into Shoreditch" },
  { x: 250, z: -275, kind: "city", where: "into Shoreditch" },
  { x: -30, z: -290, kind: "city", where: "into the suburbs" },
  { x: 30, z: -290, kind: "city", where: "into the suburbs" },
];

/** 80 % into the city (mostly downtown), 20 % the old field crash south of the airport. */
export function pickCrashSite(rand: () => number): CrashSite {
  const r = rand();
  if (r < 0.2) return CRASH_SITES[Math.floor(rand() * CRASH_SITES.length)];
  if (r < 0.72) {
    const [x, z] = DOWNTOWN_TARGETS[Math.floor(rand() * DOWNTOWN_TARGETS.length)];
    return { x: x + (rand() - 0.5) * 8, z: z + (rand() - 0.5) * 8, kind: "city", where: "into downtown" };
  }
  return DISTRICT_TARGETS[Math.floor(rand() * DISTRICT_TARGETS.length)];
}

/** 0 in daylight, 1 at night; eases in 18:00-20:00 and out 05:00-07:00. */
export function nightFactor(hours: number): number {
  const h = ((hours % 24) + 24) % 24;
  const sm = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return h >= 12 ? sm(18, 20, h) : 1 - sm(5, 7, h);
}

/** The terminal's curved airside facade bulges north (toward the apron) in the middle. */
export function terminalFrontZ(x: number) {
  const t = (x - TERMINAL.minX) / (TERMINAL.maxX - TERMINAL.minX);
  return TERMINAL.frontZ - TERMINAL.bulge * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
}
