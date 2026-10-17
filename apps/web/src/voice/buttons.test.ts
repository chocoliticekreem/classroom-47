import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The voice components sit inside other forms (the Decisions desk wraps "Or say it out loud" in its
// decision form). A <button> without type="button" submits that form: starting or ending a call
// once saved whichever option had been tapped.
describe("voice buttons", () => {
  it("never submit a surrounding form", () => {
    const dir = path.join(__dirname);
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".tsx"))) {
      const src = readFileSync(path.join(dir, f), "utf8");
      for (const m of src.matchAll(/<button\b(?! type="button")[^\n]*/g)) offenders.push(`${f}: ${m[0].slice(0, 60)}`);
    }
    expect(offenders).toEqual([]);
  });
});
