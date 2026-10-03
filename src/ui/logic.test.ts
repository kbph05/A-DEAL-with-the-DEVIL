import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../game";
import { availableActions, eventClass } from "./logic";
import { diffDeal } from "./dealDiff";
import { sanitizeDeal } from "../game/deal";

test("actions follow the observation", () => {
  const g = createGame("ui-1");
  const o = g.observe();
  const a = availableActions(o);
  assert.equal(a.exits.length, o.exits.length);
  assert.equal(a.fight, o.enemy !== null);
  assert.equal(availableActions(o, true).locked, true);
  const poor = { ...o, kind: "village" as const, state: { ...o.state, gold: 9 } };
  assert.deepEqual(availableActions(poor).buy.map((b) => [b.item, b.affordable]), [["heal", false], ["blade", false]]);
  const deal = { ...o, kind: "deal" as const, resolved: false, offer: null };
  assert.deepEqual(availableActions(deal).ask, { again: false });
  assert.deepEqual(availableActions({ ...deal, resolved: true }).ask, null);
  assert.equal(availableActions({ ...o, ending: "win" }).locked, true);
});

test("event classes highlight the devil's meddling", () => {
  assert.equal(eventClass({ type: "node_rewritten", change: { nodeId: "a", from: "fight", to: "campfire", polarityFlip: true } }), "ev-rewrite");
  assert.equal(eventClass({ type: "curse_fired", trigger: "on_hit", effect: {}, changes: {} }), "ev-curse");
  assert.equal(eventClass({ type: "rejected", reason: "x" }), "ev-reject");
});

test("diffDeal reports what sanitizeDeal dropped, renamed or clamped", () => {
  const raw = { dialogue: "hi", effects: { gold: 9999, damage: 2, xp: 1, hp: "lots" }, curse: { trigger: "never", effect: { hp: -1 } }, rewrite: { nodeId: "zz", to: "boss" }, extra: 1 };
  const notes = diffDeal(raw, sanitizeDeal(raw), [{ id: "a" }]).map((c) => c.path);
  for (const p of ["extra", "effects.gold", "effects.damage", "effects.xp", "effects.hp", "curse", "rewrite"]) assert.ok(notes.includes(p), `${p} in ${notes}`);
  assert.deepEqual(diffDeal("junk", sanitizeDeal("junk")).map((c) => c.path), ["(body)"]);
  const good = { dialogue: "ok", effects: { gold: 5 }, rewrite: { nodeId: "q", to: "fight" } };
  assert.deepEqual(diffDeal(good, sanitizeDeal(good), [{ id: "a" }]).map((c) => c.path), ["rewrite.nodeId"]);
  assert.deepEqual(diffDeal({ dialogue: "ok", effects: { gold: 5 } }, sanitizeDeal({ dialogue: "ok", effects: { gold: 5 } })), []);
});
