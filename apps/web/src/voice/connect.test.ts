import { describe, expect, it } from "vitest";
import { VOICE_LOADERS } from "../console/executions/voiceComponents";
import { VOICE_COMPONENTS } from "../console/executions/voiceSlots";

describe("voice components in the console", () => {
  it("connects every component the console's voice slots expect", () => {
    expect(Object.keys(VOICE_LOADERS).sort()).toEqual([...VOICE_COMPONENTS].sort());
  });
});
