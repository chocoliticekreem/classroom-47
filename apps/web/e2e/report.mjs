// Appends one run's failures (from artifacts/results.json) to REPORT.md.
import fs from "node:fs";
import path from "node:path";
const dir = path.dirname(new URL(import.meta.url).pathname);
const report = path.join(dir, "REPORT.md");
const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
const runNo = process.argv[2] ?? "?";
let md = `\n## Run ${runNo} (${stamp})\n\n`;
const resFile = path.join(dir, "artifacts", "results.json");
const up = process.argv[3] !== "down";
if (!up) {
  md += "- **Server down:** http://localhost:3001 did not respond, so no tests ran.\n";
} else if (!fs.existsSync(resFile)) {
  md += "- No results.json produced (runner crashed).\n";
} else {
  const r = JSON.parse(fs.readFileSync(resFile, "utf8"));
  const rows = [];
  let pass = 0;
  const walk = (s) => {
    for (const sp of s.specs ?? []) for (const t of sp.tests ?? []) {
      const res = t.results?.[t.results.length - 1];
      const ann = (t.annotations ?? []).find((a) => a.type === "screenshot")?.description;
      const att = res?.attachments?.find((a) => a.contentType === "image/png")?.path;
      const shot = ann && fs.existsSync(ann) && (!att || res?.status !== "timedOut") ? ann : att ?? ann ?? "";
      if (res?.status === "passed") { pass++; continue; }
      let msg = res?.error?.message ?? res?.status ?? "unknown";
      msg = msg.replace(/\u001b\[[0-9;]*m/g, "");
      const lines = [...msg.matchAll(/^\s*[+-]?\s*"(.*)",?$/gm)].map((m) => m[1]);
      const items = lines.length ? lines : [msg.split("\n").slice(0, 4).join(" ")];
      rows.push({ page: sp.title, items, shot: shot ? path.relative(path.join(dir, ".."), shot) : "" });
    }
    for (const c of s.suites ?? []) walk(c);
  };
  for (const s of r.suites ?? []) walk(s);
  md += `Passed ${pass}/${pass + rows.length}.\n\n`;
  for (const row of rows) {
    md += `- **${row.page}** (screenshot: \`${row.shot}\`)\n`;
    for (const i of row.items) md += `  - ${i.replace(/\\"/g, '"')}\n`;
  }
  if (!rows.length) md += "- No failures.\n";
}
if (!fs.existsSync(report)) fs.writeFileSync(report, "# E2E smoke report (http://localhost:3001)\n\nRun with `npm run e2e -w web`. Each run is appended below.\n");
fs.appendFileSync(report, md);
console.log(md);
