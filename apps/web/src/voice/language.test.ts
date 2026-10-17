import { describe, expect, it } from "vitest";
import { machineTranslation, spokenLanguage } from "./language";

describe("spokenLanguage", () => {
  it("reads the language a note was spoken in", () => {
    expect(spokenLanguage("[spoken in Spanish] La puerta está cerrada.")).toBe("Spanish");
  });
  it("is null for a note in English or without a mark", () => {
    expect(spokenLanguage("Gate's locked.")).toBeNull();
    expect(spokenLanguage("[unclear transcription] mumble")).toBeNull();
  });
});

describe("machineTranslation", () => {
  it("reads the English machine translation carried by a note", () => {
    expect(machineTranslation("[spoken in Spanish] Hola. [English, machine translation: Hello.]")).toBe("Hello.");
  });
  it("is null when the note carries none", () => {
    expect(machineTranslation("[spoken in Spanish] Hola.")).toBeNull();
  });
});
