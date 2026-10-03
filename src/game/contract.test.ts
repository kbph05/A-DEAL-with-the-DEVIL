import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contractShapes } from "./__fixtures__/harness";

/**
 * JSON contract: every external JSON shape (Command, PlayerState, Observation, MapView, Result, every GameEvent type,
 * the devil request, the REPL --json lines) may only grow. Each path recorded before the stateless refactor must still
 * exist with exactly the same JSON types; new paths are allowed.
 */
const recorded = JSON.parse(readFileSync(new URL("./__fixtures__/contract.json", import.meta.url), "utf8")) as Record<string, string[]>;

test("JSON contract: changes are additive only (no field removed, renamed or retyped)", async () => {
  const now = await contractShapes();
  const broken = Object.entries(recorded)
    .filter(([path, types]) => JSON.stringify(now[path]) !== JSON.stringify(types))
    .map(([path, types]) => `${path}: was ${types.join("|")}, now ${now[path]?.join("|") ?? "missing"}`);
  assert.deepEqual(broken, []);
});
