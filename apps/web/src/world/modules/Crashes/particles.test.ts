import { describe, expect, it } from "vitest";
import { DebrisPool, DecalPool, ParticlePool } from "./particles";

describe("ParticlePool", () => {
  it("spawns, moves, fades and dies", () => {
    const p = new ParticlePool(4);
    p.spawn({ x: 0, y: 1, z: 0, vx: 0, vy: 2, vz: 0, life: 1, size0: 1, size1: 3, alpha: 1, r: 1, g: 0, b: 0 });
    expect(p.aliveCount()).toBe(1);
    p.update(0.5);
    expect(p.pos[1]).toBeGreaterThan(1);
    expect(p.params[0]).toBeGreaterThan(1); // size grows
    expect(p.params[1]).toBeGreaterThan(0); // still visible
    p.update(0.6);
    expect(p.aliveCount()).toBe(0);
    expect(p.params[1]).toBe(0);
  });

  it("recycles the oldest slot when full", () => {
    const p = new ParticlePool(2);
    for (let i = 0; i < 5; i++) p.spawn({ x: i, y: 0, z: 0, life: 10 });
    expect(p.aliveCount()).toBe(2);
  });

  it("can kill everything belonging to one owner", () => {
    const p = new ParticlePool(4);
    p.spawn({ x: 0, y: 0, z: 0, life: 10, owner: 1 });
    p.spawn({ x: 0, y: 0, z: 0, life: 10, owner: 2 });
    p.killOwner(1);
    expect(p.aliveCount()).toBe(1);
  });
});

describe("DebrisPool", () => {
  it("falls, bounces, settles on the ground and is removed with its owner", () => {
    const d = new DebrisPool(8, 0.5);
    d.spawn({ x: 0, y: 1, z: 0, vx: 3, vy: 5, vz: 0, scale: 1, r: 1, g: 1, b: 1, owner: 2 });
    for (let i = 0; i < 300; i++) d.update(1 / 60);
    expect(d.state[0]).toBe(2);
    expect(d.pos[1]).toBeCloseTo(0.54, 2);
    expect(d.pos[0]).toBeGreaterThan(0);
    d.killOwner(2);
    expect(d.state[0]).toBe(0);
    expect(d.scale[0]).toBe(0);
  });
});

describe("DecalPool", () => {
  it("adds strips with length/heading and clears them per owner", () => {
    const d = new DecalPool(4);
    d.add(0, 0, 0, 10, 0.3, 1);
    d.add(0, 0, 3, 4, 0.3, 2);
    expect(d.len[0]).toBeCloseTo(10);
    expect(d.yaw[0]).toBeCloseTo(0);
    expect(d.len[1]).toBeCloseTo(5);
    d.killOwner(1);
    expect(d.count()).toBe(1);
  });
});
