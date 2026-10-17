import { describe, expect, it } from "vitest";
import { agentOfflineFrom } from "./agentStatus";
import { ApiError } from "./http";

describe("agentOfflineFrom", () => {
  it("offline when the console says the agent isn't answering", () => {
    expect(agentOfflineFrom({ settled: true, failures: 0, data: { agentApi: false } })).toBe(true);
    expect(agentOfflineFrom({ settled: true, failures: 0, data: { agentApi: true } })).toBe(false);
  });
  it("needs two connection failures in a row before calling it offline", () => {
    const error = new ApiError("x", 0);
    expect(agentOfflineFrom({ settled: true, failures: 1, error, data: { agentApi: true } })).toBe(false);
    expect(agentOfflineFrom({ settled: true, failures: 2, error, data: { agentApi: true } })).toBe(true);
  });
  it("a 404 is not 'offline'", () => {
    expect(agentOfflineFrom({ settled: true, failures: 5, error: new ApiError("x", 404) })).toBe(false);
  });
  it("unknown before the first answer", () => {
    expect(agentOfflineFrom({ settled: false, failures: 0 })).toBe(false);
  });
});
