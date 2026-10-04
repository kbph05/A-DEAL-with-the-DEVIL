import { test } from "node:test";
import assert from "node:assert/strict";
import { IDLE_TIMEOUT_MS, prefetchOnIdle, type IdleEnv } from "./prefetch";

test("prefetchOnIdle uses requestIdleCallback with a timeout and loads once it fires", () => {
  let idle: (() => void) | null = null, opts: { timeout: number } | undefined, loads = 0;
  const env: IdleEnv = { requestIdleCallback: (cb, o) => { idle = cb; opts = o; }, setTimeout: () => assert.fail("no fallback needed") };
  assert.equal(prefetchOnIdle(() => { loads++; return Promise.resolve(); }, env), true);
  assert.equal(loads, 0, "nothing loads before the browser is idle");
  assert.equal(opts?.timeout, IDLE_TIMEOUT_MS);
  idle!();
  assert.equal(loads, 1);
});

test("prefetchOnIdle falls back to a timeout without requestIdleCallback", () => {
  let fire: (() => void) | null = null, ms = 0, loads = 0;
  const env: IdleEnv = { setTimeout: (cb, m) => { fire = cb; ms = m; } };
  assert.equal(prefetchOnIdle(() => { loads++; return Promise.resolve(); }, env), true);
  assert.equal(ms, IDLE_TIMEOUT_MS);
  assert.equal(loads, 0);
  fire!();
  assert.equal(loads, 1);
});

test("prefetchOnIdle skips when the user saves data, and swallows a failing or throwing load", async () => {
  let scheduled = 0;
  const spy: IdleEnv = { setTimeout: () => { scheduled++; }, connection: { saveData: true } };
  assert.equal(prefetchOnIdle(() => Promise.resolve(), spy), false);
  assert.equal(scheduled, 0);
  const now: IdleEnv = { setTimeout: (cb) => cb() };
  assert.doesNotThrow(() => prefetchOnIdle(() => Promise.reject(new Error("offline")), now));
  assert.doesNotThrow(() => prefetchOnIdle(() => { throw new Error("sync"); }, now));
  await new Promise((r) => setImmediate(r)); // an unhandled rejection would fail the test run here
});
