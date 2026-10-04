import assert from "node:assert/strict";
import { test } from "node:test";
import { BLINK_EVERY_MS, BLINK_MS, BREATH_MS, DEALER_FILE, dealerPose, dealerSource } from "./dealer";

test("dealer: the private PNG replaces the placeholder only when it was found", () => {
  assert.deepEqual(dealerSource([]), { kind: "placeholder" });
  assert.deepEqual(dealerSource(["scenes/village/background.png"]), { kind: "placeholder" });
  assert.deepEqual(dealerSource([DEALER_FILE], (f) => `/assets/private/${f}`), { kind: "private", url: "/assets/private/devil/dealer.png" });
});

test("dealer: idle pose breathes and blinks, deterministically", () => {
  const lifts = new Set<number>(), opens = new Set<boolean>();
  for (let t = 0; t < BREATH_MS * 2; t += 50) { lifts.add(dealerPose(t).lift); opens.add(dealerPose(t).eyesOpen); }
  assert.deepEqual([...lifts].sort(), [0, 1], "breathes");
  assert.deepEqual([...opens].sort(), [false, true], "blinks");
  assert.equal(dealerPose(BLINK_EVERY_MS + 10).eyesOpen, false);
  assert.equal(dealerPose(BLINK_EVERY_MS + BLINK_MS + 10).eyesOpen, true);
  assert.deepEqual(dealerPose(1234), dealerPose(1234));
  const p = dealerPose(777);
  assert.ok(p.glow >= 0.6 && p.glow <= 1);
});
