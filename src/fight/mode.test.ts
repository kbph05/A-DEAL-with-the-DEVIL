import { test } from "node:test";
import assert from "node:assert/strict";
import { fightModeFor } from "./mode";

test("bosses (minibosses and the final boss) route to the forest path; regular fights keep the caller's mode", () => {
  const enemy = (boss: boolean) => ({ name: boss ? "the Gatekeeper" : "cave rat", hp: 10, maxHp: 10, power: 3, boss });
  assert.equal(fightModeFor({ enemy: enemy(true) }), "forest");
  assert.equal(fightModeFor({ enemy: enemy(true) }, "arena"), "forest", "a boss is never fought in the arena");
  assert.equal(fightModeFor({ enemy: enemy(false) }), "arena", "the DOM UI's default for regular fights");
  assert.equal(fightModeFor({ enemy: enemy(false) }, "forest"), "forest", "the play page plays everything on the path");
  assert.equal(fightModeFor(null), "arena");
  assert.equal(fightModeFor({ enemy: { boss: "yes" } }), "arena", "only a real true counts");
});
