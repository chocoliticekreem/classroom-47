import { describe, expect, it } from "vitest";
import { toCaseView } from "./agentBridge";
import { cleanTitle, genericScenario, pickScene } from "./genericScenario";
import { getScenario, registerScenario, SCENARIOS } from "./scenarios";

const picked = {
  id: "bulk-0001",
  dataset: "bulk",
  title: "Case: Unidentified sender asks to redirect a parcel",
  view: {
    context: "A message from someone the desk has no record of.",
    initial_request: "Send it to my work address.",
    events: [
      { n: 1, timestamp: "t1", stage: "Context", channel: "Email", from: "Dispatch", to: "Desk", body: "DL-3255 is booked." },
      { n: 2, timestamp: "t2", stage: "Escalation", channel: "Email", from: "Nerys", to: "Desk", body: "Send it to my work address." },
    ],
  },
};

describe("pickScene", () => {
  it("maps keywords to a scene and defaults to a door in the suburbs", () => {
    expect(pickScene("Parcel held at customs for an invoice")).toEqual({ scene: "customs_invoice", where: "docks" });
    expect(pickScene("Damaged lamp")).toEqual({ scene: "damage_evidence", where: "suburbs" });
    expect(pickScene("Redirect to work")).toEqual({ scene: "failed_attempt_dispute", where: "suburbs" });
  });
  it("never picks a scene with side effects", () => {
    expect(pickScene("storm closes the road, van breakdown").scene).not.toMatch(/severe_weather|vehicle_breakdown/);
  });
});

describe("genericScenario", () => {
  it("keeps the case's own view and a clean title", () => {
    const s = genericScenario(picked);
    expect(s).toMatchObject({ id: "bulk-0001", dataset: "bulk", title: "Unidentified sender asks to redirect a parcel", sign: "BULK-0001" });
    const v = toCaseView(s, ["noise"]);
    expect(v.id).toBe("city-bulk-0001");
    expect(v.context).toBe(picked.view.context);
    expect(v.events.map((e) => e.body)).toEqual(["DL-3255 is booked.", "Send it to my work address.", expect.stringContaining("newsletter")]);
    expect(v.events[2]).toMatchObject({ n: 3, source: "simulated_persona" });
  });
  it("falls back to the opening request when the view has no events", () => {
    const s = genericScenario({ ...picked, view: { ...picked.view, events: [] } });
    expect(toCaseView(s, []).events).toEqual([expect.objectContaining({ body: "Send it to my work address.", stage: "Escalation" })]);
  });
  it("cleans titles", () => {
    expect(cleanTitle("Case 012: Van broke down", "x")).toBe("Van broke down");
    expect(cleanTitle(null, "gen-1001")).toBe("gen-1001");
  });
});

describe("registerScenario", () => {
  it("adds extra cases without shadowing the 50 public ones", () => {
    registerScenario(genericScenario(picked));
    expect(getScenario("bulk-0001")?.dataset).toBe("bulk");
    const pub = SCENARIOS[0];
    registerScenario(genericScenario({ ...picked, id: pub.id }));
    expect(getScenario(pub.id)).toBe(pub);
  });
});
