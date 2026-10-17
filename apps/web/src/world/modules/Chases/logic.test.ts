import { describe, expect, it } from "vitest";
import { edgeKey, getNode, neighbours } from "../../roads";
import {
  CHASE,
  isReckless,
  pitAllowed,
  boxSlots,
  cameraSites,
  chooseTurn,
  escapeNode,
  newChase,
  pursuitTarget,
  raceStrip,
  racerLaunch,
  rollEnding,
  speedingHit,
  stepChase,
  straightAhead,
  turnKind,
  type ChaseInput,
  type ChaseState,
} from "./logic";

const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

const calm: ChaseInput = { gap: 200, pit: false, collided: false, settled: false, onMotorway: false, allHome: false };

function run(s: ChaseState, input: ChaseInput, seconds: number, dt = 0.1) {
  const actions: string[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const a = stepChase(s, input, dt);
    if (a) actions.push(a);
  }
  return actions;
}

describe("rollEnding", () => {
  it("splits the roll into PIT, crash and escape", () => {
    expect(rollEnding(0.1)).toBe("pit");
    expect(rollEnding(0.5)).toBe("crash");
    expect(rollEnding(0.9)).toBe("escape");
  });
});

describe("stepChase", () => {
  it("PIT: only once allowed and a contact lands, then spin, settle, arrest, leave", () => {
    const s = newChase("pit", () => 0);
    expect(pitAllowed(s)).toBe(false);
    expect(run(s, { ...calm, pit: true }, s.minFleeS - 1)).toEqual([]); // too early
    run(s, calm, 1.2);
    expect(pitAllowed(s)).toBe(true);
    expect(stepChase(s, { ...calm, pit: true }, 0.1)).toBe("spin");
    expect(s.phase).toBe("pit");
    expect(run(s, calm, CHASE.spinMinS + 0.5)).toEqual([]); // still sliding
    expect(stepChase(s, { ...calm, settled: true }, 0.1)).toBe("start_arrest");
    expect(run(s, calm, CHASE.arrestS + 0.2)).toEqual(["release"]);
    expect(s.phase).toBe("leaving");
    expect(stepChase(s, { ...calm, allHome: true }, 0.1)).toBe("finish");
    expect(s.phase).toBe("done");
  });

  it("a spin that never settles still moves on to the arrest", () => {
    const s = newChase("pit", () => 0);
    s.phase = "pit";
    expect(run(s, calm, CHASE.spinMaxS + 0.2)).toEqual(["start_arrest"]);
  });

  it("PIT contacts are ignored in crash and escape chases", () => {
    const s = newChase("escape", () => 0);
    expect(run(s, { ...calm, pit: true }, s.minFleeS + 2)).toEqual([]);
  });

  it("a real collision ends any chase in a crash", () => {
    for (const ending of ["pit", "crash", "escape"] as const) {
      const s = newChase(ending, () => 0);
      run(s, calm, 3);
      expect(stepChase(s, { ...calm, collided: true }, 0.1)).toBe("crash");
      expect(s.phase).toBe("crashed");
      expect(s.ending).toBe("crash");
    }
  });

  it("crash: reckless after the minimum flee time, lamppost fallback after the grace period", () => {
    const s = newChase("crash", () => 0);
    run(s, calm, s.minFleeS - 0.5);
    expect(isReckless(s)).toBe(false);
    run(s, calm, 1);
    expect(isReckless(s)).toBe(true);
    expect(run(s, calm, CHASE.crashGraceS + 0.5)).toEqual(["crash"]);
    expect(run(s, { ...calm, settled: true }, CHASE.spinMinS + 0.2)).toEqual(["start_arrest"]);
  });

  it("escape: police give up once the getaway is on the motorway and pulling away", () => {
    const s = newChase("escape", () => 0);
    expect(run(s, { ...calm, gap: 200 }, s.minFleeS + 1)).toEqual([]); // not on the motorway yet
    expect(stepChase(s, { ...calm, gap: 120, onMotorway: true }, 0.1)).toBe("give_up");
    expect(run(s, calm, CHASE.giveUpS + 0.2)).toEqual(["release"]);
  });

  it("escape also triggers after a while on the motorway even with police close", () => {
    const s = newChase("escape", () => 0);
    run(s, calm, s.minFleeS);
    const acts = run(s, { ...calm, gap: 20, onMotorway: true }, CHASE.escapeMotorwayS + 0.3);
    expect(acts).toEqual(["give_up"]);
  });

  it("a PIT that never lands turns into a crash at the time limit", () => {
    const s = newChase("pit", () => 0);
    const acts = run(s, calm, CHASE.maxFleeS + 0.5);
    expect(acts).toEqual(["crash"]);
    expect(s.ending).toBe("crash");
  });

  it("an escape that never reaches the motorway ends with the police losing them", () => {
    const s = newChase("escape", () => 0);
    expect(run(s, calm, CHASE.maxFleeS + 0.5)).toEqual(["give_up"]);
  });

  it("leaving times out even if something never gets home", () => {
    const s = newChase("crash", () => 0);
    s.phase = "leaving";
    s.phaseT = 0;
    expect(run(s, calm, CHASE.leaveTimeoutS + 0.5)).toEqual(["finish"]);
  });
});

describe("pursuitTarget", () => {
  const g = { from: "g_0_0", to: "g_1_0", path: ["g_-1_0", "g_0_0", "g_1_0", "g_2_0", "g_3_0"], idx: 1 };

  it("unit 0 tails the getaway's current target node", () => {
    expect(pursuitTarget(0, g, "g_0_1")).toBe("g_1_0");
    expect(pursuitTarget(0, g, "g_0_1", "g_3_0")).toBe("g_1_0"); // ignores the prediction
  });

  it("the other units aim at the predicted node to cut it off", () => {
    expect(pursuitTarget(1, g, "g_0_1", "g_3_0")).toBe("g_3_0");
    expect(pursuitTarget(2, g, "g_0_1", "g_2_0")).toBe("g_2_0");
    expect(pursuitTarget(1, g, "g_0_1")).toBe("g_3_0"); // no prediction: two nodes on
    expect(pursuitTarget(1, g, "g_0_1", "g_9_9")).toBe("g_3_0"); // prediction off the route: ignored
  });

  it("never returns the node the police car is already heading to", () => {
    expect(pursuitTarget(0, g, "g_1_0")).toBe("g_2_0");
    expect(pursuitTarget(1, g, "g_3_0", "g_3_0")).toBe("g_2_0");
  });

  it("falls back to the getaway's last node when its route is only one edge", () => {
    const short = { from: "g_0_0", to: "g_1_0", path: ["g_0_0", "g_1_0"], idx: 0 };
    expect(pursuitTarget(0, short, "g_1_0")).toBe("g_0_0");
  });
});

describe("chooseTurn", () => {
  it("never goes straight back and never takes a closed road", () => {
    const blocked = new Set([edgeKey("g_0_0", "g_1_0")]);
    for (let i = 0; i < 40; i++) {
      const next = chooseTurn("g_-1_0", "g_0_0", blocked, Math.random)!;
      expect(next).not.toBe("g_-1_0");
      expect(next).not.toBe("g_1_0");
      expect(neighbours("g_0_0")).toContain(next);
    }
  });

  it("turns back only at a dead end", () => {
    const blockedAll = new Set(neighbours("g_0_0").filter((n) => n !== "g_-1_0").map((n) => edgeKey("g_0_0", n)));
    expect(chooseTurn("g_-1_0", "g_0_0", blockedAll, () => 0.5)).toBe("g_-1_0");
  });
});

describe("geometry", () => {
  it("classifies turns", () => {
    expect(turnKind("g_-1_0", "g_0_0", "g_1_0")).toBe(0);
    expect(turnKind("g_-1_0", "g_0_0", "g_-1_0")).toBe(2);
    expect(Math.abs(turnKind("g_-1_0", "g_0_0", "g_0_1"))).toBe(1);
  });

  it("measures the straight run ahead", () => {
    expect(straightAhead(["g_-1_0", "g_0_0", "g_1_0", "g_2_0"], 0, 0.5)).toBeCloseTo(100);
    expect(straightAhead(["g_-1_0", "g_0_0", "g_0_1"], 0, 0.5)).toBeCloseTo(20);
  });

  it("boxes the getaway in with slots around it, facing it", () => {
    const slots = boxSlots(0, 0, 0, 3);
    expect(slots).toHaveLength(3);
    for (const s of slots) {
      const d = Math.hypot(s.x, s.z);
      expect(d).toBeGreaterThan(3);
      expect(d).toBeLessThan(8);
    }
    expect(slots[0].z).toBeGreaterThan(0); // in front (heading 0 = +z)
    expect(slots[1].z).toBeLessThan(0); // behind
  });

  it("picks an escape node on a highway road", () => {
    const id = escapeNode({ x: 0, z: 0 }, seq(0.3));
    const n = getNode(id);
    expect(id.startsWith("mw_") || n.zone === "highway").toBe(true);
  });
});

describe("speed cameras", () => {
  const sites = cameraSites();
  it("has 6 posts on main roads", () => {
    expect(sites).toHaveLength(6);
  });

  it("flashes only above 1.3x the limit near the post", () => {
    const cam = sites[0];
    const at = { edgeKey: cam.key, from: cam.a, t: cam.t, speed: cam.limit * 1.35 };
    expect(speedingHit(cam, at)).toBe(true);
    expect(speedingHit(cam, { ...at, speed: cam.limit * 1.2 })).toBe(false);
    expect(speedingHit(cam, { ...at, t: 0.05 })).toBe(false);
    expect(speedingHit(cam, { ...at, edgeKey: "x|y" })).toBe(false);
    // travelling the other way: t is measured from b
    expect(speedingHit(cam, { ...at, from: cam.b, t: 1 - cam.t })).toBe(true);
  });
});

describe("street racers", () => {
  it("race strip is a straight downtown row with a ramp onto the ring", () => {
    const p = raceStrip(0, true);
    expect(p[0]).toBe("g_-4_0");
    expect(p[8]).toBe("g_4_0");
    expect(p[9].startsWith("h_")).toBe(true);
  });

  it("launches only on a green after a red", () => {
    let st = racerLaunch(false, "green");
    expect(st.go).toBe(false);
    st = racerLaunch(st.sawRed, "red");
    expect(st.go).toBe(false);
    st = racerLaunch(st.sawRed, "amber");
    expect(st.go).toBe(false);
    st = racerLaunch(st.sawRed, "green");
    expect(st.go).toBe(true);
  });
});
