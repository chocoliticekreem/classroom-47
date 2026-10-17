import { describe, expect, it } from "vitest";
import type { EvidenceRow } from "../types";
import { csvCell, resultsCsv, resultWord, toCsv, RESULTS_HEADER } from "./csv";

const row = (over: Partial<EvidenceRow> = {}): EvidenceRow => ({
  caseId: "delivery-024", dataset: "public", title: "Parcel missing", decision: "acted", nextAction: "Email → Delivery investigations",
  gate: "allow", pass: true, score: 0.9, costUsd: 0.0781234567, durationMs: 35_049, executionId: "exec-1",
  critical: false, verdict: "Right team, says \"today\".", brokenRules: [], mutation: null, ...over,
});

describe("csvCell", () => {
  it("leaves plain values alone", () => {
    expect(csvCell("delivery-024")).toBe("delivery-024");
    expect(csvCell(0.9)).toBe("0.9");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
  });

  it("quotes commas, quotes, line breaks and edge spaces, doubling quotes", () => {
    expect(csvCell("Plover Arc, Ltd")).toBe('"Plover Arc, Ltd"');
    expect(csvCell('She said "now"')).toBe('"She said ""now"""');
    expect(csvCell("line 1\nline 2")).toBe('"line 1\nline 2"');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
    expect(csvCell(" padded")).toBe('" padded"');
    expect(csvCell("")).toBe("");
  });

  it("defuses spreadsheet formulas in text but not in numbers", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("@sum")).toBe("'@sum");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell(-2)).toBe("-2");
  });

  it("keeps unicode as is", () => {
    expect(csvCell("Email → Zoë")).toBe("Email → Zoë");
  });
});

describe("toCsv", () => {
  it("joins with commas and CRLF and ends with a line break", () => {
    expect(toCsv(["a", "b"], [["1", "x,y"], [null, 2]])).toBe('a,b\r\n1,"x,y"\r\n,2\r\n');
  });
});

describe("resultsCsv", () => {
  it("writes one line per case with right/wrong, rounded cost and seconds", () => {
    const lines = resultsCsv([row(), row({ caseId: "gen-1", pass: false, score: 0, critical: true, brokenRules: ["Never promise a time", "Never share the address"] }),
      row({ caseId: "gen-2", pass: null, score: null, critical: null, verdict: null }),
      row({ caseId: "gen-3", dataset: "generated", mutation: "noise", decision: null, pass: null, score: null, costUsd: null, durationMs: null, executionId: null,
        nextAction: null, gate: null, critical: null, verdict: null })])
      .trimEnd().split("\r\n");
    expect(lines[0]).toBe(RESULTS_HEADER.join(","));
    expect(lines[1]).toBe('delivery-024,public,,Parcel missing,acted,right,0.9,no,,"Right team, says ""today"".",0.078123,35,Email → Delivery investigations,allow,exec-1');
    expect(lines[2]).toContain(",wrong,0,yes,Never promise a time; Never share the address,");
    expect(lines[3]).toContain(",not checked,,,,");
    expect(lines[4]).toBe("gen-3,generated,noise,Parcel missing,not run,,,,,,,,,,");
  });

  it("says right / wrong / not checked / never run", () => {
    expect(resultWord({ pass: true, executionId: "x" })).toBe("right");
    expect(resultWord({ pass: false, executionId: "x" })).toBe("wrong");
    expect(resultWord({ pass: null, executionId: "x" })).toBe("not checked");
    expect(resultWord({ pass: null, executionId: null })).toBe("");
  });
});
