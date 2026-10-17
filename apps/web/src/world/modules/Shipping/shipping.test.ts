import { describe, expect, it } from "vitest";
import { BERTHS, deckSlotPosition, type BerthId, type BerthState, type ShipPhase } from "../../berths";
import { countBoxes, fillDeck, isStacked } from "./deck";
import { CLASSES, CONTRACT_BAYS, CONTRACT_ROWS, CONTRACT_TIERS, FLEET, bayZ, fits, rowX, shipLayout } from "./fleet";
import { Harbour, type Vessel } from "./harbour";
import { ANCHORAGE, MOORED_HEADING, accelerate, advance, approachLane, buildLane, departureLane, inboundLane, laneAt, wrapAngle } from "./lanes";
import { steer, toWorld, tugSlot, type Boat, type Slot } from "./tugs";

function freshBerths(): Record<BerthId, BerthState> {
  return structuredClone(BERTHS);
}

describe("deck fill", () => {
  it("is 70-90% full, physically stacked and deterministic", () => {
    for (let seed = 1; seed < 40; seed++) {
      const o = { rows: 9, bays: 10, tiers: 4 };
      const d = fillDeck(seed, o);
      const n = countBoxes(d);
      expect(n / 360).toBeGreaterThanOrEqual(0.69);
      expect(n / 360).toBeLessThanOrEqual(0.91);
      expect(isStacked(d, 9, 10, 4)).toBe(true);
      expect(fillDeck(seed, o)).toEqual(d);
    }
  });
  it("respects maxTier and uses several brands", () => {
    const d = fillDeck(5, { rows: 9, bays: 10, tiers: 4, maxTier: 3, homeBrand: "KOSKA" });
    for (let i = 3; i < d.length; i += 4) expect(d[i].color).toBeNull();
    const brands = new Set(d.filter((s) => s.brand).map((s) => s.brand));
    expect(brands.size).toBeGreaterThanOrEqual(3);
    expect(brands.has("KOSKA")).toBe(true);
  });
});

describe("fleet layout", () => {
  it("maps contract bay/row to deckSlotPosition when moored bow-north", () => {
    const b = freshBerths().docks;
    b.x = 354;
    b.z = 0;
    b.bob = 0;
    const h = MOORED_HEADING;
    for (const [bay, row] of [[0, 0], [9, 8], [4, 2]]) {
      const lx = rowX(row), lz = bayZ(bay);
      const w = toWorld({ x: b.x, z: b.z, heading: h, half: 1, beam: 1 }, lx, lz, { x: 0, z: 0 });
      const p = deckSlotPosition(b, bay, row, 0);
      expect(w.x).toBeCloseTo(p.x, 4);
      expect(w.z).toBeCloseTo(p.z, 4);
    }
  });
  it("ships fit their berths without overlapping the neighbour berth", () => {
    for (const spec of FLEET) {
      const L = CLASSES[spec.cls].length;
      // docks ship ends before the biggest terminal ship begins
      const docksEnd = fits(spec, "docks") ? L / 2 : -Infinity;
      expect(docksEnd).toBeLessThan(225 - CLASSES.giant.length / 2);
    }
  });
  it("superstructure clears the cargo block", () => {
    for (const c of Object.values(CLASSES)) {
      const l = shipLayout(c);
      const cargoMin = bayZ(CONTRACT_BAYS - 1) - 6.3, cargoMax = bayZ(0) + 6.3;
      for (const r of [l.house, l.funnel]) expect(r.z1 <= cargoMin + 0.01 || r.z0 >= cargoMax - 0.01).toBe(true);
      for (const z of l.decoBays) expect(Math.abs(z)).toBeGreaterThan(cargoMax);
      expect(l.bowStart).toBeLessThan(l.half);
    }
  });
});

describe("lanes", () => {
  it("are arc-length sampled and continuous", () => {
    const l = buildLane([[0, 0], [100, 0], [200, 100]], 2);
    const p = { x: 0, z: 0, heading: 0 };
    let prev = laneAt(l, 0, { ...p });
    for (let s = 2; s < l.length; s += 2) {
      const q = laneAt(l, s, { ...p });
      expect(Math.hypot(q.x - prev.x, q.z - prev.z)).toBeLessThan(2.3);
      prev = q;
    }
    expect(laneAt(l, l.length, p).x).toBeCloseTo(200, 0);
  });
  it("approach lanes end at the swing point; departure lanes reach the horizon", () => {
    for (const b of ["docks", "terminal"] as const) {
      const spot = ANCHORAGE.find((s) => s.berth === b)!;
      const ap = approachLane(b, [spot.x, spot.z], -Math.PI / 2, 100);
      const end = laneAt(ap.lane, ap.lane.length, { x: 0, z: 0, heading: 0 });
      expect(end.x).toBeCloseTo(BERTHS[b].quayX + 100, 0);
      expect(ap.holdS).toBeGreaterThan(50);
      expect(ap.holdS).toBeLessThan(ap.lane.length - 100);
      const d = departureLane(b, 100);
      expect(laneAt(d, d.length, end).x).toBeGreaterThan(2500);
    }
    for (let k = 0; k < ANCHORAGE.length; k++) {
      const l = inboundLane(k);
      expect(l.x[0]).toBeGreaterThan(1500);
    }
  });
  it("speed profile stops exactly at the mark and never overshoots", () => {
    const m = { s: 0, v: 0 };
    let t = 0, vmax = 0;
    while (!advance(m, 0.1, 9, 0.3, 0.2, 500) && t < 400) {
      t += 0.1;
      vmax = Math.max(vmax, m.v);
      expect(m.s).toBeLessThanOrEqual(500);
    }
    expect(m.s).toBe(500);
    expect(vmax).toBeLessThanOrEqual(9);
    expect(t).toBeLessThan(140);
    const d = { s: 0, v: 0 };
    let n = 0;
    while (!accelerate(d, 0.1, 10, 0.3, 1000)) n++;
    expect(d.v).toBe(10);
    expect(n).toBeLessThan(2000);
  });
});

describe("tugs", () => {
  const ship = { x: 484, z: 0, heading: Math.PI, half: 98, beam: 26 };
  it("push slots are on the seaward side, bow at the hull", () => {
    const s: Slot = { x: 0, z: 0, heading: 0, line: null, effort: 0 };
    for (const role of [0, 1] as const) {
      tugSlot(role, "push", ship, -1, s);
      expect(s.x).toBeGreaterThan(ship.x + 13); // seaward = +x
      // bow points at the ship (-x)
      expect(Math.sin(s.heading)).toBeCloseTo(-1, 5);
      expect(s.effort).toBe(1);
    }
    tugSlot(0, "push", ship, -1, s);
    const fwdZ = s.z;
    tugSlot(1, "push", ship, -1, s);
    expect(fwdZ).toBeLessThan(s.z); // forward tug towards the bow (north, -z)
  });
  it("pull slots stand off with a towline", () => {
    const s: Slot = { x: 0, z: 0, heading: 0, line: null, effort: 0 };
    tugSlot(0, "pull", ship, -1, s);
    expect(s.x).toBeGreaterThan(ship.x + 40);
    expect(s.line).not.toBeNull();
    expect(Math.sin(s.heading)).toBeCloseTo(1, 5);
  });
  it("steering reaches a static slot and locks, and tracks a moving one", () => {
    const b: Boat = { x: 0, z: 0, heading: 0, speed: 0, locked: false };
    let t = 0;
    while (!b.locked && t < 120) {
      steer(b, 300, 200, 1, 0.05);
      t += 0.05;
    }
    expect(b.locked).toBe(true);
    // moving target at 6 m/s
    let tx = 0;
    const c: Boat = { x: -100, z: 50, heading: 0, speed: 0, locked: false };
    for (let i = 0; i < 2400; i++) {
      tx += 6 * 0.05;
      steer(c, tx, 0, Math.PI / 2, 0.05, 6, 0);
    }
    expect(Math.hypot(c.x - tx, c.z)).toBeLessThan(2);
  });
});

/** Overlap test between two ships as oriented rectangles (length x beam), each grown by `pad` metres. SAT. */
function overlap(a: Vessel, b: Vessel, pad = 2) {
  const axes = (v: Vessel) => [[Math.sin(v.heading), Math.cos(v.heading)], [Math.cos(v.heading), -Math.sin(v.heading)]];
  const half = (v: Vessel) => [v.layout.half + pad, v.layout.beam / 2 + pad];
  for (const ax of [...axes(a), ...axes(b)]) {
    const proj = (v: Vessel) => {
      const [u, w] = axes(v);
      const [hl, hw] = half(v);
      const c = v.x * ax[0] + v.z * ax[1];
      const r = hl * Math.abs(u[0] * ax[0] + u[1] * ax[1]) + hw * Math.abs(w[0] * ax[0] + w[1] * ax[1]);
      return [c - r, c + r];
    };
    const [a0, a1] = proj(a), [b0, b1] = proj(b);
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

describe("harbour cycle", () => {
  function run(seconds: number, crane?: (h: Harbour, now: number) => void) {
    const berths = freshBerths();
    const h = new Harbour(3, 0, berths);
    const phases: Record<BerthId, ShipPhase[]> = { docks: [berths.docks.phase], terminal: [berths.terminal.phase] };
    const names: Record<BerthId, Set<string>> = { docks: new Set(), terminal: new Set() };
    const clashes: string[] = [];
    let maxAnchored = 0;
    const dt = 0.1;
    for (let t = 0; t < seconds; t += dt) {
      const now = t * 1000;
      h.step(dt, now);
      crane?.(h, now);
      for (const b of ["docks", "terminal"] as const) {
        const ph = phases[b];
        if (ph[ph.length - 1] !== berths[b].phase) ph.push(berths[b].phase);
        if (berths[b].shipName) names[b].add(berths[b].shipName!);
      }
      const live = h.vessels.filter((v) => v.state !== "offstage");
      for (const v of live) {
        expect(Number.isFinite(v.x) && Number.isFinite(v.z) && Number.isFinite(v.heading)).toBe(true);
      }
      for (let i = 0; i < live.length; i++)
        for (let j = i + 1; j < live.length; j++)
          if (overlap(live[i], live[j]) && clashes.length < 5) clashes.push(`${t.toFixed(1)} ${live[i].spec.name}/${live[i].state} ${live[j].spec.name}/${live[j].state}`);
      maxAnchored = Math.max(maxAnchored, h.vessels.filter((v) => v.state === "anchored" || v.state === "called").length);
    }
    return { h, berths, phases, names, clashes, maxAnchored };
  }

  it("cycles both berths in order with no crane module (auto-complete) and keeps ships apart", () => {
    const { phases, names, clashes, maxAnchored } = run(1500);
    const order: ShipPhase[] = ["approaching", "mooring", "working", "unmooring", "departing", "empty"];
    for (const b of ["docks", "terminal"] as const) {
      const ph = phases[b];
      // every transition follows the cycle order
      for (let i = 1; i < ph.length; i++) {
        const a = order.indexOf(ph[i - 1]), c = order.indexOf(ph[i]);
        const ok = c === (a + 1) % order.length || (ph[i - 1] === "departing" && ph[i] === "approaching");
        expect(ok, `${b}: ${ph[i - 1]} -> ${ph[i]}`).toBe(true);
      }
      expect(ph.filter((p) => p === "working").length).toBeGreaterThanOrEqual(3);
      expect(names[b].size).toBeGreaterThanOrEqual(3);
    }
    expect(clashes).toEqual([]);
    expect(maxAnchored).toBeLessThanOrEqual(3);
  });

  it("departs promptly when the crane module sets craneDone", () => {
    const { phases } = run(900, (h) => {
      for (const b of ["docks", "terminal"] as const) {
        const B = h.berths[b];
        const o = h.owner[b];
        if (B.phase === "working" && o >= 0 && h.vessels[o].t > 40) B.craneDone = true;
      }
    });
    expect(phases.docks.filter((p) => p === "working").length).toBeGreaterThanOrEqual(3);
  });

  it("fills the deck at arrival, resets counters and moors at the quay line", () => {
    const berths = freshBerths();
    const h = new Harbour(3, 0, berths);
    berths.terminal.discharged = 9;
    let seenWorking = false;
    for (let t = 0; t < 200; t += 0.1) {
      h.step(0.1, t * 1000);
      const B = berths.terminal;
      if (B.phase === "working") {
        seenWorking = true;
        expect(B.x).toBeCloseTo(B.quayX, 3);
        expect(B.z).toBeCloseTo((B.zMin + B.zMax) / 2, 3);
        expect(Math.abs(wrapAngle(B.heading - Math.PI))).toBeLessThan(1e-6);
        const n = countBoxes(B.deck);
        expect(n / (CONTRACT_ROWS * CONTRACT_BAYS * CONTRACT_TIERS)).toBeGreaterThan(0.69 * (3 / 4) - 0.01);
        break;
      }
    }
    expect(seenWorking).toBe(true);
  });

  it("forceDeparture / forceArrival drive the berth", () => {
    const berths = freshBerths();
    const h = new Harbour(3, 0, berths);
    expect(h.forceDeparture("docks", 0)).toContain("HAMYWAY STAR");
    let t = 0;
    while (berths.docks.phase !== "empty" && berths.docks.phase !== "approaching" && t < 300) {
      h.step(0.1, t * 1000);
      t += 0.1;
    }
    expect(["empty", "approaching"]).toContain(berths.docks.phase);
    const msg = h.forceArrival("docks", t * 1000);
    expect(msg.length).toBeGreaterThan(0);
  });
});
