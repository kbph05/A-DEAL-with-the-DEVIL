import assert from "node:assert/strict";
import { test } from "node:test";
import { applyGamma } from "./gamma";
import { FOREST_BG_GAMMA } from "./art";

const px = (...v: number[]) => new Uint8ClampedArray(v);

test("gamma 1 is the identity", () => {
  const all = new Uint8ClampedArray(256 * 4);
  for (let v = 0; v < 256; v++) all.set([v, 255 - v, (v * 7) % 256, 200], v * 4);
  const copy = all.slice();
  applyGamma(all, 1);
  assert.deepEqual(all, copy);
});

test("gamma above 1 brightens the midtones, below 1 darkens them", () => {
  const up = px(64, 128, 192, 255);
  applyGamma(up, FOREST_BG_GAMMA);
  assert.ok(up[0] > 64 && up[1] > 128 && up[2] > 192);
  const down = px(64, 128, 192, 255);
  applyGamma(down, 0.7);
  assert.ok(down[0] < 64 && down[1] < 128 && down[2] < 192);
});

test("0 and 255 stay fixed, and the curve is monotonic", () => {
  for (const g of [0.6, 1.4, 1.8, 2.2]) {
    const d = px(0, 0, 0, 255, 255, 255, 255, 255);
    applyGamma(d, g);
    assert.deepEqual([...d], [0, 0, 0, 255, 255, 255, 255, 255]);
    const ramp = new Uint8ClampedArray(256 * 4);
    for (let v = 0; v < 256; v++) ramp.set([v, v, v, 255], v * 4);
    applyGamma(ramp, g);
    for (let v = 1; v < 256; v++) assert.ok(ramp[v * 4] >= ramp[(v - 1) * 4]);
  }
});

test("alpha is untouched, and the maths matches 255 * (v/255)^(1/gamma)", () => {
  const d = px(100, 100, 100, 37);
  applyGamma(d, 2);
  assert.equal(d[3], 37);
  assert.equal(d[0], Math.round(255 * Math.sqrt(100 / 255)));
});

test("a bad gamma throws", () => {
  for (const g of [0, -1, NaN, Infinity]) assert.throws(() => applyGamma(px(1, 2, 3, 4), g), RangeError);
});
