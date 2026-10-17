import { describe, expect, it } from "vitest";
import { linkKey, pickLinks, type RunLinkRow } from "./runLinks";

const r = (id: string, origin: string, startedAt: string, over: Partial<RunLinkRow> = {}): RunLinkRow => ({
  id, caseId: "gen-1201", runId: "api-1", origin, status: "success", startedAt, ...over,
});

describe("pickLinks", () => {
  it("links a card to the console's own run before the imported copy", () => {
    const links = pickLinks([r("imported", "runs", "2026-10-10T12:40:00Z"), r("console", "console", "2026-10-10T12:35:00Z")]);
    expect(links.get(linkKey("api-1", "gen-1201"))).toBe("console");
  });
  it("takes the newest of equal rank, and skips unfinished rows or rows without a runId", () => {
    const links = pickLinks([
      r("old", "console", "2026-10-10T10:00:00Z"), r("new", "voice", "2026-10-10T11:00:00Z"),
      r("err", "console", "2026-10-10T12:00:00Z", { status: "error" }), r("none", "console", "2026-10-10T13:00:00Z", { runId: null }),
    ]);
    expect(links.get(linkKey("api-1", "gen-1201"))).toBe("new");
    expect(links.size).toBe(1);
  });
  it("keys by runId and caseId together", () => {
    const links = pickLinks([r("a", "console", "t", { caseId: "x" }), r("b", "console", "t", { caseId: "y" })]);
    expect(links.get(linkKey("api-1", "x"))).toBe("a");
    expect(links.get(linkKey("api-1", "y"))).toBe("b");
  });
});
