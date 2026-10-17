import { afterEach, describe, expect, it } from "vitest";
import { on, type WorldEvent } from "../../bus";
import { CT_PLACES } from "../../districts/containerTerminal";
import { allVehicles } from "../../registry";
import { blockedSet, useWorld } from "../../store";
import { deckIndex, type BerthState } from "../../berths";
import { TruckSim, destinationPools, isInternalEdge, roadName } from "./trucks";

let sim: TruckSim | null = null;
afterEach(() => {
  sim?.dispose();
  sim = null;
  useWorld.setState({ blocked: {}, incidents: [] });
});

function run(s: TruckSim, seconds: number, dt = 0.1, each?: () => void) {
  for (let t = 0; t < seconds; t += dt) {
    s.update(dt, t * 1000, blockedSet());
    each?.();
  }
}

describe("container lorry loop", () => {
  it("registers 12 trucks in the registry", () => {
    sim = new TruckSim({ count: 12, firstTipAfter: 1e9 });
    const mine = [...allVehicles()].filter((v) => v.id.startsWith("CT-"));
    expect(mine.length).toBe(12);
    expect(mine.every((v) => v.kind === "truck")).toBe(true);
  });

  it("checks in, gets a box lowered on by an RMG, leaves through the out-gate and delivers", () => {
    sim = new TruckSim({ count: 12, firstTipAfter: 1e9, seed: 3 });
    const seen = { checkin: false, atBay: false, loadedOut: false, drop: false, toGateAfterDrop: false };
    const s = sim;
    run(s, 420, 0.1, () => {
      for (const t of s.trucks) {
        if (t.phase === "checkin") seen.checkin = true;
        if (t.phase === "atBay") seen.atBay = true;
        if (t.leg === "outbound" && t.box && t.loaded) seen.loadedOut = true;
        if (t.phase === "drop") seen.drop = true;
        for (const v of [t.cab.x, t.cab.z, t.trailer.h, t.boxPose.x]) expect(Number.isFinite(v)).toBe(true);
      }
    });
    expect(seen.checkin).toBe(true);
    expect(seen.atBay).toBe(true);
    expect(seen.loadedOut).toBe(true);
    expect(seen.drop).toBe(true);
    // nobody got stuck waiting for a route forever
    expect(s.trucks.filter((t) => t.phase === "wait").length).toBeLessThan(4);
  });

  it("outbound routes leave by the south exit, never back through the check-in lanes", () => {
    sim = new TruckSim({ count: 12, firstTipAfter: 1e9, seed: 5 });
    const s = sim;
    let checked = 0;
    run(s, 300, 0.1, () => {
      for (const t of s.trucks) {
        if (t.leg !== "outbound" || !t.route || t.route.nodes[0] !== CT_PLACES.bays[t.rmg]) continue;
        const n = t.route.nodes;
        if (!n.includes(CT_PLACES.exit)) continue;
        checked++;
        expect(n.some((id) => id.startsWith("ct_gm_"))).toBe(false);
      }
    });
    expect(checked).toBeGreaterThan(0);
  });

  it("a maniac rolls a box over: incident, blocked road, events; cleared -> wreck removed and truck respawns", () => {
    sim = new TruckSim({ count: 12, firstTipAfter: 1e9, seed: 8 });
    const s = sim;
    const events: WorldEvent[] = [];
    const off = on((e) => events.push(e));
    // wait until someone is out on a public road with a box, then force it
    let tipped = false;
    for (let k = 0; k < 3000 && !tipped; k++) {
      s.update(0.1, k * 100, blockedSet());
      tipped = s.tipAny();
    }
    expect(tipped).toBe(true);
    const w = useWorld.getState();
    const inc = w.incidents.find((i) => i.kind === "truck_crash")!;
    expect(inc).toBeTruthy();
    expect(inc.note).toMatch(/Container lorry .* overturned on .*, load shed/);
    expect(w.blocked[inc.edgeKey]).toBe(inc.note);
    expect(isInternalEdge(inc.edgeKey)).toBe(false);
    expect(events.some((e) => e.type === "incident:created" && e.incidentId === inc.id)).toBe(true);
    expect(events.some((e) => e.type === "vehicle:crashed" && e.incidentId === inc.id)).toBe(true);
    const wrecked = s.trucks.find((t) => t.incidentId === inc.id)!;
    run(s, 4);
    expect(wrecked.wreck?.burst).toBe(true);
    expect(Math.abs(wrecked.wreck!.roll)).toBeGreaterThan(1.2);
    // responders clear it
    useWorld.getState().updateIncident(inc.id, { status: "cleared" });
    useWorld.getState().unblockEdge(inc.edgeKey);
    s.onEvent({ type: "incident:cleared", incidentId: inc.id });
    run(s, 12);
    expect(s.trucks[wrecked.index].phase).not.toBe("wrecked");
    expect(s.trucks[wrecked.index].id).not.toBe(wrecked.id);
    expect([...allVehicles()].some((v) => v.id === wrecked.id)).toBe(false);
    off();
  });

  it("the Crashes module can roll one of our lorries via registry crash()", () => {
    sim = new TruckSim({ count: 12, firstTipAfter: 1e9, seed: 4 });
    const s = sim;
    let ok = false;
    for (let k = 0; k < 3000 && !ok; k++) {
      s.update(0.1, k * 100, blockedSet());
      for (const v of allVehicles()) if (v.id.startsWith("CT-") && !v.stopped && v.crash?.()) ok = true;
    }
    expect(ok).toBe(true);
    const t = s.trucks.find((x) => x.phase === "wrecked")!;
    expect(t).toBeTruthy();
    // Crashes files the incident; we pick up its id from the bus
    s.onEvent({ type: "vehicle:crashed", vehicleId: t.id, incidentId: "INC-x" });
    expect(t.incidentId).toBe("INC-x");
    expect(useWorld.getState().incidents.length).toBe(0); // we did not file our own
  });

  it("maniacs eventually tip over on their own", () => {
    sim = new TruckSim({ count: 14, firstTipAfter: 5, tipGap: [5, 10], seed: 11 });
    run(sim, 900, 0.1);
    expect(sim.tips).toBeGreaterThan(0);
  });

  it("has destinations and names roads", () => {
    const p = destinationPools();
    expect(p.far.length + p.ind.length).toBeGreaterThan(5);
    expect(roadName("h_0|h_1")).toBe("the Ring Road");
  });

  it("with a ship working the berth, some lorries take a box straight off the ship on the quay road", () => {
    const deck = Array.from({ length: 9 * 10 * 4 }, () => ({ color: null as string | null }));
    const berth: BerthState = {
      id: "terminal", quayX: 354, zMin: 146, zMax: 304, phase: "working", phaseStartedAt: 0, shipName: "T", rows: 9, bays: 10, tiers: 4,
      deck, x: 354, z: 225, heading: 0, bob: 0, craneDone: false, discharged: 0, loaded: 0,
    };
    for (let bay = 0; bay < 10; bay++) for (let row = 0; row < 9; row++) for (let t = 0; t < 3; t++) deck[deckIndex(berth, bay, row, t)].color = "#2e6fb7";
    sim = new TruckSim({ count: 12, firstTipAfter: 1e9, seed: 6, berth });
    const s = sim;
    let direct = false;
    run(s, 600, 0.1, () => {
      for (const t of s.trucks) if (t.phase === "atQuay" && t.loaded && t.box) direct = true;
    });
    expect(berth.discharged).toBeGreaterThan(20);
    expect(direct).toBe(true);
  });
});
