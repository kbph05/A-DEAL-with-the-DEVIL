import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_FONT_PX, MIN_FONT_PX, fitLabel } from "./placeholder";

test("fitLabel: 1-3 letters fit a 16 px tile at a readable size, never below the minimum", () => {
  for (const label of ["P", "DR", "RK", "TRE", "GRS", "WAL"]) {
    const f = fitLabel(label, 16, 16);
    assert.equal(f.text, label);
    assert.ok(f.fontPx >= MIN_FONT_PX && f.fontPx <= 8, `${label}: ${f.fontPx}`);
  }
  assert.ok(fitLabel("P", 16, 16).fontPx > fitLabel("TRE", 16, 16).fontPx);
});

test("fitLabel: big sprites get a bigger font, capped; too-long text is cut with an ellipsis", () => {
  assert.ok(fitLabel("PLAYER", 96, 96).fontPx <= MAX_FONT_PX);
  assert.equal(fitLabel("PLAYER", 96, 96).text, "PLAYER");
  const long = fitLabel("BOSS: The Very Long Named Warden", 68, 68, true);
  assert.ok(long.text.endsWith("…") && long.text.length < 20);
  assert.equal(long.fontPx, MIN_FONT_PX);
  // Two lines are fitted by their longest line.
  assert.equal(fitLabel("BOSS:\nthe Gatekeeper", 68, 68, true).text, "BOSS:\nthe Gatekeeper");
});
