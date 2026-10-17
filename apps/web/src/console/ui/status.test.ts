import { describe, expect, it } from "vitest";
import { statusKind, statusLabel } from "./Status";

describe("statusKind / statusLabel", () => {
  it("maps agent outcomes to the five colours", () => {
    expect(statusKind("acted")).toBe("sent");
    expect(statusKind("asked_for_info")).toBe("asked");
    expect(statusKind("escalated")).toBe("needs_person");
    expect(statusKind("blocked")).toBe("stopped");
    expect(statusKind("error")).toBe("didnt_finish");
    expect(statusKind(null)).toBe("didnt_finish");
  });
  it("maps run statuses and gate verdicts", () => {
    expect(statusKind("running")).toBe("working");
    expect(statusKind("success")).toBe("sent");
    expect(statusKind("ask")).toBe("needs_person");
    expect(statusKind("block")).toBe("stopped");
    expect(statusKind("no_action")).toBe("nothing");
  });
  it("uses plain words, never raw keys", () => {
    expect(statusLabel("acted")).toBe("Sent");
    expect(statusLabel("escalated")).toBe("Needs a person");
    expect(statusLabel("blocked")).toBe("Stopped");
    expect(statusLabel("error")).toBe("Didn't finish");
    expect(statusLabel("running")).toBe("Working on it");
    expect(statusLabel("weird_key")).toBe("Didn't finish");
  });
});
