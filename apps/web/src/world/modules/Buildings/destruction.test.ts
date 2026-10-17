import { beforeAll, describe, expect, it } from "vitest";
import type { DamageZone } from "../../store";
import { build } from "./build";
import { groupFootprints, groupsInCircle } from "./damage";
import { Destruction } from "./destruction";
import { generateCity } from "./layout";

// Minimal canvas stub so the procedural textures can be "drawn" under node.
beforeAll(() => {
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : () => ({ addColorStop: () => {} })),
    set: (t, k, v) => ((t[k as string] = v), true),
  });
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  };
});

function zone(state: DamageZone["state"]): DamageZone {
  return { id: "z1", x: 60, z: 60, radius: 18, state, cause: "test", createdAt: 0 };
}

function run(fx: Destruction, seconds: number) {
  for (let t = 0; t < seconds; t += 0.1) fx.update(0.1);
}

describe("Destruction controller", () => {
  it("collapses, stays down, rebuilds, then restores exact matrices and reports the zone", () => {
    const city = generateCity(20261010);
    const built = build(city);
    const restored: string[] = [];
    const fx = new Destruction(built, city, (id) => restored.push(id));
    const hit = groupsInCircle(groupFootprints(city), 60, 60, 18);
    expect(hit.length).toBeGreaterThan(0);
    const ref = built.groups[hit[0]].inst.find((r) => !r.prop)!;
    const before = Array.from(ref.mesh.instanceMatrix.array.slice(ref.index * 16, ref.index * 16 + 16));

    fx.sync([zone("destroyed")]);
    run(fx, 1.2);
    const mid = Array.from(ref.mesh.instanceMatrix.array.slice(ref.index * 16, ref.index * 16 + 16));
    expect(mid).not.toEqual(before); // sinking / tilting

    run(fx, 10);
    const down = Array.from(ref.mesh.instanceMatrix.array.slice(ref.index * 16, ref.index * 16 + 16));
    expect(down.slice(0, 15).every((v) => v === 0)).toBe(true); // scaled to nothing while destroyed
    expect(restored).toEqual([]);

    fx.sync([zone("rebuilding")]);
    run(fx, 20);
    expect(restored).toEqual([]); // still rising
    run(fx, 20);
    expect(restored).toEqual(["z1"]);
    const after = Array.from(ref.mesh.instanceMatrix.array.slice(ref.index * 16, ref.index * 16 + 16));
    expect(after).toEqual(before);
    // every instance of every hit group is back exactly
    for (const g of hit)
      for (const r of built.groups[g].inst)
        expect(Array.from(r.mesh.instanceMatrix.array.slice(r.index * 16, r.index * 16 + 16))).toEqual(Array.from(r.orig.slice(r.index * 16, r.index * 16 + 16)));
  });

  it("rebuilding requested mid-collapse waits for the collapse to finish", () => {
    const city = generateCity(20261010);
    const built = build(city);
    const restored: string[] = [];
    const fx = new Destruction(built, city, (id) => restored.push(id));
    fx.sync([zone("destroyed")]);
    run(fx, 0.5);
    fx.sync([zone("rebuilding")]);
    run(fx, 45);
    expect(restored).toEqual(["z1"]);
  });

  it("a zone removed externally puts buildings straight back", () => {
    const city = generateCity(20261010);
    const built = build(city);
    const fx = new Destruction(built, city, () => {});
    const hit = groupsInCircle(groupFootprints(city), 60, 60, 18);
    fx.sync([zone("destroyed")]);
    run(fx, 5);
    fx.sync([]);
    for (const g of hit)
      for (const r of built.groups[g].inst)
        expect(Array.from(r.mesh.instanceMatrix.array.slice(r.index * 16, r.index * 16 + 16))).toEqual(Array.from(r.orig.slice(r.index * 16, r.index * 16 + 16)));
  });
});
