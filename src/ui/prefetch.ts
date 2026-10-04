/**
 * Warm a lazy chunk once the page has painted, so the first use does not wait on the download. The realtime fight (with
 * Phaser, about 1.2 MB) is its own chunk, loaded on the first fight; `prefetchOnIdle(() => import("../fight"))` fetches it
 * in idle time instead. Failures are ignored: the real use will import it again and report any error itself.
 * Pure of the DOM: the scheduler and the connection are passed in, so tests can fake them.
 */
export interface IdleEnv {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => unknown;
  setTimeout: (cb: () => void, ms: number) => unknown;
  /** `navigator.connection`, when the browser has one. */
  connection?: { saveData?: boolean };
}

/** Wait this long (ms) for idle time, then go anyway (and the delay when there is no requestIdleCallback). */
export const IDLE_TIMEOUT_MS = 3000;

/** Runs `load` in idle time (requestIdleCallback, else a timeout). Skipped when the user asked to save data. Returns whether it was scheduled. */
export function prefetchOnIdle(load: () => Promise<unknown>, env: IdleEnv = browserEnv()): boolean {
  if (env.connection?.saveData) return false;
  const go = (): void => { try { void load().catch(() => undefined); } catch { /* a synchronous throw: same as a failed load */ } };
  if (typeof env.requestIdleCallback === "function") env.requestIdleCallback(go, { timeout: IDLE_TIMEOUT_MS });
  else env.setTimeout(go, IDLE_TIMEOUT_MS);
  return true;
}

function browserEnv(): IdleEnv {
  const w = window as unknown as { requestIdleCallback?: IdleEnv["requestIdleCallback"] };
  return {
    requestIdleCallback: typeof w.requestIdleCallback === "function" ? w.requestIdleCallback.bind(window) : undefined,
    setTimeout: (cb, ms) => window.setTimeout(cb, ms),
    connection: (navigator as unknown as { connection?: IdleEnv["connection"] }).connection,
  };
}
