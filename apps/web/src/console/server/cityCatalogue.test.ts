import { describe, expect, it } from "vitest";
import { pickerPage, pickerSetOf } from "./cityCatalogue";

const all = [
  ...Array.from({ length: 120 }, (_, i) => ({ id: `bulk-${String(i + 1).padStart(4, "0")}`, dataset: "bulk", title: `Bulk case ${i + 1}` })),
  { id: "delivery-001", dataset: "public", title: "Recipient cannot attend" },
  { id: "gen-1001", dataset: "generated", title: "Damaged lamp" },
  { id: "gen-1002", dataset: "grounded", title: "Grounded one" },
  { id: "city-001", dataset: "city", title: "Road closed at the bridge" },
  { id: "adhoc-x", dataset: "adhoc", title: "One-off" },
];

describe("pickerPage", () => {
  it("counts every set and leaves one-off cases out", () => {
    const p = pickerPage(all, {});
    expect(p.total).toBe(124);
    expect(p.sets.find((s) => s.id === "bulk")?.count).toBe(120);
    expect(p.sets.find((s) => s.id === "generated")?.count).toBe(2);
    expect(p.sets.find((s) => s.id === "haiku")?.count).toBe(0);
    expect(pickerSetOf("adhoc")).toBeNull();
  });

  it("pages 50 at a time", () => {
    const first = pickerPage(all, { set: "bulk" });
    expect(first.matched).toBe(120);
    expect(first.cases).toHaveLength(50);
    expect(first.cases[0].id).toBe("bulk-0001");
    const last = pickerPage(all, { set: "bulk", offset: 100 });
    expect(last.cases.map((c) => c.id)).toEqual(Array.from({ length: 20 }, (_, i) => `bulk-${String(101 + i).padStart(4, "0")}`));
    expect(pickerPage(all, { set: "bulk", offset: "junk", limit: 9999 }).cases).toHaveLength(120);
  });

  it("filters by set and search (id or title, any case)", () => {
    expect(pickerPage(all, { set: "generated" }).cases.map((c) => c.id)).toEqual(["gen-1001", "gen-1002"]);
    expect(pickerPage(all, { q: "BRIDGE" }).cases.map((c) => c.id)).toEqual(["city-001"]);
    expect(pickerPage(all, { set: "nope", q: "delivery-001" }).matched).toBe(1);
    expect(pickerPage(all, { set: "public", q: "bulk" }).matched).toBe(0);
  });
});
