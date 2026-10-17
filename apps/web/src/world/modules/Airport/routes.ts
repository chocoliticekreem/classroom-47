// Flight path generator: every leg a plane flies or taxis, built as rounded polylines on the airport layout.
import {
  EMERGENCY_STOP_X,
  EMERGENCY_TOUCHDOWN_X,
  EXIT_X,
  HOLD,
  LINEUP_X,
  ROTATE_X,
  RWY,
  STAND_Z,
  TAXI,
  TOUCHDOWN_X,
  type CrashSite,
  type Stand,
} from "./layout";
import { Path, roundCorners, v3, type V3 } from "./path";

const Z = RWY.z;
const GROUND_R = 12;
const AIR_R = 140;

/** Where an arriving plane appears: far west, high, offset north or south of the extended centreline. */
export function approachEntry(rand: () => number): V3 {
  return v3(-1950, 150, Z + (rand() * 2 - 1) * 480);
}

/** Normal arrival: join the extended centreline, fly a ~6 degree glide slope, flare, touch down. */
export function approachPath(entry: V3): Path {
  return new Path(
    roundCorners(
      [entry, v3(-1380, 88, Z), v3(-1000, 60, Z), v3(-482, 6.5, Z), v3(-442, 1.6, Z), v3(TOUCHDOWN_X, 0, Z)],
      AIR_R,
      12,
    ),
  );
}

/** Distance along an approach at which the plane must have the runway, or go around. */
export function decisionDistance(p: Path) {
  return p.length - 330;
}

/** Emergency arrival: steeper and faster, crosses the threshold high and lands long. */
export function emergencyApproachPath(entry: V3): Path {
  return new Path(
    roundCorners(
      [entry, v3(-1250, 80, Z), v3(-760, 36, Z), v3(-430, 7, Z), v3(-392, 2.2, Z), v3(EMERGENCY_TOUCHDOWN_X, 0, Z)],
      AIR_R,
      12,
    ),
  );
}

export function emergencyRolloutPath(): Path {
  return new Path([v3(EMERGENCY_TOUCHDOWN_X, 0, Z), v3(EMERGENCY_STOP_X, 0, Z)]);
}

/** Touchdown -> decelerate along the runway -> turn off at the east exit, ending just off the runway. */
export function rolloutPath(): Path {
  return new Path(roundCorners([v3(TOUCHDOWN_X, 0, Z), v3(EXIT_X, 0, Z), v3(EXIT_X, 0, Z + RWY.halfW + 2)], 16));
}

/** From the runway exit, along the taxiway, into the stand nose-first (ends facing +z). */
export function taxiInPath(s: Stand): Path {
  const start = rolloutPath().end;
  return new Path(
    roundCorners([start, v3(EXIT_X, 0, TAXI.z), v3(s.x, 0, TAXI.z), v3(s.x, 0, STAND_Z)], GROUND_R),
  );
}

/** Pushback (the plane moves tail-first): back out to the taxiway, tail swinging east so it ends facing west. */
export function pushbackPath(s: Stand): Path {
  return new Path(roundCorners([v3(s.x, 0, STAND_Z), v3(s.x, 0, TAXI.z), v3(s.x + 16, 0, TAXI.z)], GROUND_R));
}

/** From the end of pushback, west along the taxiway to the holding point for runway 09. */
export function taxiOutPath(s: Stand): Path {
  const start = pushbackPath(s).end;
  return new Path(roundCorners([start, v3(HOLD.x, 0, TAXI.z), v3(HOLD.x, 0, HOLD.z)], GROUND_R));
}

export function lineupPath(): Path {
  return new Path(roundCorners([v3(HOLD.x, 0, HOLD.z), v3(HOLD.x, 0, Z), v3(LINEUP_X, 0, Z)], 8));
}

export function takeoffRollPath(): Path {
  return new Path([v3(LINEUP_X, 0, Z), v3(ROTATE_X, 0, Z)]);
}

const CLIMB_TAILS: V3[][] = [
  [v3(320, 95, -450), v3(1750, 210, -520)], // straight out east
  [v3(160, 85, -590), v3(1150, 200, -1400)], // north-east
  [v3(-60, 78, -600), v3(150, 190, -1750)], // left turn north
];

/** Lift-off at the rotate point, climb along the runway, then turn out and leave the map. */
export function climbPath(variant: number): Path {
  const tail = CLIMB_TAILS[((variant % CLIMB_TAILS.length) + CLIMB_TAILS.length) % CLIMB_TAILS.length];
  return new Path(
    roundCorners([v3(ROTATE_X, 0, Z), v3(-290, 4, Z), v3(-170, 22, Z), v3(-40, 46, Z - 30), ...tail], AIR_R, 12),
  );
}

/** Aborted approach: power up, climb straight ahead over the runway, then away to the north-east. */
export function goAroundPath(from: V3, dir: V3): Path {
  const h = Math.hypot(dir.x, dir.z) || 1;
  const a = v3(from.x + (dir.x / h) * 90, from.y + 10, from.z + (dir.z / h) * 90);
  const top = Math.max(from.y + 35, 70);
  return new Path(
    roundCorners([{ ...from }, a, v3(-260, top, Z), v3(80, top + 30, -640), v3(1250, 210, -1500)], AIR_R, 12),
  );
}

/** Power loss: carry on briefly, then sag and come down at the crash site. */
export function crashPath(from: V3, dir: V3, site: CrashSite): Path {
  const h = Math.hypot(dir.x, dir.z) || 1;
  const ux = dir.x / h;
  const uz = dir.z / h;
  const a = v3(from.x + ux * 70, Math.max(from.y - 2, 1), from.z + uz * 70);
  const mx = (a.x + site.x) / 2;
  const mz = (a.z + site.z) / 2;
  const m = v3(mx, Math.max(a.y * 0.55, 6), mz);
  const fx = site.x - mx;
  const fz = site.z - mz;
  const fl = Math.hypot(fx, fz) || 1;
  const short = v3(site.x - (fx / fl) * 35, 6, site.z - (fz / fl) * 35);
  return new Path(roundCorners([{ ...from }, a, m, short, v3(site.x, 0, site.z)], 90, 12));
}

/** Tow a stopped plane nose-first from the runway to its stand. */
export function towPath(s: Stand): Path {
  return new Path(
    roundCorners(
      [v3(EMERGENCY_STOP_X, 0, Z), v3(EXIT_X, 0, Z), v3(EXIT_X, 0, TAXI.z), v3(s.x, 0, TAXI.z), v3(s.x, 0, STAND_Z)],
      GROUND_R,
    ),
  );
}

/**
 * A dedicated doomed jet: it appears ~480 m out on the airport side of the target at 150 m, already in trouble,
 * and sags in a banking curve into the impact point over ~9 s at 50-60 m/s.
 */
export function doomedPath(site: CrashSite): Path {
  let dx = site.x - -350;
  let dz = site.z - -400;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  const px = -dz;
  const pz = dx;
  const L = 480;
  const at = (k: number, side: number, y: number) => v3(site.x - dx * L * k + px * side, y, site.z - dz * L * k + pz * side);
  return new Path(roundCorners([at(1, 70, 150), at(0.62, 60, 124), at(0.3, -12, 72), at(0.09, -4, 16), v3(site.x, 0, site.z)], 90, 14));
}
