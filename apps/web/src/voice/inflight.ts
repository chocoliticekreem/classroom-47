// Tracks tool calls that are still running during a voice call, so ending the call waits for them:
// a decision being saved when the manager clicks "End call" must still reach the console.
export function createInflight() {
  const pending = new Set<Promise<unknown>>();
  return {
    track<T>(promise: Promise<T>): Promise<T> {
      pending.add(promise);
      promise.then(() => pending.delete(promise), () => pending.delete(promise));
      return promise;
    },
    /** Resolves once nothing is in flight, including calls that started while waiting. Never rejects. */
    async settle(): Promise<void> {
      while (pending.size) await Promise.allSettled([...pending]);
    },
  };
}
