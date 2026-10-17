import { describe, expect, it, vi } from "vitest";
import { getScenario, SCENARIOS } from "../../scenarios";
import { fetchPage, pageUrl, prepareCase } from "./catalogueClient";

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe("pageUrl", () => {
  it("leaves defaults out", () => {
    expect(pageUrl("all", " ", 0)).toBe("/api/console/city/catalogue");
    expect(pageUrl("bulk", "lamp", 50)).toBe("/api/console/city/catalogue?set=bulk&q=lamp&offset=50");
  });
});

describe("fetchPage", () => {
  it("throws on a failed request", async () => {
    await expect(fetchPage("all", "", 0, () => Promise.resolve(new Response("x", { status: 500 })))).rejects.toThrow("catalogue 500");
  });
});

describe("prepareCase", () => {
  it("stages a bundled public case without a request", async () => {
    const f = vi.fn();
    const pub = SCENARIOS[0];
    await expect(prepareCase({ id: pub.id, dataset: "public", title: pub.title }, f)).resolves.toBe(pub.id);
    expect(f).not.toHaveBeenCalled();
  });

  it("fetches and registers any other case as a generic scenario", async () => {
    const f = vi.fn(() =>
      ok({ case: { id: "gen-1001", dataset: "generated", title: "Case: Damaged lamp", view: { context: "c", events: [{ n: 1, timestamp: "", stage: "Escalation", channel: "Email", from: "A", to: "B", body: "It arrived broken." }] } } }),
    );
    await expect(prepareCase({ id: "gen-1001", dataset: "generated", title: "Case: Damaged lamp" }, f)).resolves.toBe("gen-1001");
    expect(f).toHaveBeenCalledWith("/api/console/city/catalogue?id=gen-1001&dataset=generated");
    expect(getScenario("gen-1001")).toMatchObject({ title: "Damaged lamp", scene: "damage_evidence", dataset: "generated" });
    // Second pick of the same case: already registered, no request.
    await prepareCase({ id: "gen-1001", dataset: "generated", title: null }, f);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown case", async () => {
    const f = () => Promise.resolve(new Response(JSON.stringify({ error: "unknown case" }), { status: 404 }));
    await expect(prepareCase({ id: "nope", dataset: "bulk", title: null }, f)).rejects.toThrow("unknown case");
  });
});
