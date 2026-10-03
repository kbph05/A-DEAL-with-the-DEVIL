import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { autoplay } from "./autoplay";
import { StubDevil } from "./devil";
import { BOT_SEEDS, CHAOS_SEEDS, NEW_EVENT_TYPES, SAMPLE_SEEDS, recordRun, rowOf, type Row } from "./__fixtures__/harness";

/** Recorded with the pre-refactor class engine (see __fixtures__/generate.ts). */
const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/engine-runs.json", import.meta.url), "utf8")) as {
  bot: Row[]; chaos: Row[]; samples: Record<string, unknown[]>;
};

test("equivalence: 500 bot runs reproduce the recorded engine (every command, result, event, final state)", async () => {
  assert.equal(fixture.bot.length, BOT_SEEDS.length);
  for (const [i, seed] of BOT_SEEDS.entries()) {
    const r = await recordRun(seed, "bot");
    if (SAMPLE_SEEDS.includes(seed)) assert.deepEqual(r.steps.flatMap((s) => s.events), fixture.samples[seed], `${seed} events`);
    assert.deepEqual(rowOf(r), fixture.bot[i], `${seed} differs from the recorded engine`);
  }
});

test("equivalence: 200 chaos runs (random valid and invalid commands, haggles, rejections) reproduce the recording", async () => {
  assert.equal(fixture.chaos.length, CHAOS_SEEDS.length);
  for (const [i, seed] of CHAOS_SEEDS.entries()) assert.deepEqual(rowOf(await recordRun(seed, "chaos")), fixture.chaos[i], `${seed} differs`);
});

test("equivalence: autoplay's own event log matches the recorded run", async () => {
  for (const seed of SAMPLE_SEEDS) {
    const r = await autoplay(seed, undefined, 1000, new StubDevil(seed));
    assert.deepEqual(r.events.slice(1).filter((e) => !NEW_EVENT_TYPES.has(e.type)), fixture.samples[seed]);
  }
});
