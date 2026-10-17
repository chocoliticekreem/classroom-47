import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

const ART = path.join(__dirname, "artifacts");

const LEAK = /Jev|Claude|claude-|safety_gate|human_decision|allow_below|block_above|run_end|trace\b|NODE_ROLES|snake_case_with_underscores/;
const SNAKE = /\b[a-z]+_[a-z_]+\b/g;

type Target = { name: string; url: string; heavy?: boolean; consoleShell?: boolean };

const TABS = ["overview", "intake", "executions", "workflows", "evidence", "reality", "city", "settings"];
const TARGETS: Target[] = [
  // The city tab embeds the 3D world, so like /city it only gets the canvas check plus errors.
  ...TABS.map((t) => ({ name: `tab:${t}`, url: `/?tab=${t}`, consoleShell: true, heavy: t === "city" })),
  { name: "route:/review", url: "/review" },
  { name: "route:/city", url: "/city", heavy: true },
];

/** Header primary action per tab (the shell's DefaultPrimary). Tabs not listed have none. */
const HEADER_PRIMARY: Record<string, string | RegExp> = {
  overview: "New case",
  executions: "Run a case",
  evidence: /^Run (a case|more sample cases)$/, // Results brings its own "Run more sample cases"
  city: "Open the city",
};

/** Visible text nodes, skipping code captions (code/pre/kbd/samp) and hidden elements. */
async function visibleText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const t = n.textContent?.trim();
      if (!t) continue;
      const el = n.parentElement;
      if (!el || el.closest("code,pre,kbd,samp,script,style,noscript,[aria-hidden='true']")) continue;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.push(t);
    }
    return out;
  });
}

function slug(s: string) {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
}

for (const target of TARGETS) {
  test(target.name, async ({ page }) => {
    if (target.heavy) test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text().slice(0, 400)}`);
    });
    page.on("pageerror", (e) => errors.push(`uncaught: ${String(e.message).slice(0, 400)}`));

    const shot = path.join(ART, `${slug(target.name)}.png`);
    const failures: string[] = [];
    test.info().annotations.push({ type: "screenshot", description: shot });

    const resp = await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (!resp || resp.status() >= 400) failures.push(`HTTP ${resp?.status() ?? "no response"}`);

    if (target.heavy) {
      // The city tab embeds /city?embed=1 in an iframe; /city renders the canvas directly.
      const root = target.consoleShell ? page.frameLocator("iframe[src*='/city']") : page;
      try {
        await root.locator("canvas").first().waitFor({ state: "attached", timeout: 60_000 });
      } catch {
        failures.push(target.consoleShell ? "no <canvas> inside the city iframe after 60s" : "no <canvas> after 60s");
      }
      await page.waitForTimeout(2_000);
    } else {
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(1_500);
    }

    // 1. console errors / uncaught exceptions
    const counts = new Map<string, number>();
    for (const e of errors) counts.set(e, (counts.get(e) ?? 0) + 1);
    for (const [e, n] of counts) failures.push(n > 1 ? `${e} (x${n})` : e);

    if (!target.heavy) {
      // 2. leaks
      const texts = await visibleText(page);
      const leaks = new Set<string>();
      for (const t of texts) {
        const m = t.match(LEAK);
        if (m) leaks.add(`leak "${m[0]}" in: "${t.slice(0, 120)}"`);
        for (const s of t.match(SNAKE) ?? []) leaks.add(`snake_case "${s}" in: "${t.slice(0, 120)}"`);
      }
      failures.push(...leaks);

      // 3. horizontal overflow at 1280x720
      const ov = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        const culprits: string[] = [];
        if (sw > vw + 1) {
          for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
            const r = el.getBoundingClientRect();
            if (r.right > vw + 1 && r.width > 0 && culprits.length < 5) {
              culprits.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)}`);
            }
          }
        }
        return { vw, sw, culprits };
      });
      if (ov.sw > ov.vw + 1) failures.push(`horizontal overflow: scrollWidth ${ov.sw} > ${ov.vw} (${ov.culprits.join(" | ")})`);

      // 4. primary buttons
      const visibleButtons = await page.locator("button:visible, a[role='button']:visible").count();
      if (visibleButtons === 0) failures.push("no visible buttons");
    }

    // 5. the shell's header primary action, where the shell provides one (Shell.tsx DefaultPrimary);
    // other tabs bring their own buttons, covered by the "no visible buttons" check above.
    const expected = target.consoleShell ? HEADER_PRIMARY[target.name.slice(4)] : undefined;
    if (expected) {
      const header = page.locator("header.rv-shell-header");
      const n = await header.getByRole("button", { name: expected }).or(header.getByRole("link", { name: expected })).count();
      if (n === 0) failures.push(`header primary "${expected}" not found in header.rv-shell-header`);
    }

    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    expect(failures, `${target.name} failures (screenshot ${shot})`).toEqual([]);
  });
}
