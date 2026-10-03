import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame, describe } from "../game";
import { availableActions, blurbOf, buyLabel, curseText, effectChips, eventClass, exitLabel, fightLabel, lockReason, nodeTitle, outcomeEvents, pct } from "./logic";
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

test("effects become signed chips, zeros dropped", () => {
  assert.deepEqual(effectChips({ gold: 10, hp: -3, attack: 0, max_hp: 5, soul: -1 }), [
    { text: "+10 Gold", tone: "good" }, { text: "−3 HP", tone: "bad" }, { text: "+5 Max HP", tone: "good" }, { text: "−1 Soul", tone: "bad" },
  ]);
  assert.deepEqual(effectChips({}), []);
  assert.equal(curseText({ trigger: "on_hit", effect: { hp: -2 } }), "when you are hit: −2 HP");
  assert.equal(curseText({ trigger: "next_node", effect: {} }), "at the next node: nothing");
});

test("choice labels and disabled reasons", () => {
  assert.equal(nodeTitle(1, "village"), "Act 2 · Village");
  assert.equal(exitLabel({ n: 1, kind: "fight" }), "Go → fight");
  assert.match(exitLabel({ n: 1, kind: "stairs" }), /^Go → stairs/);
  assert.deepEqual(buyLabel({ item: "blade", cost: 15, affordable: false }, 12), { label: "Blade (15g) — need 3 more gold", reason: "need 3 more gold" });
  assert.deepEqual(buyLabel({ item: "heal", cost: 10, affordable: true }, 20), { label: "Heal (10g)", reason: null });
  assert.equal(fightLabel({ name: "cave rat", hp: 3, maxHp: 3, boss: false }), "Fight the cave rat");
  const o = createGame("ui-1").observe();
  assert.equal(lockReason(o), null);
  assert.match(lockReason(o, true)!, /considers/);
  assert.match(lockReason({ ...o, ending: "lose" })!, /over/);
});

test("pct is safe, and the description is pulled out of look()", () => {
  assert.deepEqual([pct(5, 10), pct(-3, 10), pct(99, 10), pct(1, 0)], [50, 0, 100, 0]);
  const g = createGame("demo"), l = g.look().events[0];
  assert.equal(l.type, "looked");
  if (l.type !== "looked") return;
  const text = describe(l), blurb = blurbOf(l, text);
  assert.ok(blurb.length > 10 && !blurb.includes("\n") && !blurb.startsWith("[Act") && text.includes(blurb), blurb);
  assert.deepEqual(outcomeEvents([l, { type: "deal_refused" }]), [{ type: "deal_refused" }]);
});
