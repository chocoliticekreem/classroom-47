import { describe, expect, it } from "vitest";
import { RunwayLock } from "./runway";

describe("RunwayLock", () => {
  it("is held by one plane at a time", () => {
    const l = new RunwayLock();
    expect(l.tryArrival(1)).toBe(true);
    expect(l.tryArrival(2)).toBe(false);
    expect(l.tryDeparture(3, Infinity)).toBe(false);
    expect(l.holder).toBe(1);
    l.release(2); // not the holder: no-op
    expect(l.holder).toBe(1);
    l.release(1);
    expect(l.holder).toBe(null);
    expect(l.tryDeparture(3, Infinity)).toBe(true);
  });

  it("re-acquiring by the holder succeeds", () => {
    const l = new RunwayLock();
    l.tryArrival(1);
    expect(l.tryArrival(1)).toBe(true);
  });

  it("keeps departures off the runway when an arrival is close", () => {
    const l = new RunwayLock();
    expect(l.tryDeparture(1, 10)).toBe(false);
    expect(l.tryDeparture(1, 60)).toBe(true);
  });

  it("closed runway refuses everyone except a forced (emergency) holder", () => {
    const l = new RunwayLock();
    l.closed = true;
    expect(l.tryArrival(1)).toBe(false);
    expect(l.tryDeparture(2, Infinity)).toBe(false);
    l.force(7);
    expect(l.holder).toBe(7);
    l.release(7);
    expect(l.holder).toBe(null);
    expect(l.tryArrival(1)).toBe(false);
    l.closed = false;
    expect(l.tryArrival(1)).toBe(true);
  });
});
