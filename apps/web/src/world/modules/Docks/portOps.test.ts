import { describe, expect, it } from "vitest";
import { deckIndex, type BerthState } from "../../berths";
import {
  CRANE_BAYS,
  DISCHARGE_PER_CRANE,
  LOAD_MAX_PER_CRANE,
  LOAD_MIN_PER_CRANE,
  LOAD_TARGET_FILL,
  LOCK_R,
  UP_Y,
  BLOCK_TIERS,
  createPortOps,
  deckFill,
  stepPortOps,
  topTier,
  type PortOps,
} from "./portOps";

function berth(fill = 0.55, seed = 3): BerthState {
  const rows = 9, bays = 10, tiers = 4;
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const deck = Array.from({ length: rows * bays * tiers }, () => ({ color: null as string | null }));
  const b: BerthState = {
    id: "docks", quayX: 354, zMin: -77, zMax: 77, phase: "empty", phaseStartedAt: 0, shipName: "TEST",
    rows, bays, tiers, deck, x: 354, z: 0, heading: 0, bob: 0, craneDone: false, discharged: 0, loaded: 0,
  };
  // contiguous stacks from the bottom
  for (let bay = 0; bay < bays; bay++)
    for (let row = 0; row < rows; row++) {
      const h = Math.round(r() * tiers * fill * 2);
      for (let t = 0; t < Math.min(tiers, h); t++) deck[deckIndex(b, bay, row, t)].color = "#123456";
    }
  return b;
}

function totalBoxes(ops: PortOps, b: BerthState) {
  let n = b.deck.filter((d) => d.color).length;
  for (const side of [-1, 1] as const) for (const col of ops.blocks[side]) n += col.length;
  for (const c of ops.cranes) n += (c.box ? 1 : 0) + (c.spot.box ? 1 : 0);
  for (const k of ops.carriers) n += k.box ? 1 : 0;
  return n;
}

interface Log {
  t: number;
  crane: number;
  kind: "discharge" | "load";
}

function run(b: BerthState, ops: PortOps, seconds: number, dt = 0.05, onStep?: (t: number) => void) {
  const log: Log[] = [];
  const prev = ops.cranes.map((c) => ({ d: c.discharged, l: c.loaded }));
  for (let t = 0; t < seconds; t += dt) {
    b.bob = Math.sin(t * 0.6) * 0.15;
    stepPortOps(ops, b, dt);
    ops.cranes.forEach((c, i) => {
      if (c.discharged > prev[i].d) log.push({ t, crane: i, kind: "discharge" });
      if (c.loaded > prev[i].l) log.push({ t, crane: i, kind: "load" });
      prev[i] = { d: c.discharged, l: c.loaded };
    });
    onStep?.(t);
    if (b.craneDone) break;
  }
  return log;
}

describe("port ops: idle phases", () => {
  it("keeps cranes parked with booms raised while no ship is working", () => {
    const b = berth();
    const ops = createPortOps();
    for (const phase of ["empty", "approaching", "mooring", "departing"] as const) {
      b.phase = phase;
      run(b, ops, 20);
      for (const c of ops.cranes) {
        expect(c.boom).toBe(1);
        expect(c.box).toBeNull();
        expect(c.spreaderY).toBe(UP_Y);
      }
      expect(b.discharged).toBe(0);
    }
  });
});

describe("port ops: a full call", () => {
  const b = berth();
  const ops = createPortOps();
  const startFill = deckFill(b);
  const startTotal = totalBoxes(ops, b);
  b.phase = "working";
  b.phaseStartedAt = 1234;
  const touched: number[][] = [[], [], []];
  let minGap = Infinity;
  let lockViolations = 0;
  let boomWhileWorking = 0;
  let total = startTotal;
  let conserved = true;
  let carrierSideOk = true;
  let blockOverflow = false;
  const log = run(b, ops, 1800, 0.05, () => {
    const zs = ops.cranes.map((c) => c.z).sort((p, q) => p - q);
    for (let i = 1; i < zs.length; i++) minGap = Math.min(minGap, zs[i] - zs[i - 1]);
    for (const c of ops.cranes) {
      if (c.bay !== null) touched[c.id].push(c.bay);
      if (c.locked) for (const k of ops.carriers) if (Math.abs(k.z - c.z) < LOCK_R - 1e-6) lockViolations++;
      if (c.trolleyX > 336 && c.boom > 0) boomWhileWorking++;
    }
    for (const k of ops.carriers) if (Math.sign(k.z) !== k.side) carrierSideOk = false;
    for (const side of [-1, 1] as const) for (const col of ops.blocks[side]) if (col.length > BLOCK_TIERS) blockOverflow = true;
    total = totalBoxes(ops, b);
    if (total !== startTotal) conserved = false;
  });

  it("finishes and sets craneDone", () => {
    expect(b.craneDone).toBe(true);
    for (const c of ops.cranes) expect(c.mode).toBe("done");
  });

  it("each crane only works its own bays, and cranes stay >= 2 bays apart", () => {
    touched.forEach((bays, i) => {
      expect(bays.length).toBeGreaterThan(0);
      for (const bay of bays) expect(CRANE_BAYS[i]).toContain(bay);
    });
    expect(minGap).toBeGreaterThanOrEqual(2 * 12.6 - 1e-6);
  });

  it("discharges first, then loads", () => {
    for (let i = 0; i < 3; i++) {
      const mine = log.filter((l) => l.crane === i);
      const firstLoad = mine.findIndex((l) => l.kind === "load");
      const lastDischarge = mine.map((l) => l.kind).lastIndexOf("discharge");
      expect(lastDischarge).toBeGreaterThanOrEqual(0);
      if (firstLoad >= 0) expect(lastDischarge).toBeLessThan(firstLoad);
    }
  });

  it("keeps the berth counters in step with the deck", () => {
    const d = ops.cranes.reduce((a, c) => a + c.discharged, 0);
    const l = ops.cranes.reduce((a, c) => a + c.loaded, 0);
    expect(b.discharged).toBe(d);
    expect(b.loaded).toBe(l);
    expect(d).toBe(3 * DISCHARGE_PER_CRANE);
    for (const c of ops.cranes) {
      expect(c.loaded).toBeLessThanOrEqual(LOAD_MAX_PER_CRANE);
      expect(c.loaded).toBeGreaterThanOrEqual(LOAD_MIN_PER_CRANE);
    }
    expect(Math.round((deckFill(b) - startFill) * b.deck.length)).toBe(l - d);
    expect(deckFill(b) >= LOAD_TARGET_FILL || ops.cranes.every((c) => c.loaded >= LOAD_MIN_PER_CRANE)).toBe(true);
  });

  it("never creates or loses a box, overfills a block, or runs a carrier under a locked crane", () => {
    expect(conserved).toBe(true);
    expect(blockOverflow).toBe(false);
    expect(lockViolations).toBe(0);
    expect(carrierSideOk).toBe(true);
    expect(boomWhileWorking).toBe(0);
  });

  it("keeps deck stacks contiguous (no floating boxes)", () => {
    for (let bay = 0; bay < b.bays; bay++)
      for (let row = 0; row < b.rows; row++) {
        const top = topTier(b, bay, row);
        for (let t = 0; t <= top; t++) expect(b.deck[deckIndex(b, bay, row, t)].color).not.toBeNull();
      }
  });

  it("cycles take roughly 25-40 s per box per crane", () => {
    for (let i = 0; i < 3; i++) {
      const ts = log.filter((l) => l.crane === i && l.kind === "discharge").map((l) => l.t);
      const gaps = ts.slice(1).map((t, j) => t - ts[j]);
      const fastest = Math.min(...gaps);
      expect(fastest).toBeGreaterThan(22);
      expect(fastest).toBeLessThan(45);
    }
  });

  it("raises booms again after the call and resets on the next call", () => {
    for (let i = 0; i < 200; i++) stepPortOps(ops, b, 0.05);
    for (const c of ops.cranes) expect(c.boom).toBeGreaterThan(0.9);
    b.phase = "departing";
    run(b, ops, 5);
    b.phase = "working";
    b.phaseStartedAt = 99999;
    stepPortOps(ops, b, 0.05);
    expect(b.craneDone).toBe(false);
    expect(b.discharged).toBe(0);
  });
});
