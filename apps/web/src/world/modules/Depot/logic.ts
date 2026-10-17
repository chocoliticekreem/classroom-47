// Pure logic for the Depot: forklift shuttle cycles and the gate barrier.

export interface V2 {
  x: number;
  z: number;
}

export interface Leg {
  pts: V2[];
  cum: number[]; // cumulative length at each point
  length: number;
  reverse: boolean; // forklift drives backwards (heading opposite to travel)
  loaded: boolean;
  pause: number; // seconds to wait after the leg
  /** what happens during the pause: forks bump up by `bump` metres and the load toggles at the midpoint */
  bump: number;
  loadAfter: boolean; // loaded state after the pause
}

export interface ForkliftSample {
  x: number;
  z: number;
  heading: number; // rotation.y; forklift's local +z is its front (forks)
  loaded: boolean;
  lift: number; // fork carriage height above carry position
}

export interface ForkliftRoute {
  pick: V2; // where the load is picked up (forks pointing pickFace)
  pickFace: V2;
  drop: V2;
  dropFace: V2;
  mids: V2[]; // waypoints from pick side to drop side
  back?: number; // how far it reverses out
}

function mkLeg(pts: V2[], reverse: boolean, loaded: boolean, pause: number, bump: number, loadAfter: boolean): Leg {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  return { pts, cum, length: cum[cum.length - 1], reverse, loaded, pause, bump, loadAfter };
}

export function buildLegs(r: ForkliftRoute): Leg[] {
  const back = r.back ?? 2.5;
  const pickOut = { x: r.pick.x - r.pickFace.x * back, z: r.pick.z - r.pickFace.z * back };
  const dropOut = { x: r.drop.x - r.dropFace.x * back, z: r.drop.z - r.dropFace.z * back };
  return [
    mkLeg([r.pick, pickOut], true, true, 0.4, 0, true),
    mkLeg([pickOut, ...r.mids, dropOut, r.drop], false, true, 2.2, 1.0, false),
    mkLeg([r.drop, dropOut], true, false, 0.4, 0, false),
    mkLeg([dropOut, ...[...r.mids].reverse(), pickOut, r.pick], false, false, 2.6, 1.4, true),
  ];
}

export function cycleDuration(legs: Leg[], speed: number) {
  let t = 0;
  for (const l of legs) t += l.length / speed + l.pause;
  return t;
}

export function sampleForklift(legs: Leg[], speed: number, time: number, out: ForkliftSample): ForkliftSample {
  const total = cycleDuration(legs, speed);
  let t = ((time % total) + total) % total;
  for (const leg of legs) {
    const drive = leg.length / speed;
    if (t <= drive) {
      const d = t * speed;
      let i = 1;
      while (i < leg.pts.length - 1 && leg.cum[i] < d) i++;
      const a = leg.pts[i - 1];
      const b = leg.pts[i];
      const segLen = leg.cum[i] - leg.cum[i - 1] || 1;
      const u = Math.min(1, Math.max(0, (d - leg.cum[i - 1]) / segLen));
      out.x = a.x + (b.x - a.x) * u;
      out.z = a.z + (b.z - a.z) * u;
      out.heading = Math.atan2(b.x - a.x, b.z - a.z) + (leg.reverse ? Math.PI : 0);
      out.loaded = leg.loaded;
      out.lift = 0;
      return out;
    }
    t -= drive;
    if (t <= leg.pause) {
      const end = leg.pts[leg.pts.length - 1];
      const prev = leg.pts[leg.pts.length - 2];
      out.x = end.x;
      out.z = end.z;
      out.heading = Math.atan2(end.x - prev.x, end.z - prev.z) + (leg.reverse ? Math.PI : 0);
      const u = leg.pause > 0 ? t / leg.pause : 1;
      out.lift = leg.bump * Math.sin(Math.PI * u);
      out.loaded = u < 0.5 ? leg.loaded : leg.loadAfter;
      return out;
    }
    t -= leg.pause;
  }
  // numerical edge: end of cycle == start
  return sampleForklift(legs, speed, 0, out);
}

export function anyWithin(points: Iterable<V2>, x: number, z: number, r: number) {
  const r2 = r * r;
  for (const p of points) {
    const dx = p.x - x;
    const dz = p.z - z;
    if (dx * dx + dz * dz <= r2) return true;
  }
  return false;
}

/** Barrier openness 0 (down) .. 1 (up). Opens fast, closes slower. */
export function barrierStep(current: number, wantOpen: boolean, dt: number) {
  if (wantOpen) return Math.min(1, current + dt * 1.6);
  return Math.max(0, current - dt * 0.8);
}

/** 0 in daylight, 1 at night, ramps at dusk (17.5-19.5h) and dawn (5.5-7.5h). */
export function nightFactor(h: number) {
  if (h >= 7.5 && h <= 17.5) return 0;
  if (h > 17.5 && h < 19.5) return (h - 17.5) / 2;
  if (h > 5.5 && h < 7.5) return 1 - (h - 5.5) / 2;
  return 1;
}
