import { describe, expect, it } from "vitest";
import { METRO_LINES } from "../Transit/metroLayout";
import { buildCrowd, KIND, MAX_PEOPLE, MIN_PEOPLE } from "./population";
import { dogTris, personTris, umbrellaTris } from "./meshes";

const stations = METRO_LINES.flatMap((l) => l.stations);
const crowd = buildCrowd(stations, 42);

describe("crowd attribute layout", () => {
  it("is deterministic for a seed", () => {
    const again = buildCrowd(stations, 42);
    for (const k of ["people", "umbrellas", "dogs"] as const)
      for (const a of ["aWalk", "aLook", "aShirt", "aPants"] as const) expect(again[k][a]).toEqual(crowd[k][a]);
    expect(again.packed.points).toEqual(crowd.packed.points);
    expect(buildCrowd(stations, 43).people.aWalk).not.toEqual(crowd.people.aWalk);
  });

  it("packs four floats per instance per attribute and stays within the crowd budget", () => {
    const p = crowd.people;
    expect(p.count).toBeGreaterThanOrEqual(MIN_PEOPLE);
    expect(p.count).toBeLessThanOrEqual(MAX_PEOPLE + 60); // plus the park groups and the wheel queue
    for (const a of [p.aWalk, p.aLook, p.aShirt, p.aPants]) expect(a.length).toBe(p.count * 4);
  });

  it("walkers reference real paths with a start inside the loop; loiterers stand still at a spot", () => {
    const p = crowd.people;
    const nPaths = crowd.paths.length;
    let walkers = 0;
    let loiterers = 0;
    for (let i = 0; i < p.count; i++) {
      const [pathId, s0, speed] = p.aWalk.slice(i * 4, i * 4 + 3);
      const kind = p.aLook[i * 4 + 1];
      if (kind === KIND.loiterer) {
        loiterers++;
        expect(pathId).toBe(-1);
        expect(Number.isFinite(s0) && Number.isFinite(speed)).toBe(true);
      } else {
        walkers++;
        expect(Number.isInteger(pathId) && pathId >= 0 && pathId < nPaths).toBe(true);
        expect(s0).toBeGreaterThanOrEqual(0);
        expect(s0).toBeLessThan(crowd.packed.lengths[pathId]);
        expect(Math.abs(speed)).toBeGreaterThan(0.7);
        expect(Math.abs(speed)).toBeLessThan(kind === KIND.jogger ? 3.7 : 1.9);
      }
    }
    expect(walkers).toBeGreaterThan(loiterers * 5);
    expect(loiterers).toBeGreaterThan(100);
  });

  it("has variety: joggers, umbrellas, dog walkers and commuters, with one umbrella/dog mesh instance each", () => {
    const kinds = new Map<number, number>();
    const p = crowd.people;
    for (let i = 0; i < p.count; i++) kinds.set(p.aLook[i * 4 + 1], (kinds.get(p.aLook[i * 4 + 1]) ?? 0) + 1);
    for (const k of Object.values(KIND)) expect(kinds.get(k) ?? 0).toBeGreaterThan(0);
    expect(crowd.umbrellas.count).toBe(kinds.get(KIND.umbrella));
    expect(crowd.dogs.count).toBe(kinds.get(KIND.dogWalker));
    // umbrellas move in lockstep with their owners
    expect(crowd.umbrellas.aWalk[0]).toBe(crowd.people.aWalk[findKind(KIND.umbrella) * 4]);
  });

  it("puts more people downtown than anywhere else", () => {
    const zoneOf = crowd.paths.map((p) => p.zone);
    const byZone = new Map<string, number>();
    const p = crowd.people;
    for (let i = 0; i < p.count; i++) {
      const id = p.aWalk[i * 4];
      if (id >= 0) byZone.set(zoneOf[id], (byZone.get(zoneOf[id]) ?? 0) + 1);
    }
    const downtown = byZone.get("downtown") ?? 0;
    for (const [z, n] of byZone) if (z !== "downtown") expect(downtown).toBeGreaterThan(n);
  });

  it("commuters stream on station paths", () => {
    expect(crowd.paths.some((p) => p.kind === "commuter")).toBe(true);
  });
});

describe("low-poly meshes", () => {
  it("person is 40-60 triangles; umbrella and dog stay small", () => {
    expect(personTris().triangles).toBeGreaterThanOrEqual(40);
    expect(personTris().triangles).toBeLessThanOrEqual(60);
    expect(umbrellaTris().triangles).toBeLessThanOrEqual(20);
    expect(dogTris().triangles).toBeLessThanOrEqual(60);
  });
});

function findKind(k: number) {
  const p = crowd.people;
  for (let i = 0; i < p.count; i++) if (p.aLook[i * 4 + 1] === k) return i;
  return -1;
}
