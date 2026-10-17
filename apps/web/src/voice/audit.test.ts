import { describe, expect, it } from "vitest";
import { auditLine } from "./audit";

describe("auditLine", () => {
  it("says how many lines were checked and that they passed", () => {
    expect(auditLine({ checked: 6, flagged: [], unchecked: false })).toEqual({ tone: "ok", text: "After the call: the safety check flagged none of the 6 lines the agent said." });
  });
  it("names what was flagged", () => {
    expect(auditLine({ checked: 4, flagged: [{ line: "It will arrive before noon.", reasons: ["promises an outcome"] }], unchecked: false }))
      .toEqual({ tone: "bad", text: "After the call: 1 of 4 lines flagged: “It will arrive before noon.” (promises an outcome)" });
  });
  it("never shows a pass when nothing was checked", () => {
    expect(auditLine({ checked: 0, flagged: [], unchecked: true })).toEqual({ tone: "warn", text: "After the call: the lines could not be checked. Read the transcript." });
    expect(auditLine(null)).toEqual({ tone: "warn", text: "After the call: the lines could not be checked. Read the transcript." });
    expect(auditLine({ checked: 0, flagged: [], unchecked: false })).toBeNull();
  });
});
