import { Object3D } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { registerVehicle, type VehicleEntry, type VehicleKind } from "../../registry";
import { corridorEntry, footprint, nearby, obbOverlap, obstacleAhead, overlapping, pairMtv, rebuildSpatialIndex } from "../../physics";

const offs: (() => void)[] = [];
afterEach(() => {
  for (const o of offs.splice(0)) o();
});

function add(id: string, x: number, z: number, h: number, kind: VehicleKind = "car", stopped = false, half?: number): VehicleEntry {
  const object = new Object3D();
  object.position.set(x, 0, z);
  object.rotation.y = h;
  if (half !== undefined) object.userData.half = half;
  const v: VehicleEntry = { id, kind, object, edgeKey: null, from: null, to: null, t: 0, speed: stopped ? 0 : 10, stopped };
  offs.push(registerVehicle(v));
  return v;
}

// seeded PRNG so failures reproduce
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe("obbOverlap (SAT)", () => {
  it("detects axis-aligned overlap and separation", () => {
    expect(obbOverlap(0, 0, 0, 1, 2, 1, 0, 3.5, 0, 1, 2, 1)).toBeCloseTo(0.5);
    expect(obbOverlap(0, 0, 0, 1, 2, 1, 0, 4.5, 0, 1, 2, 1)).toBeLessThanOrEqual(0);
    expect(obbOverlap(0, 0, 0, 1, 2, 1, 2.5, 0, 0, 1, 2, 1)).toBeLessThanOrEqual(0);
  });
  it("uses the rotated axes: a diagonal box clears a corner the AABBs would hit", () => {
    const s = Math.SQRT1_2;
    // B rotated 45°, centre diagonally off A's corner: AABBs overlap, OBBs don't
    expect(obbOverlap(0, 0, 0, 1, 1, 1, 2.0, 2.0, s, s, 1, 1)).toBeLessThanOrEqual(0);
    expect(obbOverlap(0, 0, 0, 1, 1, 1, 1.4, 1.4, s, s, 1, 1)).toBeGreaterThan(0);
  });
  it("T-bone: perpendicular boxes overlap with the right minimum translation", () => {
    // A along z, B along x, B's nose 0.4 m into A's side
    const d = obbOverlap(0, 0, 0, 1, 2.2, 0.95, 0.95 + 2.2 - 0.4, 0, -1, 0, 2.2, 0.95);
    expect(d).toBeCloseTo(0.4);
  });
});

describe("corridorEntry", () => {
  it("returns the distance to the near edge of a box straight ahead", () => {
    // ray from origin along +z, car 20 m ahead pointing the same way, half length 2.2
    expect(corridorEntry(0, 0, 0, 1, 50, 1.2, 0, 20, 0, 1, 2.2, 0.95)).toBeCloseTo(17.8);
  });
  it("misses boxes beside the corridor and beyond range", () => {
    expect(corridorEntry(0, 0, 0, 1, 50, 1.2, 4, 20, 0, -1, 2.2, 0.95)).toBe(-1); // oncoming lane
    expect(corridorEntry(0, 0, 0, 1, 10, 1.2, 0, 20, 0, 1, 2.2, 0.95)).toBe(-1);
    expect(corridorEntry(0, 0, 0, 1, 50, 1.2, 0, -10, 0, 1, 2.2, 0.95)).toBe(-1); // behind
  });
  it("catches a perpendicular box crossing the corridor whose centre is outside it", () => {
    // lorry crossing left to right, centre 4 m to the side, 15 m ahead; its long body spans the corridor
    expect(corridorEntry(0, 0, 0, 1, 50, 1.2, 4, 15, 1, 0, 5.5, 1.3)).toBeCloseTo(13.7);
  });
  it("is 0 when the box overlaps the ray origin", () => {
    expect(corridorEntry(0, 0, 0, 1, 50, 1.2, 0, 1, 0, 1, 2.2, 0.95)).toBe(0);
  });
  it("works for rotated rays", () => {
    const h = 0.7;
    const dx = Math.sin(h);
    const dz = Math.cos(h);
    expect(corridorEntry(10, 10, dx, dz, 50, 1.2, 10 + dx * 30, 10 + dz * 30, dx, dz, 2, 1)).toBeCloseTo(28);
  });
});

describe("obstacleAhead", () => {
  it("finds the nearest vehicle in the corridor and skips itself", () => {
    add("self", 0, 0, 0);
    add("far", 0, 40, 0);
    add("near", 0.5, 20, 0.2, "truck", true);
    add("side", 6, 10, 0);
    rebuildSpatialIndex();
    const hit = obstacleAhead("self", 0, 2.2, 0, 60);
    expect(hit?.id).toBe("near");
    expect(hit?.kind).toBe("truck");
    expect(hit?.stopped).toBe(true);
    expect(hit!.dist).toBeGreaterThan(10);
    expect(hit!.dist).toBeLessThan(18);
  });
  it("honours userData.half", () => {
    add("self", 0, 0, 0);
    add("long", 0, 30, 0, "car", false, 8);
    rebuildSpatialIndex();
    expect(obstacleAhead("self", 0, 0, 0, 60)!.dist).toBeCloseTo(22);
  });
  it("matches a brute-force scan over random traffic (spatial hash correctness)", () => {
    const r = rng(42);
    const all: VehicleEntry[] = [];
    const kinds: VehicleKind[] = ["car", "taxi", "van", "truck", "bus"];
    for (let i = 0; i < 400; i++)
      all.push(add(`v${i}`, (r() - 0.5) * 600, (r() - 0.5) * 600, r() * Math.PI * 2, kinds[Math.floor(r() * kinds.length)]));
    // a few far outside the grid, to exercise clamping
    all.push(add("out1", 1500, 1500, 0), add("out2", 1504, 1500, 1.2), add("out3", -1700, 20, 2));
    rebuildSpatialIndex();
    for (let q = 0; q < 300; q++) {
      const self = all[Math.floor(r() * all.length)];
      const h = r() * Math.PI * 2;
      const range = 5 + r() * 60;
      const hwid = 0.6 + r() * 1.2;
      const x = self.object.position.x;
      const z = self.object.position.z;
      let bestD = Infinity;
      for (const v of all) {
        if (v.id === self.id) continue;
        const fp = footprint(v.kind);
        const L = typeof v.object.userData.half === "number" ? v.object.userData.half : fp.halfLength;
        const d = corridorEntry(x, z, Math.sin(h), Math.cos(h), range, hwid, v.object.position.x, v.object.position.z, Math.sin(v.object.rotation.y), Math.cos(v.object.rotation.y), L, fp.halfWidth);
        if (d >= 0 && d < bestD) bestD = d;
      }
      const got = obstacleAhead(self.id, x, z, h, range, hwid);
      if (bestD === Infinity) expect(got).toBeNull();
      else expect(got!.dist).toBeCloseTo(bestD, 3);
    }
  });
});

describe("overlapping", () => {
  it("matches brute-force SAT over all pairs", () => {
    const r = rng(7);
    const all: VehicleEntry[] = [];
    for (let i = 0; i < 500; i++) all.push(add(`o${i}`, (r() - 0.5) * 300, (r() - 0.5) * 300, r() * 6.3, r() < 0.2 ? "truck" : "car", r() < 0.3));
    all.push(add("e1", 1300, 0, 0), add("e2", 1301, 2, 0.3));
    rebuildSpatialIndex();
    const expected = new Set<string>();
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i];
        const b = all[j];
        if (a.stopped && b.stopped) continue;
        const fa = footprint(a.kind);
        const fb = footprint(b.kind);
        const o = obbOverlap(a.object.position.x, a.object.position.z, Math.sin(a.object.rotation.y), Math.cos(a.object.rotation.y), fa.halfLength, fa.halfWidth,
          b.object.position.x, b.object.position.z, Math.sin(b.object.rotation.y), Math.cos(b.object.rotation.y), fb.halfLength, fb.halfWidth);
        if (o > 0) expected.add([a.id, b.id].sort().join("|"));
      }
    const got = new Set(overlapping().map(([a, b]) => [a.id, b.id].sort().join("|")));
    expect(expected.size).toBeGreaterThan(5);
    expect(expected.has("e1|e2")).toBe(true);
    expect(got).toEqual(expected);
  });
  it("skips pairs of stopped vehicles unless asked, and reports the MTV", () => {
    add("p1", 0, 0, 0, "car", true);
    add("p2", 0, 3, 0, "car", true);
    add("m1", 50, 0, 0);
    add("m2", 50, 4, 0);
    rebuildSpatialIndex();
    const pairs = overlapping();
    expect(pairs.length).toBe(1);
    const m = pairMtv(0);
    expect(m.depth).toBeCloseTo(0.4);
    expect(Math.abs(m.nz)).toBeCloseTo(1);
    expect(overlapping(true).length).toBe(2);
  });
});

describe("nearby", () => {
  it("matches a brute-force radius scan", () => {
    const r = rng(3);
    const all: VehicleEntry[] = [];
    for (let i = 0; i < 300; i++) all.push(add(`n${i}`, (r() - 0.5) * 400, (r() - 0.5) * 400, 0));
    rebuildSpatialIndex();
    const out: VehicleEntry[] = [];
    for (let q = 0; q < 50; q++) {
      const x = (r() - 0.5) * 400;
      const z = (r() - 0.5) * 400;
      const rad = 5 + r() * 40;
      const want = all.filter((v) => Math.hypot(v.object.position.x - x, v.object.position.z - z) <= rad).map((v) => v.id).sort();
      expect(nearby(x, z, rad, out).map((v) => v.id).sort()).toEqual(want);
    }
  });
});
