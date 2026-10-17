import { describe, expect, it } from "vitest";
import {
  actorPose,
  participants,
  PILEUP_MAX,
  PILEUP_MIN,
  planJackknife,
  planJunction,
  planPileup,
  planRollover,
  planSecondary,
  planShunt,
  planSideswipe,
  type ActorPose,
  type Choreo,
  type PileupInput,
} from "./choreo";

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const ids = () => {
  let n = 0;
  return () => `W-${++n}`;
};
const colors = ["#f00", "#0f0", "#00f"];
const input = (seed: number, extra: Partial<PileupInput> = {}): PileupInput => ({
  rand: seeded(seed),
  highway: true,
  room: 100,
  same: [],
  opp: [],
  ids: ids(),
  colors,
  ...extra,
});

const sortedOk = (c: Choreo) => c.impacts.every((im, i) => i === 0 || im.at >= c.impacts[i - 1].at);

describe("planPileup", () => {
  it("always involves 6..13 vehicles, impacts in time order over ~3-4 s", () => {
    for (let seed = 1; seed < 60; seed++) {
      const c = planPileup(input(seed));
      const n = participants(c);
      expect(n).toBeGreaterThanOrEqual(PILEUP_MIN);
      expect(n).toBeLessThanOrEqual(PILEUP_MAX);
      expect(sortedOk(c)).toBe(true);
      expect(c.impacts[0].at).toBe(0);
      expect(c.duration).toBeGreaterThan(2.2);
      expect(c.duration).toBeLessThan(4.6);
      // successive impacts are staggered, not simultaneous
      for (let i = 1; i < c.impacts.length; i++) if (!c.impacts[i].crossover && !c.impacts[i - 1].crossover)
        expect(c.impacts[i].at - c.impacts[i - 1].at).toBeGreaterThanOrEqual(0.079);
    }
  });

  it("has the set pieces: one jackknifed HGV, one flip onto the roof, one on the kerb, something on fire", () => {
    for (let seed = 1; seed < 40; seed++) {
      const c = planPileup(input(seed));
      expect(c.actors.filter((a) => a.role === "jackknife" && a.model === "hgv")).toHaveLength(1);
      const flips = c.actors.filter((a) => a.role === "flip");
      expect(flips).toHaveLength(1);
      expect(Math.abs(flips[0].flip / Math.PI) % 2).toBeCloseTo(1); // odd multiple of PI: ends on its roof
      expect(c.actors.filter((a) => a.role === "barrier")).toHaveLength(1);
      expect(c.actors.some((a) => a.fire)).toBe(true);
      expect(c.actors.filter((a) => a.role === "lead")).toHaveLength(1);
    }
  });

  it("hits real vehicles nearest the head first and keeps scripted wrecks off them", () => {
    const same = [
      { id: "r3", z: -30, kind: "car" as const },
      { id: "r1", z: -2, kind: "car" as const },
      { id: "r2", z: -14, kind: "van" as const },
    ];
    const c = planPileup(input(7, { same }));
    const realOrder = c.impacts.filter((i) => i.vehicleId && !i.crossover).map((i) => i.vehicleId);
    expect(realOrder).toEqual(["r1", "r2", "r3"]);
    expect(c.impacts[0].vehicleId).toBe("r1"); // a real car near the head is the lead
    for (const a of c.actors) for (const r of same) expect(Math.abs(a.contact.z - r.z)).toBeGreaterThan(3);
    // the lead is a real car, so no scripted lead
    expect(c.actors.some((a) => a.role === "lead")).toBe(false);
  });

  it("orders everyone by distance from the head (concertina)", () => {
    const c = planPileup(input(3));
    const scripted = c.impacts.filter((i) => i.actor >= 0).map((i) => c.actors[i.actor].contact.z);
    for (let i = 1; i < scripted.length; i++) expect(scripted[i]).toBeLessThan(scripted[i - 1]);
  });

  it("scripted cars never start before the start of the road run", () => {
    for (let seed = 1; seed < 30; seed++) {
      const c = planPileup(input(seed, { room: 60, highway: false }));
      for (const a of c.actors) expect(a.contact.z - a.speed * (a.impactAt + 0.15)).toBeGreaterThan(-60 - 15 - 1e-6 - (a.speed === 4 ? 100 : 0));
    }
  });

  it("adds a cross-over from the opposite lane mid-sequence", () => {
    const c = planPileup(input(5, { opp: [{ id: "o1", z: 6, kind: "car" }] }));
    const x = c.impacts.find((i) => i.crossover)!;
    expect(x.vehicleId).toBe("o1");
    expect(x.at).toBeGreaterThan(0.5);
    expect(x.at).toBeLessThan(c.duration);
  });

  it("caps the number of real vehicles so the set pieces still happen", () => {
    const same = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, z: -i * 5, kind: "car" as const }));
    const c = planPileup(input(9, { same }));
    expect(participants(c)).toBeLessThanOrEqual(PILEUP_MAX);
    expect(c.actors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("planSecondary", () => {
  it("only fast vehicles in range, at most two, arriving after the start", () => {
    const list = [
      { id: "slow", behind: 20, speed: 4 },
      { id: "far", behind: 200, speed: 20 },
      { id: "a", behind: 15, speed: 20 },
      { id: "b", behind: 30, speed: 20 },
      { id: "c", behind: 40, speed: 20 },
    ];
    const out = planSecondary(list, 2, () => 0, 0.3);
    expect(out.map((i) => i.vehicleId)).toEqual(["a", "b"]);
    for (const i of out) expect(i.at).toBeGreaterThan(2);
    expect(planSecondary(list, 0, () => 0.99, 0.3)).toHaveLength(0);
  });
});

describe("ordinary scripted crashes", () => {
  const s = () => ({ rand: seeded(4), ids: ids(), colors });
  it("each plan has sorted impacts that reference real actors", () => {
    for (const c of [planJunction(s(), 1), planJunction(s(), -1), planShunt(s()), planSideswipe(s()), planRollover(s()), planJackknife(s())]) {
      expect(sortedOk(c)).toBe(true);
      expect(c.impacts.length).toBeGreaterThan(0);
      for (const im of c.impacts) expect(c.actors[im.actor]).toBeDefined();
    }
  });

  it("the red-light runner arrives side-on to the victim", () => {
    const c = planJunction(s(), 1);
    const runner = c.actors.find((a) => a.role === "runner")!;
    expect(Math.abs(Math.abs(runner.contact.yaw) - Math.PI / 2)).toBeLessThan(0.01);
    expect(runner.contact.x).toBeGreaterThan(2);
  });

  it("the shunted car is pushed forward a few metres", () => {
    const c = planShunt(s());
    const a = c.actors.find((x) => x.role === "shunted")!;
    expect(a.rest.z - a.contact.z).toBeGreaterThanOrEqual(3);
  });
});

describe("actorPose", () => {
  const out: ActorPose = { x: 0, y: 0, z: 0, yaw: 0, roll: 0, fold: 0, moving: false };
  it("approaches along its heading, then settles at rest (rollover ends on its roof)", () => {
    const c = planRollover({ rand: seeded(2), ids: ids(), colors });
    const a = c.actors[0];
    actorPose(a, 0, out);
    expect(out.z).toBeLessThan(a.contact.z - 10);
    actorPose(a, a.impactAt + a.postDur / 2, out);
    expect(out.y).toBeGreaterThan(1);
    actorPose(a, a.impactAt + a.postDur + 1, out);
    expect(out.x).toBeCloseTo(a.rest.x);
    expect(out.z).toBeCloseTo(a.rest.z);
    expect(Math.cos(out.roll)).toBeCloseTo(-1); // upside down
    expect(out.y).toBeCloseTo(0);
    expect(out.moving).toBe(false);
  });
});
