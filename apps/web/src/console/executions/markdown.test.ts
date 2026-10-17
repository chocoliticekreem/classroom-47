import { describe, expect, it } from "vitest";
import { inlineText, parseInline, parseMarkdown } from "./markdown";

describe("parseMarkdown", () => {
  it("parses headings, paragraphs and bold", () => {
    const b = parseMarkdown("# Title\n\n**Decision:** Escalated\nsecond line\n\n## Actions");
    expect(b.map((x) => x.type)).toEqual(["heading", "paragraph", "heading"]);
    expect(b[0]).toMatchObject({ level: 1 });
    const p = b[1] as Extract<(typeof b)[number], { type: "paragraph" }>;
    expect(p.children[0]).toEqual({ type: "strong", children: [{ type: "text", text: "Decision:" }] });
    expect(inlineText(p.children)).toBe("Decision: Escalated second line");
  });

  it("parses bullet and numbered lists", () => {
    const b = parseMarkdown("- one\n- two\n\n3. a\n4. b");
    expect(b[0]).toMatchObject({ type: "list", ordered: false });
    expect(b[1]).toMatchObject({ type: "list", ordered: true, start: 3 });
    expect((b[0] as { items: unknown[] }).items).toHaveLength(2);
  });

  it("parses GFM tables with alignment and escaped pipes", () => {
    const b = parseMarkdown("| To | Risk |\n|---|--:|\n| Ops a\\|b | 0.20 |\n| X | 1 |");
    expect(b).toHaveLength(1);
    const t = b[0] as Extract<(typeof b)[number], { type: "table" }>;
    expect(t.type).toBe("table");
    expect(t.align).toEqual([null, "right"]);
    expect(t.rows).toHaveLength(2);
    expect(inlineText(t.rows[0][0])).toBe("Ops a|b");
  });

  it("keeps fenced code verbatim", () => {
    const b = parseMarkdown("```json\n{ \"a\": \"**x**\" }\n```\nafter");
    expect(b[0]).toEqual({ type: "code", lang: "json", text: '{ "a": "**x**" }' });
    expect(b[1].type).toBe("paragraph");
  });

  it("parses blockquotes and hr", () => {
    const b = parseMarkdown("> hello\n> world\n\n---");
    expect(b[0].type).toBe("blockquote");
    expect(b[1].type).toBe("hr");
  });

  it("treats HTML as text (never markup)", () => {
    const b = parseMarkdown("<script>alert(1)</script>");
    expect(b).toEqual([{ type: "paragraph", children: [{ type: "text", text: "<script>alert(1)</script>" }] }]);
  });

  it("handles empty input", () => {
    expect(parseMarkdown("")).toEqual([]);
  });
});

describe("parseInline", () => {
  it("parses code, em and links", () => {
    expect(parseInline("a `x*y` b")).toEqual([
      { type: "text", text: "a " }, { type: "code", text: "x*y" }, { type: "text", text: " b" },
    ]);
    expect(parseInline("*hi*")).toEqual([{ type: "em", children: [{ type: "text", text: "hi" }] }]);
    expect(parseInline("[d](https://x.y)")[0]).toMatchObject({ type: "link", href: "https://x.y" });
  });

  it("drops unsafe link schemes but keeps the text", () => {
    const out = parseInline("[click](javascript:alert(1))");
    expect(out.some((n) => n.type === "link")).toBe(false);
    expect(out[0]).toEqual({ type: "text", text: "click" });
  });

  it("leaves snake_case words alone", () => {
    expect(inlineText(parseInline("hold_for_human and asked_for_info"))).toBe("hold_for_human and asked_for_info");
    expect(parseInline("hold_for_human")).toHaveLength(1);
  });

  it("leaves a lone asterisk alone", () => {
    expect(parseInline("2 * 3")).toEqual([{ type: "text", text: "2 * 3" }]);
  });
});
