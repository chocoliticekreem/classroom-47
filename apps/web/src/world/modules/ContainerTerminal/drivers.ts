// Driver styles for the container lorries: calm, normal and maniac. Pure decisions: desired speed with
// corner look-ahead, car following, traffic lights, overtaking, and the risk of tipping a box over in a bend.
import type { SignalColour } from "../../signals";
import type { Route } from "./route";

export type StyleName = "calm" | "normal" | "maniac";

export interface DriverStyle {
  name: StyleName;
  speedMul: number; // x the road's limit
  latAccel: number; // lateral acceleration they plan corners for (m/s²)
  accel: number;
  brake: number; // comfortable braking (m/s²)
  headway: number; // s
  amberRun: number; // probability of going through on amber when they could stop
  redRun: number; // probability of running a red
  overtakes: boolean;
  swerve: number; // lane wobble amplitude (m)
}

export const STYLES: Record<StyleName, DriverStyle> = {
  calm: { name: "calm", speedMul: 0.9, latAccel: 1.8, accel: 1.1, brake: 2.2, headway: 1.8, amberRun: 0, redRun: 0, overtakes: false, swerve: 0 },
  normal: { name: "normal", speedMul: 1.0, latAccel: 2.3, accel: 1.4, brake: 2.6, headway: 1.4, amberRun: 0.25, redRun: 0, overtakes: false, swerve: 0.05 },
  maniac: { name: "maniac", speedMul: 1.5, latAccel: 5.2, accel: 2.4, brake: 4.2, headway: 0.6, amberRun: 1, redRun: 0.5, overtakes: true, swerve: 0.4 },
};

/** Roughly a third of drivers are maniacs. */
export function pickStyle(rand: () => number): StyleName {
  const p = rand();
  return p < 0.36 ? "maniac" : p < 0.82 ? "normal" : "calm";
}

/** Inside the terminal everyone crawls (yard speed limit). */
export const YARD_SPEED = 7.5;

export const MAX_BRAKE = 8;

/** IDM acceleration for speed v towards v0 with a bumper gap `gap` closing at `closing` m/s. */
export function idmAccel(v: number, v0: number, gap: number, closing: number, st: DriverStyle): number {
  const ratio = v / Math.max(v0, 0.1);
  let a = st.accel * Math.max(1 - ratio ** 4, -1.2);
  if (Number.isFinite(gap)) {
    const s0 = 2.2;
    const sStar = s0 + Math.max(0, v * st.headway + (v * closing) / (2 * Math.sqrt(st.accel * st.brake)));
    a -= st.accel * (sStar / Math.max(gap, 0.05)) ** 2;
  }
  return Math.min(st.accel, Math.max(-MAX_BRAKE, a));
}

/**
 * Highest speed allowed now so the rig can make every bend in the next stretch at the driver's planned
 * lateral acceleration (braking at their comfortable rate).
 */
export function cornerLimit(r: Route, s: number, v: number, st: DriverStyle, startIdx: number): number {
  const look = (v * v) / (2 * st.brake) + 12;
  let lim = Infinity;
  for (let i = Math.max(1, startIdx); i < r.cum.length - 1; i++) {
    const d = r.cum[i] - s;
    if (d < -1) continue;
    if (d > look) break;
    const k = Math.abs(r.kappa[i]);
    if (k < 1e-3) continue;
    const vc = Math.sqrt(st.latAccel / k);
    // plan with gentle braking (the controller can brake harder, so it stays on the profile)
    const allowed = Math.sqrt(vc * vc + 2 * st.brake * 0.6 * Math.max(0, d));
    if (allowed < lim) lim = allowed;
  }
  return lim;
}

export type LightDecision = "go" | "stop";

/**
 * What a driver does approaching a light `dist` metres from the stop line at speed v.
 * `roll` is one random number per approach (so the decision is stable frame to frame).
 */
export function lightDecision(colour: SignalColour, dist: number, v: number, st: DriverStyle, roll: number): LightDecision {
  if (colour === "green") return "go";
  const canStop = (v * v) / (2 * MAX_BRAKE * 0.8) < dist;
  if (colour === "amber") {
    if (!canStop) return "go";
    return roll < st.amberRun ? "go" : "stop";
  }
  // red
  if (dist < 1.5 && v > 3) return "go"; // already in the box
  return roll < st.redRun ? "go" : "stop";
}

/** A maniac pulls out to overtake when a slower vehicle is close ahead and the road ahead is straight and long. */
export function wantsOvertake(
  st: DriverStyle,
  leaderGap: number,
  leaderSpeed: number,
  desired: number,
  straightAhead: number,
  publicRoad: boolean,
): boolean {
  if (!st.overtakes || !publicRoad) return false;
  if (leaderGap > 32 || leaderGap < 3) return false;
  if (leaderSpeed > desired - 2) return false;
  return straightAhead > 70;
}

/** Distance from s to the next real bend (|kappa| > 0.02) on the route, capped at the route end. */
export function straightAhead(r: Route, s: number, startIdx: number) {
  for (let i = Math.max(1, startIdx); i < r.cum.length - 1; i++) {
    if (r.cum[i] < s) continue;
    if (Math.abs(r.kappa[i]) > 0.02) return r.cum[i] - s;
  }
  return r.length - s;
}

/** Lateral acceleration above which a loaded box lorry starts to lift its inside wheels. */
export const TIP_LAT = 4.3;
/** Per-second hazard of rolling over while cornering at `lat` m/s² (maniacs only; others never push it). */
export function tipHazard(lat: number, st: DriverStyle): number {
  if (st.name !== "maniac") return 0;
  const over = Math.abs(lat) - TIP_LAT;
  return over > 0 ? Math.min(0.6, over * 0.11) : 0;
}

/** Container sway (roll, radians) the box shows for a lateral acceleration, + = leaning right. */
export function swayFor(lat: number) {
  return Math.max(-0.11, Math.min(0.11, lat * 0.017));
}
