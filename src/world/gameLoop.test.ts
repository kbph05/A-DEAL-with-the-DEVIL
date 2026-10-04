import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { GAME_FPS } from "../gameLoop";
import { WALK, stepVelocity } from "./logic";
import { moveDir } from "../input/dir";

// Phaser's own TimeStep (no DOM needed beyond performance.now), driven by hand at a fixed frame rate.
const require = createRequire(import.meta.url);
(globalThis as Record<string, unknown>).window ??= globalThis;
const TimeStep = require("phaser/src/core/TimeStep.js") as new (game: unknown, config: unknown) => {
  raf: { start(): void; stop(): void }; start(cb: (time: number, delta: number) => void): void; step(time: number): void; lastTime: number;
};

/** Sum of the deltas the game sees over the first `seconds` after boot, at `fps`: what the walk is integrated over. */
function gameTime(fps: number, seconds: number, config: object): number {
  const ts = new TimeStep({ config: {} }, { target: 60, ...config });
  let total = 0;
  ts.raf = { start() {}, stop() {} }; // frames are stepped by hand below
  ts.start((_t, d) => { total += d; }); // boot: resets the delta (as resume and refocus do)
  let t = ts.lastTime;
  for (let i = 0; i < fps * seconds; i++) { t += 1000 / fps; ts.step(t); }
  return total / 1000;
}

test("first input after load: holding right walks the full speed from frame 1, at 20 fps as at 60 fps", () => {
  const dir = moveDir({ up: false, down: false, left: false, right: true });
  const v = stepVelocity({ x: 0, y: 0 }, dir, 1 / 60);
  assert.deepEqual(v, { x: WALK.speed, y: 0 });
  // x after 1 s of holding D right after the scene starts (velocity × the game's elapsed time).
  const x20 = v.x * gameTime(20, 1, GAME_FPS), x60 = v.x * gameTime(60, 1, GAME_FPS);
  assert.ok(Math.abs(x20 - WALK.speed) < WALK.speed * 0.03, `20 fps: ${x20}`);
  assert.ok(Math.abs(x60 - WALK.speed) < WALK.speed * 0.03, `60 fps: ${x60}`);
});

test("Phaser's default loop (delta clamped to 1/60 s after boot) was the bug: a third of the speed at 20 fps", () => {
  const t = gameTime(20, 1, {});
  assert.ok(t < 0.45, String(t));
});
