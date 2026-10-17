#!/bin/bash
# Runs the smoke suite N times, sleeping between runs, appending to REPORT.md.
cd "$(dirname "$0")/.." || exit 1
N=${1:-7}; GAP=${2:-360}
for i in $(seq 1 "$N"); do
  rm -f e2e/artifacts/results.json
  code=$(curl -s -o /dev/null -m 20 -w "%{http_code}" http://localhost:3001/)
  if [ "$code" = "000" ]; then node e2e/report.mjs "$i" down
  else npx playwright test -c e2e/playwright.config.ts >/dev/null 2>&1; node e2e/report.mjs "$i"; fi
  [ "$i" -lt "$N" ] && sleep "$GAP"
done
