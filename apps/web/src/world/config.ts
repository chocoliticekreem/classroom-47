// World layout. Units are metres, y is up, the ground is y = 0.
// Every module places its content inside its own zone box so modules never overlap.

export const ROAD_WIDTH = 8; // two lanes, one each way
export const LANE_OFFSET = 2; // vehicles drive on the LEFT (UK): offset from the road centre line
export const BLOCK = 40; // distance between downtown intersections
export const GRID_HALF = 4; // downtown grid runs from -4..4 blocks => -160..160
export const HIGHWAY_RING = 220; // highway square ring at |x| = 220 or |z| = 220

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const ZONES = {
  // Downtown grid (roads every 40 m). Buildings fill the blocks between roads.
  downtown: { minX: -160, maxX: 160, minZ: -160, maxZ: 160 },
  // East: harbour with cranes, containers, a ship on the water past x = 330.
  docks: { minX: 240, maxX: 340, minZ: -80, maxZ: 80 },
  // West: farms, fields, trees, hills.
  countryside: { minX: -360, maxX: -240, minZ: -120, maxZ: 120 },
  // South: the delivery depot / warehouse with loading bays.
  depot: { minX: -60, maxX: 60, minZ: 240, maxZ: 330 },
  // North: suburb houses (delivery stops).
  suburbs: { minX: -80, maxX: 80, minZ: -340, maxZ: -240 },
  // North-west: the airport. Runway runs along x; terminal, cargo sheds, control tower.
  airport: { minX: -460, maxX: -250, minZ: -440, maxZ: -250 },

  // ---- Layer 2: the wider city (each owned by one district agent) ----
  // South-east coast: container terminal next to the docks (stacks, cranes, flatbed trucks).
  containerTerminal: { minX: 236, maxX: 335, minZ: 100, maxZ: 340 },
  // South-east: heavy industry (power station, chimneys, refinery). Smoke drifts over the city with WIND.
  industrial: { minX: 80, maxX: 335, minZ: 370, maxZ: 660 },
  // South-west: Southbank, mixed-use riverside-style district with organic streets.
  southbank: { minX: -440, maxX: -80, minZ: 250, maxZ: 620 },
  // West: Old Town, Georgian crescents, squares, a domed cathedral, market. Winding medieval lanes.
  oldTown: { minX: -800, maxX: -500, minZ: -240, maxZ: 280 },
  // North-east: Shoreditch, converted warehouses, railway arches, street art.
  shoreditch: { minX: 80, maxX: 335, minZ: -540, maxZ: -240 },
  // Far north, across the river: Hampstead, hilly villas, a heath, winding roads.
  hampstead: { minX: -620, maxX: 260, minZ: -960, maxZ: -700 },
  // Layer 3: the government quarter (White House-style residence, PM office, ministries) on the east side
  // between the ring and the coast road, north of the docks.
  government: { minX: 236, maxX: 330, minZ: -236, maxZ: -90 },
} satisfies Record<string, Box>;

export type ZoneName = keyof typeof ZONES;

export const WORLD_SIZE = 2200; // ground plane is WORLD_SIZE x WORLD_SIZE centred on 0 (Layer 2: was 800)
export const WATER_X = 340; // water (sea) starts east of this x

/** The river (Thames-like) runs west -> east across the north of the city into the sea. Polyline centre, width. */
export const RIVER = {
  width: 70,
  points: [
    [-1100, -560], [-800, -620], [-560, -580], [-300, -640], [-60, -600], [140, -660], [300, -620], [420, -620],
  ] as [number, number][],
};

/** Prevailing wind (m/s, x/z). Smoke, clouds, flags and birds drift with it: blows from the south-east over the city. */
export const WIND: [number, number] = [-2.2, -3.0];

/** Outer motorway (M-orbital): a C around the city, open to the sea in the east. Polyline corners. */
export const MOTORWAY = {
  points: [
    [300, -700], [-880, -700], [-880, 760], [300, 760],
  ] as [number, number][],
};

export function inBox(b: Box, x: number, z: number, margin = 0) {
  return x >= b.minX - margin && x <= b.maxX + margin && z >= b.minZ - margin && z <= b.maxZ + margin;
}
