import assert from "node:assert/strict";
import { test } from "node:test";
import { DEVIL_POSES, IDLE_SHIFTS, POSE_MS, devilPose, idleCycleMs, idlePose, type DevilOverlayState } from "./devilPose";

const T0 = 100_000;
/** The overlay just opened at T0: no offer, not typing, no laugh. */
const st = (over: Partial<DevilOverlayState> = {}): DevilOverlayState =>
  ({ now: T0, since: T0, typing: false, offerAt: null, laughUntil: 0, reducedMotion: false, ...over });

test("devilPose: idle is normal, with a shift now and then, back to normal after each", () => {
  assert.equal(devilPose(st()), "normal");
  const seen = new Set<string>();
  let shifts = 0, last = "normal";
  for (let t = 0; t < 60_000; t += 50) {
    const p = devilPose(st({ now: T0 + t }));
    seen.add(p);
    if (p !== last && p !== "normal") { assert.equal(last, "normal", "every shift starts from normal"); shifts++; }
    last = p;
  }
  assert.deepEqual([...seen].sort(), ["lean_left", "left", "normal", "right"]);
  assert.ok(shifts >= 8 && shifts <= 15, `a shift every 4 to 7 s (${shifts} in a minute)`);
});

test("idle cycles last 4 to 7 s, vary, and take the shifts in turn", () => {
  const lens = Array.from({ length: 30 }, (_, k) => idleCycleMs(k));
  for (const l of lens) assert.ok(l >= 4000 && l <= 7000, `${l}`);
  assert.ok(new Set(lens).size > 10, "not a fixed tick");
  let t = 0;
  for (let k = 0; k < 6; k++) {
    t += idleCycleMs(k);
    assert.equal(idlePose(t - POSE_MS.shift - 1), "normal");
    assert.equal(idlePose(t - 1), IDLE_SHIFTS[k % 3]);
  }
  assert.equal(idlePose(Number.NaN), "normal");
});

test("devilPose: an offer (the opening one too) leans him in, then he settles to normal before any shift", () => {
  const offerAt = T0 + 500;
  assert.equal(devilPose(st({ now: offerAt, offerAt })), "lean_in");
  assert.equal(devilPose(st({ now: offerAt + POSE_MS.leanIn - 1, offerAt })), "lean_in");
  assert.equal(devilPose(st({ now: offerAt + POSE_MS.leanIn, offerAt })), "normal");
  // Idle counts from the end of the lean: the first shift comes a full cycle later.
  const settled = offerAt + POSE_MS.leanIn;
  assert.equal(devilPose(st({ now: settled + idleCycleMs(0) - POSE_MS.shift - 1, offerAt })), "normal");
  assert.equal(devilPose(st({ now: settled + idleCycleMs(0) - 1, offerAt })), "left");
});

test("devilPose: typing or haggling tilts his head, over an offer too", () => {
  assert.equal(devilPose(st({ typing: true })), "head_tilt");
  assert.equal(devilPose(st({ typing: true, offerAt: T0 })), "head_tilt");
  assert.equal(devilPose(st({ typing: true, now: T0 + 60_000 })), "head_tilt");
});

test("devilPose: a laugh beats everything, briefly", () => {
  const laughUntil = T0 + POSE_MS.laugh;
  assert.equal(devilPose(st({ laughUntil, typing: true, offerAt: T0 })), "laugh");
  assert.equal(devilPose(st({ now: laughUntil - 1, laughUntil })), "laugh");
  assert.equal(devilPose(st({ now: laughUntil, laughUntil })), "normal");
  // After the laugh, idle starts over: no shift straight away.
  assert.equal(devilPose(st({ now: laughUntil + 50, since: T0 - 20_000, laughUntil })), "normal");
});

test("devilPose: reduced motion holds normal when idle, but still leans in, tilts and laughs", () => {
  for (let t = 0; t < 30_000; t += 100) assert.equal(devilPose(st({ now: T0 + t, reducedMotion: true })), "normal");
  assert.equal(devilPose(st({ reducedMotion: true, offerAt: T0 })), "lean_in");
  assert.equal(devilPose(st({ reducedMotion: true, typing: true })), "head_tilt");
  assert.equal(devilPose(st({ reducedMotion: true, laughUntil: T0 + 1 })), "laugh");
});

test("devilPose: every pose is one of the seven pictures", () => {
  for (let t = 0; t < 20_000; t += 37) {
    for (const typing of [false, true]) {
      const p = devilPose(st({ now: T0 + t, typing, offerAt: t % 3 === 0 ? T0 + t - 1000 : null, laughUntil: t % 7 === 0 ? T0 + t + 1 : 0 }));
      assert.ok(DEVIL_POSES.includes(p), p);
    }
  }
});

test("death's door: he leans in and stays leaning in (no idle shifts); typing tilts the head, a struck deal laughs", () => {
  for (const now of [T0, T0 + POSE_MS.leanIn + 1, T0 + 60_000]) assert.equal(devilPose(st({ now, dying: true, offerAt: T0 })), "lean_in");
  assert.equal(devilPose(st({ now: T0 + 60_000, dying: true, reducedMotion: true })), "lean_in");
  assert.equal(devilPose(st({ dying: true, typing: true })), "head_tilt");
  assert.equal(devilPose(st({ dying: true, laughUntil: T0 + 1 })), "laugh");
});
