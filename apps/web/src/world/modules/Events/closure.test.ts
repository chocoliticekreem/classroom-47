import { describe, expect, it } from "vitest";
import { edgeKey, neighbours } from "../../roads";
import { ClosureLedger, diffClosures, fullClosure, orphanClosures, rollingWindow, type ClosureStore } from "./closure";
import { Convoy } from "./convoy";
import { gridRun, RouteTrack } from "./route";

const route = gridRun([-4, 0], [4, 0]); // 8 edges along row 0

function fakeStore(initial: Record<string, string> = {}): ClosureStore & { map: Record<string, string> } {
  const map = { ...initial };
  return {
    map,
    blocked: () => map,
    block: (k, r) => {
      map[k] = r;
    },
    unblock: (k) => {
      delete map[k];
    },
  };
}

describe("rolling closure window", () => {
  it("closes the occupied edges plus the next few ahead", () => {
    const w = rollingWindow(route, 2, 3, 3, false);
    expect([...w]).toEqual([2, 3, 4, 5, 6].map((k) => edgeKey(route[k], route[k + 1])));
  });

  it("clamps at the end of the route", () => {
    const w = rollingWindow(route, 6, 7, 3, false);
    expect([...w]).toEqual([6, 7].map((k) => edgeKey(route[k], route[k + 1])));
  });

  it("holds cross traffic: side roads at junctions in the window are closed", () => {
    const w = rollingWindow(route, 2, 2, 1);
    // junctions route[3] and route[4] are inside the window
    for (const node of [route[3], route[4]]) for (const nb of neighbours(node)) expect(w.has(edgeKey(node, nb))).toBe(true);
    // junction behind the tail is not held
    const behind = neighbours(route[1]).filter((nb) => !route.includes(nb));
    for (const nb of behind) expect(w.has(edgeKey(route[1], nb))).toBe(false);
  });

  it("full closure covers every route edge", () => {
    const w = fullClosure(route, false);
    expect(w.size).toBe(route.length - 1);
  });

  it("diff closes new keys and reopens old ones", () => {
    expect(diffClosures(new Set(["a", "b"]), new Set(["b", "c"]))).toEqual({ close: ["c"], open: ["a"] });
  });

  it("as a convoy drives the route, edges reopen behind it and nothing stays closed at the end", () => {
    const store = fakeStore();
    const ledger = new ClosureLedger(store, "Road closed: motorcade");
    const convoy = new Convoy(new RouteTrack(route), [{ offset: 0, lateral: 0 }, { offset: 30, lateral: 0 }], 14);
    let maxClosed = 0;
    let firstEdgeReopened = false;
    const first = edgeKey(route[0], route[1]);
    for (let i = 0; i < 2000 && !convoy.arrived; i++) {
      convoy.step(0.1);
      ledger.set(rollingWindow(route, convoy.tailIdx(), convoy.headIdx()));
      maxClosed = Math.max(maxClosed, Object.keys(store.map).length);
      if (convoy.s > 120 && !(first in store.map)) firstEdgeReopened = true;
    }
    expect(convoy.arrived).toBe(true);
    expect(firstEdgeReopened).toBe(true);
    expect(maxClosed).toBeGreaterThan(3);
    ledger.releaseAll();
    expect(store.map).toEqual({});
  });
});

describe("ClosureLedger", () => {
  it("never takes over or reopens someone else's closure", () => {
    const store = fakeStore({ x: "Crash on King St" });
    const l = new ClosureLedger(store, "Road closed: marathon");
    l.set(new Set(["x", "y"]));
    expect(store.map).toEqual({ x: "Crash on King St", y: "Road closed: marathon" });
    expect([...l.keys]).toEqual(["y"]);
    l.releaseAll();
    expect(store.map).toEqual({ x: "Crash on King St" });
  });

  it("re-closes a wanted road another module reopened, and adopts one that became free", () => {
    const store = fakeStore({ x: "Crash" });
    const l = new ClosureLedger(store, "R");
    l.set(new Set(["x", "y"]));
    delete store.map.y; // someone reopened ours
    delete store.map.x; // the crash cleared
    expect(l.reassert()).toBe(true);
    expect(store.map).toEqual({ x: "R", y: "R" });
    l.releaseAll();
    expect(store.map).toEqual({});
  });

  it("finds orphaned event closures", () => {
    const reasons = new Set(["Road closed: motorcade"]);
    expect(orphanClosures({ a: "Road closed: motorcade", b: "Crash", c: "Road closed: motorcade" }, reasons, new Set(["a"]))).toEqual(["c"]);
  });
});
