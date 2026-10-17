import { describe, expect, it } from "vitest";
import type { Flow } from "../types";
import flowJson from "../../../../api/flows/default-incident.json";
import { CARD_W, treeLayout, unmerge } from "./layout";
import { READ_ZOOM, START_MARGIN, bounds, canvasKey, cardCentre, pathTo, startViewport } from "./view";

const flow = flowJson as Flow;
const t = unmerge(flow);
const pos = treeLayout(t);

describe("startViewport", () => {
  it("opens at the reading zoom with the start step at the left, vertically centred", () => {
    const v = startViewport(t, pos, { width: 1000, height: 700 })!;
    expect(v.zoom).toBe(READ_ZOOM);
    const sp = pos[t.roots[0]];
    expect(sp.x * v.zoom + v.x).toBeCloseTo(START_MARGIN);
    const c = cardCentre(t, pos, t.roots[0])!;
    expect(c.y * v.zoom + v.y).toBeCloseTo(350);
  });
  it("centres the whole playbook when it fits at the reading zoom", () => {
    const b = bounds(t, pos)!;
    const size = { width: b.w * READ_ZOOM + 400, height: b.h * READ_ZOOM + 400 };
    const v = startViewport(t, pos, size)!;
    expect((b.x + b.w / 2) * v.zoom + v.x).toBeCloseTo(size.width / 2);
    expect((b.y + b.h / 2) * v.zoom + v.y).toBeCloseTo(size.height / 2);
  });
  it("gives up without a size or nodes", () => {
    expect(startViewport(t, pos, { width: 0, height: 0 })).toBeNull();
    expect(startViewport(unmerge({ nodes: [], edges: [] }), {}, { width: 800, height: 600 })).toBeNull();
  });
});

describe("bounds", () => {
  it("covers every card", () => {
    const b = bounds(t, pos)!;
    for (const d of t.nodes) {
      expect(pos[d.id].x).toBeGreaterThanOrEqual(b.x);
      expect(pos[d.id].x + CARD_W).toBeLessThanOrEqual(b.x + b.w);
    }
  });
});

describe("pathTo", () => {
  it("walks from the start to the selected step", () => {
    const p = pathTo(t, "gate");
    expect([...p.nodes].map((id) => t.byId.get(id)!.nodeId).sort()).toEqual(
      ["clash", "gate", "history", "ingest", "perspectives", "planner", "triage"],
    );
    expect(p.edges.size).toBe(6);
  });
  it("covers every drawn copy of a shared step", () => {
    const copies = t.nodes.filter((d) => d.nodeId === "log");
    expect(copies.length).toBeGreaterThan(1);
    const p = pathTo(t, "log");
    for (const c of copies) expect(p.nodes.has(c.id)).toBe(true);
    for (const id of p.edges) expect(p.nodes.has(t.edges.find((e) => e.id === id)!.target)).toBe(true);
  });
  it("is empty with nothing selected", () => {
    expect(pathTo(t, null).nodes.size).toBe(0);
    expect(pathTo(t, "nope").edges.size).toBe(0);
  });
});

describe("canvasKey", () => {
  it("maps F, 1 and Esc, and ignores modified keys", () => {
    expect(canvasKey({ key: "f" })).toBe("fit");
    expect(canvasKey({ key: "F" })).toBe("fit");
    expect(canvasKey({ key: "1" })).toBe("zoom100");
    expect(canvasKey({ key: "Escape" })).toBe("deselect");
    expect(canvasKey({ key: "f", metaKey: true })).toBeNull();
    expect(canvasKey({ key: "1", ctrlKey: true })).toBeNull();
    expect(canvasKey({ key: "a" })).toBeNull();
  });
});
