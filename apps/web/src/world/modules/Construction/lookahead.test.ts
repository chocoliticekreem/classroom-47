import { afterEach, describe, expect, it } from "vitest";
import { IDM } from "../Traffic/driving";
import { getEdge, lanePosition } from "../../roads";
import { obstacleAt, type ObstacleFn } from "../DeliveryFleet/lookahead";
import { MixerFleet } from "./mixers";
import { MIXER } from "./parts";
import { getSites } from "./sites";

let fleet: MixerFleet | null = null;
afterEach(() => {
  fleet?.stop();
  fleet = null;
});

describe("mixer look-ahead braking", () => {
  it("a mixer with an obstacle reported ahead decelerates to a stop short of it", () => {
    let current: ObstacleFn = () => null;
    const f = new MixerFleet(getSites(), { obstacleFn: (...a) => current(...a) });
    fleet = f;
    f.start();
    const dt = 0.05;
    let now = 0;
    const step = () => {
      now += dt * 1000;
      f.step(dt, now);
    };
    type M = ReturnType<MixerFleet["state"]>[number];
    let pick: M | null = null;
    for (let i = 0; i < 20 * 300 && !pick; i++) {
      step();
      pick =
        f.state().find((m) => {
          if (m.mode !== "drive" || m.speed < 4 || !m.from || !m.to || m.last) return false;
          const len = getEdge(m.from, m.to)?.length ?? 0;
          return (1 - m.t) * len > 50;
        }) ?? null;
    }
    expect(pick).not.toBeNull();
    const len = getEdge(pick!.from!, pick!.to!)!.length;
    const [ox, oz] = lanePosition(pick!.from!, pick!.to!, pick!.t + 35 / len);
    current = obstacleAt(pick!.id, ox, oz);
    const me = () => f.state().find((m) => m.id === pick!.id)!;
    let minDist = Infinity;
    let stoppedNear = false;
    for (let i = 0; i < 20 * 30 && !stoppedNear; i++) {
      step();
      const m = me();
      const d = Math.hypot(ox - m.x, oz - m.z);
      minDist = Math.min(minDist, d);
      if (m.speed < 0.05 && d < MIXER.half + 2.2 + IDM.s0 + 2) stoppedNear = true;
    }
    expect(stoppedNear).toBe(true);
    expect(minDist).toBeGreaterThan(MIXER.half + 2.2 + 0.3);
  });
});
