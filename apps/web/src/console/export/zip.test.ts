import { describe, expect, it } from "vitest";
import { crc32, makeZip } from "./zip";

const enc = new TextEncoder();

describe("zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("writes stored entries, a central directory and an end record", () => {
    const zip = makeZip([{ name: "a/ANSWER.md", content: "# Hi\n" }, { name: "a/trace.json", content: "{}" }], new Date(2026, 9, 10, 12, 0, 0));
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    const cdOffset = v.getUint32(end + 16, true);
    expect(v.getUint32(cdOffset, true)).toBe(0x02014b50);
    // First entry: name, then the stored bytes.
    const nameLen = v.getUint16(26, true);
    expect(new TextDecoder().decode(zip.slice(30, 30 + nameLen))).toBe("a/ANSWER.md");
    expect(new TextDecoder().decode(zip.slice(30 + nameLen, 30 + nameLen + 5))).toBe("# Hi\n");
    expect(v.getUint32(14, true)).toBe(crc32(enc.encode("# Hi\n")));
  });
});
