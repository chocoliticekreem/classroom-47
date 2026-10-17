import { describe, expect, it } from "vitest";
import { DENIAL as SERVER_DENIAL, fallbackReply as serverFallback } from "../../../api/src/voice/wording";
import { DENIAL, fallbackReply } from "./api";

describe("voice api client", () => {
  it("falls back to exactly the server's denial wording", () => {
    expect(DENIAL).toBe(SERVER_DENIAL);
  });
  it("falls back per tool exactly as the server does", () => {
    for (const tool of ["propose_commitment", "submit_decision", "record_fact", "request_human", "other"]) {
      expect(fallbackReply(tool)).toBe(serverFallback(tool));
    }
  });
});
