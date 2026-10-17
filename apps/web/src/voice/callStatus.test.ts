import { describe, expect, it } from "vitest";
import { callStatusWord } from "./callStatus";

describe("callStatusWord", () => {
  it("says ready before a call, not disconnected", () => {
    expect(callStatusWord("disconnected", false)).toBe("ready");
  });
  it("names each live state in plain words", () => {
    expect(callStatusWord("connecting", false)).toBe("connecting");
    expect(callStatusWord("connected", false)).toBe("on the call");
    expect(callStatusWord("connected", true)).toBe("on the call, agent speaking");
    expect(callStatusWord("disconnecting", false)).toBe("ending");
  });
});
