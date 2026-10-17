import { describe, expect, it } from "vitest";
import { ROAD_NODES, getNode, neighbours } from "../../roads";
import { hasSignal } from "../../signals";
import { lampPosts, signalHeads, zebraCrossings, SIGNAL_KERB, SIGNAL_SETBACK } from "./layout";

describe("signalHeads", () => {
  const heads = signalHeads();

  it("has one head per approach of every signalled junction", () => {
    let approaches = 0;
    for (const n of ROAD_NODES.values()) if (hasSignal(n.id)) approaches += neighbours(n.id).length;
    expect(heads.length).toBe(approaches);
    expect(heads.every((h) => hasSignal(h.node))).toBe(true);
  });

  it("sits on the near-side LEFT kerb before the junction (UK)", () => {
    // approaching g_0_0 from the south (g_0_1, travelling -z): left of travel is -x
    const h = heads.find((x) => x.node === "g_0_0" && x.from === "g_0_1")!;
    expect(h.x).toBeCloseTo(-SIGNAL_KERB);
    expect(h.z).toBeCloseTo(SIGNAL_SETBACK);
    // approaching from the west (g_-1_0, travelling +x): left of travel is -z
    const w = heads.find((x) => x.node === "g_0_0" && x.from === "g_-1_0")!;
    expect(w.x).toBeCloseTo(-SIGNAL_SETBACK);
    expect(w.z).toBeCloseTo(-SIGNAL_KERB);
  });

  it("faces the oncoming driver", () => {
    for (const h of heads) {
      const f = getNode(h.from);
      const fx = Math.sin(h.yaw);
      const fz = Math.cos(h.yaw);
      // facing vector points back toward the from-node
      expect(fx * (f.x - h.x) + fz * (f.z - h.z)).toBeGreaterThan(0);
    }
  });

  it("puts the four heads of a junction on four different corners", () => {
    const at = heads.filter((h) => h.node === "g_1_1");
    const corners = new Set(at.map((h) => `${Math.sign(h.x - 40)},${Math.sign(h.z - 40)}`));
    expect(corners.size).toBe(4);
  });
});

describe("lampPosts", () => {
  const lamps = lampPosts();

  it("lines downtown streets and the highway", () => {
    expect(lamps.length).toBeGreaterThan(600);
    expect(lamps.some((l) => Math.abs(l.x) > 215 || Math.abs(l.z) > 215)).toBe(true);
  });

  it("keeps clear of junctions", () => {
    for (const l of lamps)
      for (const n of ROAD_NODES.values()) expect(Math.hypot(l.x - n.x, l.z - n.z)).toBeGreaterThan(6);
  });

  it("arms point toward the road", () => {
    // a lamp on the street x = 0 (between g_0_0 and g_0_1) must point toward x = 0
    const l = lamps.find((p) => Math.abs(Math.abs(p.x) - 5) < 0.01 && p.z > 0 && p.z < 40)!;
    expect(Math.sign(Math.sin(l.yaw))).toBe(-Math.sign(l.x));
  });
});

describe("zebraCrossings", () => {
  it("lies on downtown streets, off the junctions, away from lamps", () => {
    const zs = zebraCrossings();
    const lamps = lampPosts();
    expect(zs.length).toBeGreaterThanOrEqual(6);
    for (const z of zs) {
      expect(neighbours(z.a)).toContain(z.b);
      for (const l of lamps) expect(Math.hypot(l.x - z.x, l.z - z.z)).toBeGreaterThan(4);
    }
  });
});
