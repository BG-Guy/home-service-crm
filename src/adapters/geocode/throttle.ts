// Serializes calls so a provider sees at most one request per `intervalMs` from this process.
export function createThrottle(intervalMs: number) {
  let last = 0;
  let chain: Promise<unknown> = Promise.resolve();
  return function throttle<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      const wait = last + intervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return fn();
    });
    chain = run.catch(() => undefined);
    return run;
  };
}
