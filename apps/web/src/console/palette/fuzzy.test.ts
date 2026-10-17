import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzyRank } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches an in-order subsequence, case-insensitive", () => {
    expect(fuzzyMatch("rcs", "Run case delivery-024")).not.toBeNull();
    expect(fuzzyMatch("RUN", "run case")).not.toBeNull();
  });

  it("rejects letters out of order or missing", () => {
    expect(fuzzyMatch("sr", "rs")).toBeNull();
    expect(fuzzyMatch("xyz", "Run case")).toBeNull();
  });

  it("needs every word of the query", () => {
    expect(fuzzyMatch("run 024", "Run case delivery-024")).not.toBeNull();
    expect(fuzzyMatch("run 025", "Run case delivery-024")).toBeNull();
  });

  it("empty query matches with score 0", () => {
    expect(fuzzyMatch("  ", "anything")).toEqual({ score: 0, ranges: [] });
  });

  it("scores word starts above mid-word hits", () => {
    const starts = fuzzyMatch("nc", "New case")!.score;
    const middle = fuzzyMatch("nc", "Open the city")?.score ?? -Infinity;
    expect(starts).toBeGreaterThan(middle);
  });

  it("scores consecutive letters above scattered ones", () => {
    expect(fuzzyMatch("city", "Open the city")!.score).toBeGreaterThan(fuzzyMatch("city", "Case runs in the year")?.score ?? -Infinity);
  });

  it("returns merged highlight ranges", () => {
    expect(fuzzyMatch("case", "Run case 1")!.ranges).toEqual([[4, 8]]);
    expect(fuzzyMatch("rc", "Run case")!.ranges).toEqual([[0, 1], [4, 5]]);
  });

  it("prefers the word-start letter over an earlier mid-word one", () => {
    // "c" should land on "crash", not the "c" inside "truck".
    expect(fuzzyMatch("tc", "Trigger: truck crash")!.ranges).toEqual([[0, 1], [15, 16]]);
  });
});

describe("fuzzyRank", () => {
  const items = [
    { title: "Go to Home" },
    { title: "New case" },
    { title: "Open the city" },
    { title: "Go to Settings", keywords: ["preferences"] },
  ];

  it("keeps input order for an empty query", () => {
    expect(fuzzyRank("", items).map((r) => r.item.title)).toEqual(items.map((i) => i.title));
  });

  it("ranks the best match first and drops non-matches", () => {
    const out = fuzzyRank("city", items).map((r) => r.item.title);
    expect(out[0]).toBe("Open the city");
    expect(out).not.toContain("Go to Home");
  });

  it("finds items by keyword, without highlights", () => {
    const out = fuzzyRank("prefs", items);
    expect(out[0].item.title).toBe("Go to Settings");
    expect(out[0].match.ranges).toEqual([]);
  });

  it("respects the limit and is stable for ties", () => {
    const same = [{ title: "a1" }, { title: "a2" }, { title: "a3" }];
    expect(fuzzyRank("a", same, 2).map((r) => r.item.title)).toEqual(["a1", "a2"]);
  });
});
