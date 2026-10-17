import { describe, expect, it } from "vitest";
import type { WorldEvent } from "../../bus";
import type { DamageZone, Incident } from "../../store";
import { CRASH_SITES, DAMAGE_RADIUS } from "./layout";
import { AirportSim, type SimEffects } from "./sim";

function fake() {
  const incidents = new Map<string, Incident>();
  const blocked = new Set<string>();
  const events: WorldEvent[] = [];
  const statuses: string[] = [];
  const damage = new Map<string, DamageZone>();
  const damageLog: string[] = [];
  let n = 0;
  const fx: SimEffects = {
    addIncident: (i) => {
      incidents.set(i.id, i);
      statuses.push(`${i.kind}:${i.status}`);
    },
    updateIncident: (id, p) => {
      const i = incidents.get(id)!;
      Object.assign(i, p);
      if (p.status) statuses.push(`${i.kind}:${p.status}`);
    },
    blockEdge: (k) => blocked.add(k),
    unblockEdge: (k) => blocked.delete(k),
    emit: (e) => events.push(e),
    blocked: () => blocked,
    newId: () => `INC-${++n}`,
    now: () => 0,
    addDamage: (d) => {
      damage.set(d.id, d);
      damageLog.push(d.state);
    },
    updateDamage: (id, p) => {
      Object.assign(damage.get(id)!, p);
      if (p.state) damageLog.push(p.state);
    },
    removeDamage: (id) => {
      damage.delete(id);
      damageLog.push("removed");
    },
    damageState: (id) => damage.get(id)?.state,
  };
  return { fx, incidents, blocked, events, statuses, damage, damageLog };
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const quiet = { firstEmergency: 1e9, firstCrash: 1e9 };

describe("AirportSim", () => {
  it("emergency landing: incident lifecycle, runway closed then reopened, crews return home", () => {
    const f = fake();
    const sim = new AirportSim(f.fx, rng(4), quiet);
    sim.request("emergency_landing");
    let closedSeen = false;
    for (let t = 0; t < 170; t += 0.05) {
      sim.step(0.05);
      if (sim.fleet.lock.closed) closedSeen = true;
    }
    expect(closedSeen).toBe(true);
    expect(f.statuses).toEqual([
      "emergency_landing:active",
      "emergency_landing:responding",
      "emergency_landing:clearing",
      "emergency_landing:cleared",
    ]);
    const inc = [...f.incidents.values()][0];
    expect(inc.note).toMatch(/Emergency landing: RV212 engine fire, runway 09 closed/);
    expect(f.events.map((e) => e.type)).toEqual(["incident:created", "incident:cleared"]);
    expect(sim.fleet.lock.closed).toBe(false);
    for (const u of sim.crew) expect(u.state).toBe("home");
    expect(sim.busy).toBe(false);
  });

  it("crash request: the doomed jet appears at once, even with every plane parked or busy, and hits within ~12 s", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const f = fake();
      const sim = new AirportSim(f.fx, rng(seed), quiet);
      // let traffic settle into an arbitrary state, then press the button
      for (let t = 0; t < seed * 23; t += 0.1) sim.step(0.1);
      sim.request("plane_crash");
      sim.step(0.1);
      expect(sim.crash).not.toBeNull();
      expect(sim.crash!.plane.phase).toBe("crashing");
      expect(sim.crash!.plane.pos.y).toBeGreaterThan(100);
      let impactAt = -1;
      for (let t = 0; t < 15 && impactAt < 0; t += 0.1) {
        sim.step(0.1);
        if (f.incidents.size && [...f.incidents.values()].some((i) => i.kind === "plane_crash")) impactAt = t;
      }
      expect(impactAt).toBeGreaterThan(6);
      expect(impactAt).toBeLessThan(12);
    }
  });

  it("emergency request starts within a frame even while a crash is on", () => {
    const f = fake();
    const sim = new AirportSim(f.fx, rng(3), quiet);
    sim.request("plane_crash");
    for (let t = 0; t < 20; t += 0.1) sim.step(0.1);
    sim.request("emergency_landing");
    sim.step(0.1);
    expect(sim.emergency).not.toBeNull();
    expect([...f.incidents.values()].some((i) => i.kind === "emergency_landing")).toBe(true);
  });

  it("city crash: damage zone, area sealed off, crews fight it, then rebuild and the crater goes once the zone is gone", () => {
    const f = fake();
    const sim = new AirportSim(f.fx, rng(9), quiet);
    sim.nextCrashSite = { x: 60, z: 100, kind: "city", where: "into downtown" };
    sim.request("plane_crash");
    let maxSealed = 0;
    let sprayed = false;
    let crewOnRoad = false;
    let t = 0;
    let clearedAt = -1;
    for (; t < 300 && clearedAt < 0; t += 0.05) {
      sim.step(0.05);
      maxSealed = Math.max(maxSealed, f.blocked.size);
      if (sim.crew.some((u) => u.spraying)) sprayed = true;
      if (sim.crew.some((u) => u.from && u.to)) crewOnRoad = true;
      if (f.statuses.includes("plane_crash:cleared")) clearedAt = t;
    }
    expect(maxSealed).toBeGreaterThan(1);
    expect(f.blocked.size).toBe(0);
    expect(sprayed).toBe(true);
    expect(crewOnRoad).toBe(true);
    expect(clearedAt).toBeGreaterThan(70);
    expect(f.statuses).toEqual(["plane_crash:active", "plane_crash:responding", "plane_crash:clearing", "plane_crash:cleared"]);
    const types = f.events.map((e) => e.type);
    expect(types[0]).toBe("incident:created");
    expect(types.filter((x) => x === "road:blocked").length).toBe(maxSealed);
    expect(types.filter((x) => x === "road:reopened").length).toBe(maxSealed);
    expect(types).toContain("incident:cleared");
    const inc = [...f.incidents.values()][0];
    expect(inc.note).toMatch(/Cargo jet RV880 crashed into downtown, area sealed off/);
    const dmg = [...f.damage.values()][0];
    expect(dmg).toMatchObject({ x: 60, z: 100, radius: DAMAGE_RADIUS, state: "rebuilding" });
    expect(f.damageLog).toEqual(["destroyed", "rebuilding"]);
    expect(sim.crater?.stage).toBe("rebuilding");
    // Buildings finishes the rebuild and removes the zone: the construction pad goes
    f.fx.removeDamage(dmg.id);
    sim.step(0.05);
    expect(sim.crater).toBeNull();
    for (let k = 0; k < 120; k += 0.05) sim.step(0.05);
    for (const u of sim.crew) expect(u.state).toBe("home");
  });

  it("field crash (rare alternative) still closes its road and clears", () => {
    const f = fake();
    const sim = new AirportSim(f.fx, rng(2), quiet);
    sim.nextCrashSite = CRASH_SITES[0];
    sim.request("plane_crash");
    let blockedSeen = false;
    for (let t = 0; t < 200; t += 0.05) {
      sim.step(0.05);
      if (f.blocked.has("h_0|h_15")) blockedSeen = true;
    }
    expect(blockedSeen).toBe(true);
    expect(f.blocked.size).toBe(0);
    expect(f.statuses).toContain("plane_crash:cleared");
  });
});
