import { describe, expect, it } from "vitest";
import { deckIndex, type BerthState } from "../../berths";
import { RmgSim } from "./cranes";
import { makeYardBox, yardSpecs } from "./layout";
import { Quay, STS_SPEC, boxFromSlot, columnHeight, deckFill, slotFromBox } from "./quay";
import { Yard, mulberry32 } from "./yard";

function berth(fill = 0.7, seed = 1): BerthState {
  const rows = 9;
  const bays = 10;
  const tiers = 4;
  const r = mulberry32(seed);
  const deck = Array.from({ length: rows * bays * tiers }, () => ({ color: null as string | null, brand: undefined as string | undefined }));
  const b: BerthState = {
    id: "terminal", quayX: 354, zMin: 146, zMax: 304, phase: "empty", phaseStartedAt: 0, shipName: "TEST",
    rows, bays, tiers, deck, x: 354, z: 225, heading: 0, bob: 0, craneDone: false, discharged: 0, loaded: 0,
  };
  for (let bay = 0; bay < bays; bay++)
    for (let row = 0; row < rows; row++) {
      const h = Math.round(r() * tiers * fill * 1.4);
      for (let t = 0; t < Math.min(tiers, h); t++) deck[deckIndex(b, bay, row, t)].color = r() < 0.3 ? "#4bb4d6" : "#b8382f";
    }
  return b;
}

function setup(b: BerthState) {
  const yard = new Yard(yardSpecs(), makeYardBox);
  const rmgs = [0, 1, 2].map((k) => new RmgSim(k, k, yard));
  const q = new Quay(b, yard, { rmgTouches: (s) => rmgs.some((m) => m.touches(s)) }, mulberry32(4));
  rmgs.forEach((m, k) => (m.idleHook = () => q.rmgIdleJob(k)));
  const rand = mulberry32(5);
  const step = (dt: number) => {
    for (const m of rmgs) m.update(dt, rand);
    q.update(dt);
  };
  return { yard, rmgs, q, step };
}

function noFloating(b: BerthState) {
  for (let bay = 0; bay < b.bays; bay++)
    for (let row = 0; row < b.rows; row++) {
      const h = columnHeight(b, bay, row);
      for (let t = h; t < b.tiers; t++) expect(b.deck[deckIndex(b, bay, row, t)].color, `${bay}/${row}/${t}`).toBeNull();
    }
}

describe("quay cranes working the real ship", () => {
  it("keep booms up and stay idle until the ship is working", () => {
    const b = berth();
    const { q, step } = setup(b);
    b.phase = "approaching";
    for (let i = 0; i < 300; i++) step(0.1);
    expect(q.cranes.every((c) => c.boom === 1 && !c.job)).toBe(true);
    expect(b.discharged).toBe(0);
  });

  it("discharge the top box of every column, load exports to ~60%, then set craneDone", () => {
    const b = berth(0.7);
    const { q, yard, step } = setup(b);
    const columns = (() => {
      let n = 0;
      for (let bay = 0; bay < b.bays; bay++) for (let row = 0; row < b.rows; row++) if (columnHeight(b, bay, row) > 0) n++;
      return n;
    })();
    const boxesBefore = yard.count() + b.deck.filter((s) => s.color).length;
    b.phase = "working";
    let sawBoomDown = false;
    let maxSway = 0;
    for (let i = 0; i < 60 * 60 * 10 && !b.craneDone; i++) {
      step(0.1);
      if (q.cranes.some((c) => c.boom === 0)) sawBoomDown = true;
      for (const c of q.cranes) maxSway = Math.max(maxSway, Math.abs(c.sway));
      if (i % 50 === 0) noFloating(b);
    }
    expect(sawBoomDown).toBe(true);
    expect(b.craneDone).toBe(true);
    expect(b.discharged).toBe(columns);
    expect(b.loaded).toBeGreaterThan(0);
    // loads towards ~60%, bounded by each crane's load window so the ship can sail
    expect(deckFill(b) >= STS_SPEC.loadTarget - 0.02 || q.cranes.every((c) => c.loadTime > STS_SPEC.maxLoadS || c.loaded > c.discharged)).toBe(true);
    expect(maxSway).toBeGreaterThan(0);
    noFloating(b);
    // nothing lost: yard + deck + apron/straddles/cranes
    for (let i = 0; i < 600; i++) step(0.1);
    expect(yard.count() + b.deck.filter((s) => s.color).length + q.inFlight()).toBe(boxesBefore);
  });

  it("keeps the cranes apart and in order along the quay", () => {
    const b = berth(0.8, 3);
    const { q, step } = setup(b);
    b.phase = "working";
    for (let i = 0; i < 20000 && !b.craneDone; i++) {
      step(0.1);
      const zs = q.cranes.map((c) => c.z);
      expect(zs[1] - zs[0]).toBeGreaterThan(STS_SPEC.minGap - 1);
      expect(zs[2] - zs[1]).toBeGreaterThan(STS_SPEC.minGap - 1);
    }
  });

  it("puts a box straight onto a lorry waiting on the quay road", () => {
    const b = berth(0.7);
    const { q, step } = setup(b);
    b.phase = "working";
    for (let i = 0; i < 50; i++) step(0.1);
    const c = q.craneWantingTruck();
    expect(c).not.toBeNull();
    q.requestDirect(c!, "CT-T", 312, q.cranes[c!].z);
    let got = false;
    for (let i = 0; i < 2000 && !got; i++) for (const e of q.update(0.1)) if (e.type === "truckLoaded" && e.truckId === "CT-T") got = true;
    void step;
    expect(got).toBe(true);
  });

  it("maps deck slot colours to boxes and back", () => {
    expect(slotFromBox(boxFromSlot("#b8382f"))).toEqual({ color: "#b8382f" });
    expect(slotFromBox(boxFromSlot("#123456"))).toEqual({ color: "#123456" });
    expect(slotFromBox(boxFromSlot("#4bb4d6", "MAERLIN")).brand).toBe("MAERLIN");
  });
});
