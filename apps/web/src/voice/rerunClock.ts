// Real time elapsed since the last re-run. The re-run builder adds it to the case's latest event,
// which after a re-run already includes the earlier wait, so measuring from page load would count it twice.
export function createRerunClock(now: () => number = Date.now) {
  let since = now();
  return {
    elapsed: () => Math.max(0, now() - since),
    markRun: () => { since = now(); },
  };
}
