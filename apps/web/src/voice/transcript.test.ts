import { describe, expect, it } from "vitest";
import { micErrorMessage, transcriptReducer, type Line } from "./transcript";

describe("transcriptReducer", () => {
  it("appends lines in order with their role", () => {
    let lines: Line[] = [];
    lines = transcriptReducer(lines, { message: "Hi, this is the delivery desk assistant.", role: "agent" });
    lines = transcriptReducer(lines, { message: "Yes, go ahead.", role: "user" });
    expect(lines).toEqual([
      { role: "agent", message: "Hi, this is the delivery desk assistant." },
      { role: "user", message: "Yes, go ahead." },
    ]);
  });

  it("ignores empty or malformed messages", () => {
    const start: Line[] = [{ role: "agent", message: "Hello." }];
    expect(transcriptReducer(start, { message: "   ", role: "user" })).toBe(start);
    expect(transcriptReducer(start, { message: "x", role: "robot" })).toBe(start);
    expect(transcriptReducer(start, null)).toBe(start);
    expect(transcriptReducer(start, { role: "user" })).toBe(start);
  });
});

describe("micErrorMessage", () => {
  it("tells the user to type when the microphone is blocked or missing", () => {
    expect(micErrorMessage(new DOMException("denied", "NotAllowedError"))).toBe("Microphone blocked: type the note instead");
    expect(micErrorMessage(new DOMException("none", "NotFoundError"))).toBe("No microphone found: type the note instead");
    expect(micErrorMessage(new Error("other"))).toBe("Recording failed: type the note instead");
  });
  it("drops the voice model's expression tags from what the agent said", () => {
    expect(transcriptReducer([], { role: "agent", message: "That's [happy] wonderful, thank you. [laughs]" })).toEqual([{ role: "agent", message: "That's wonderful, thank you." }]);
    expect(transcriptReducer([], { role: "user", message: "Gate [B] is shut." })).toEqual([{ role: "user", message: "Gate [B] is shut." }]);
  });
});
