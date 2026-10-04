import { test } from "node:test";
import type { MapView, Observation } from "../game";
import assert from "node:assert/strict";
import { createGame, describe } from "../game";
import type { Command, GameEvent } from "../game";
import { availableActions, blurbOf, chooseCards, fireChoice, type FireChoice, dealEnd, devilPhase, askBlockReason, haggleText, questionsText, panelKinds, shopItems, buyLabel, curseText, effectChips, eventClass, afterKinds, dagModel, exitNumber, fightLabel, lockReason, moveLock, nodeState, nodeTitle, placeWord, capitalize, eventText, kindLookup, rejectedText, rewriteText, outcomeEvents, pct, STAIRS_ID, topId } from "./logic";
import { FULL_HEALTH, pointlessBuy } from "./shopGuard";
import { diffDeal } from "./dealDiff";
import { lastStrike, STRIKE_HEAD } from "./logic";
import { sanitizeDeal } from "../game/deal";
import { MAX_ASKS, initialState } from "../game/gameState";
import { restoreGame } from "../game/run";

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
  assert.deepEqual(availableActions(deal).ask, { again: false, enabled: true });
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

// ---- the map as a choice (DAG) ----

const mn = (id: string, kind: string, next: string[], over: Record<string, unknown> = {}) => ({ id, kind, visited: false, current: false, rewritten: false, next, ...over });
const fixture = () => ({ act: 0, changes: [], layers: [
  { layer: 0, nodes: [mn("a", "deal", ["b", "c"], { visited: true, current: true })] },
  { layer: 1, nodes: [mn("b", "fight", ["d"]), mn("c", "fight", ["e"], { rewritten: true })] },
  { layer: 2, nodes: [mn("d", "deal", ["x"]), mn("e", "campfire", ["x"])] },
  { layer: 3, nodes: [mn("x", "boss", [])] },
] }) as unknown as MapView;
const obs = (over: Record<string, unknown> = {}) => ({ nodeId: "a", kind: "deal", enemy: null, offer: null, pending: false, ending: null, exits: [], ...over }) as unknown as Observation;
const flat = (d: ReturnType<typeof dagModel>) => d.rows.flat();

test("exitNumber maps a map node to the engine's exit n (index in `next`, plus 1)", () => {
  const m = fixture();
  assert.equal(exitNumber(obs(), m, "b"), 1);
  assert.equal(exitNumber(obs(), m, "c"), 2);
  assert.equal(exitNumber(obs(), m, "d"), null, "two steps away");
  assert.equal(exitNumber(obs(), m, "a"), null, "not itself");
  assert.equal(exitNumber(obs(), m, STAIRS_ID), null, "stairs only from the boss");
  assert.equal(exitNumber(obs({ nodeId: "x" }), m, STAIRS_ID), 1);
  assert.equal(exitNumber(obs({ nodeId: "x" }), m, "b"), null);
  assert.equal(exitNumber(obs({ nodeId: "nope" }), m, "b"), null);
  const last = { ...m, final: mn("final", "final", []) } as unknown as MapView;
  assert.equal(topId(last), "final");
  assert.equal(exitNumber(obs({ nodeId: "x" }), last, "final"), 1);
  assert.equal(exitNumber(obs({ nodeId: "final" }), last, "x"), null);
  assert.equal(exitNumber(obs({ nodeId: "final" }), last, "final"), null);
});

test("nodeState classifies current / visited / next / far", () => {
  const next = new Set(["b"]);
  assert.equal(nodeState({ id: "a", current: true, visited: true }, next), "current");
  assert.equal(nodeState({ id: "z", current: false, visited: true }, next), "visited");
  assert.equal(nodeState({ id: "b", current: false, visited: false }, next), "next");
  assert.equal(nodeState({ id: "d", current: false, visited: false }, next), "far");
});

test("afterKinds and moveLock", () => {
  const m = fixture();
  assert.deepEqual(afterKinds(m, "a"), ["fight"]);
  assert.deepEqual(afterKinds(m, "b"), ["deal"]);
  assert.deepEqual(afterKinds(m, "x"), []);
  assert.deepEqual(afterKinds(m, "nope"), []);
  assert.equal(moveLock(obs()), null);
  assert.match(moveLock(obs({ enemy: { name: "rat" } }))!, /fight first/i);
  assert.match(moveLock(obs({ offer: { dialogue: "x" } }))!, /offer/i);
  assert.match(moveLock(obs(), true)!, /considers/);
  assert.match(moveLock(obs({ pending: true }))!, /considers/);
  assert.match(moveLock(obs({ ending: "win" }))!, /over/);
});

test("dagModel: rows top to bottom, node states, edges, labels", () => {
  const d = dagModel(obs(), fixture());
  assert.deepEqual(d.rows.map((r) => r.map((n) => n.id)), [[STAIRS_ID], ["x"], ["d", "e"], ["b", "c"], ["a"]]);
  const by = Object.fromEntries(flat(d).map((n) => [n.id, n]));
  assert.deepEqual([by.a.state, by.b.state, by.c.state, by.d.state, by.x.state, by[STAIRS_ID].state], ["current", "next", "next", "far", "far", "far"]);
  assert.deepEqual([by.b.n, by.c.n, by.d.n, by.a.n], [1, 2, null, null]);
  assert.equal(by.c.rewritten, true);
  assert.equal(by.b.disabled, null);
  assert.equal(by.b.label, "Go to fight on the left, then deal");
  assert.equal(by.c.label, "Go to fight on the right, then campfire (rewritten by the devil)");
  assert.equal(by.a.label, "You are here: deal");
  assert.deepEqual(d.edges.filter(([f]) => f === "a"), [["a", "b"], ["a", "c"]]);
  assert.ok(d.edges.some(([f, t]) => f === "x" && t === STAIRS_ID), "boss -> stairs edge");
  assert.equal(d.lock, null);
});

test("dagModel: an enemy or an offer keeps next nodes visible but disabled, with the reason", () => {
  for (const [over, re] of [[{ enemy: { name: "rat" } }, /fight first/i], [{ offer: { dialogue: "x" } }, /offer/i]] as const) {
    const d = dagModel(obs(over), fixture());
    const next = flat(d).filter((n) => n.state === "next");
    assert.deepEqual(next.map((n) => [n.id, n.n]), [["b", 1], ["c", 2]], "still mapped");
    for (const n of next) { assert.match(n.disabled!, re); assert.match(n.label, re); }
    assert.match(d.lock!, re);
  }
  assert.ok(flat(dagModel(obs({ ending: "lose" }), fixture())).filter((n) => n.state === "next").every((n) => n.disabled));
});

test("dagModel at the boss: the stairs (or the final door) is the one way on", () => {
  const m = fixture();
  const at = { ...m, layers: m.layers.map((l) => ({ ...l, nodes: l.nodes.map((n) => ({ ...n, current: n.id === "x" })) })) } as MapView;
  const d = dagModel(obs({ nodeId: "x", kind: "boss" }), at);
  assert.deepEqual(flat(d).filter((n) => n.state === "next").map((n) => [n.id, n.n]), [[STAIRS_ID, 1]]);
  assert.match(flat(d)[0].label, /stairs/i);
  const last = { ...at, final: mn("final", "final", []) } as unknown as MapView;
  const d2 = dagModel(obs({ nodeId: "x", kind: "boss" }), last);
  assert.deepEqual(d2.rows[0].map((n) => [n.id, n.state, n.n]), [["final", "next", 1]]);
  assert.match(d2.rows[0][0].label, /final door/);
});

/** Walks a real game (first exit, fighting whatever blocks) until it arrives at the act boss, fight not started; null if the run died first. */
function toBoss(seed: string) {
  const g = createGame(seed);
  for (let i = 0; i < 40; i++) {
    let o = g.observe();
    if (o.ending) return null;
    if (o.kind === "boss") return g;
    if (o.enemy) { g.fight(); continue; }
    if (o.kind === "deal" && o.offer) { g.refuse(); continue; }
    g.go(1);
  }
  return null;
}

test("click mapping matches the engine: go(n) for a next node really lands on that node", () => {
  let checked = 0;
  for (const seed of ["demo", "ui-1", "ui-2", "ui-3", "ui-4"]) {
    for (let steps = 0; steps < 6; steps++) {
      // replay the same walk (always the first exit, fighting as needed) then branch from here for every next node
      const probe = (n: number | null) => {
        const g = createGame(seed);
        for (let i = 0; i < steps; i++) { while (g.observe().enemy && !g.observe().ending) g.fight(); if (g.observe().kind === "deal") g.refuse(); if (!g.observe().ending && g.observe().exits.length) g.go(1); }
        while (g.observe().enemy && !g.observe().ending) g.fight();
        if (g.observe().offer) g.refuse();
        if (n === null) return g;
        g.go(n);
        return g;
      };
      const g0 = probe(null), o = g0.observe(), m = g0.map();
      if (o.ending) break;
      const d = dagModel(o, m);
      for (const node of flat(d).filter((x) => x.state === "next")) {
        const after = probe(node.n);
        const a = after.observe();
        if (node.id === STAIRS_ID) assert.equal(a.act, o.act + 1);
        else assert.equal(a.nodeId, node.id, `${seed} step ${steps}: n=${node.n} for ${node.id}`);
        assert.equal(o.exits[node.n! - 1].kind, node.id === STAIRS_ID ? "stairs" : node.kind, "kind matches the engine's exit list");
        checked++;
      }
      assert.equal(flat(d).filter((x) => x.state === "next").length, o.exits.length, "one next node per engine exit");
    }
  }
  assert.ok(checked >= 10, `checked ${checked}`);
});

test("click mapping at a real boss: shown but disabled mid-fight, then stairs = go(1)", () => {
  let g = null as ReturnType<typeof createGame> | null;
  for (const seed of ["demo", "ui-1", "ui-2", "ui-3", "ui-4", "ui-5", "ui-6"]) { g = toBoss(seed); if (g) break; }
  assert.ok(g, "some seed reaches a boss");
  let o = g!.observe();
  assert.ok(o.enemy, "boss fight on arrival");
  const mid = flat(dagModel(o, g!.map())).filter((n) => n.state === "next");
  assert.deepEqual(mid.map((n) => [n.id, n.n]), [[topId(g!.map()), 1]]);
  assert.match(mid[0].disabled!, /fight first/i);
  while (g!.observe().enemy && !g!.observe().ending) g!.fight();
  o = g!.observe();
  if (o.ending) return; // lost the boss fight: nothing more to check on this seed
  const done = flat(dagModel(o, g!.map())).filter((n) => n.state === "next");
  assert.equal(done.length, 1);
  assert.equal(done[0].disabled, null);
  assert.equal(o.exits[0].kind, o.act < 2 ? "stairs" : "gate");
  g!.go(done[0].n!);
  assert.ok(g!.observe().act === o.act + 1 || g!.observe().nodeId === "final");
});

// ---- clickability comes from the engine's `actions` ----

test("availableActions with the engine's list: enabled strictly by it", () => {
  const g = createGame("demo"), v = g.view();
  const a = availableActions(v, false, v.actions);
  assert.equal(a.fight, v.actions.some((c) => c.cmd === "fight"));
  assert.equal(a.rest, v.actions.some((c) => c.cmd === "rest"));
  const poor = { ...v, kind: "village" as const, state: { ...v.state, gold: 12 } };
  const legal: Command[] = [{ cmd: "buy", item: "heal" }];
  assert.deepEqual(availableActions(poor, false, legal).buy.map((b) => [b.item, b.affordable]), [["heal", true], ["blade", false]]);
  const deal = { ...v, kind: "deal" as const, resolved: false, offer: null };
  assert.deepEqual(availableActions(deal, false, [{ cmd: "deal" }]).ask, { again: false, enabled: true });
  assert.deepEqual(availableActions({ ...deal, offer: { dialogue: "x", effects: {} } }, false, [{ cmd: "accept" }, { cmd: "refuse" }]).ask, { again: true, enabled: false }, "no more haggling");
});

test("dagModel: a next node is clickable iff {cmd:'go', n} is in the engine's actions", () => {
  for (const seed of ["demo", "ui-1", "ui-2"]) {
    const g = createGame(seed);
    for (let i = 0; i < 12; i++) {
      const v = g.view();
      if (v.ending) break;
      const next = flat(dagModel(v, v.map, false, v.actions)).filter((n) => n.state === "next");
      for (const n of next) {
        const legal = v.actions.some((c) => c.cmd === "go" && c.n === n.n);
        if (!v.enemy && !v.offer) assert.equal(n.disabled === null, legal, `${seed} ${n.id}`);
        if (n.disabled === null) assert.ok(legal, "enabled implies legal");
      }
      if (v.enemy) g.fight(); else if (v.offer) g.refuse(); else g.go(1);
    }
  }
  // an engine list without that go (e.g. only devil_reply) disables everything, even with no UI lock
  const d = dagModel(obs(), fixture(), false, [{ cmd: "devil_reply", deal: null }]);
  assert.ok(flat(d).filter((n) => n.state === "next").every((n) => n.disabled === "Not possible right now."));
  const ok = dagModel(obs(), fixture(), false, [{ cmd: "go", n: 2 }]);
  assert.deepEqual(flat(ok).filter((n) => n.state === "next").map((n) => [n.id, n.disabled === null]), [["b", false], ["c", true]]);
});

test("panelKinds: devil at deals, shop only at the village, single-use choices at campfire and well, fight beats all", () => {
  const k = (kind: Observation["kind"], enemy: Observation["enemy"] = null) => panelKinds({ kind, enemy });
  assert.deepEqual(k("deal"), ["devil"]);
  assert.deepEqual(k("village"), ["shop"]);
  assert.deepEqual(k("campfire"), ["choose"]);
  assert.deepEqual(k("well"), ["choose"]); // single use, so not a shop
  // The devil's table beside the choices while he is there and listening (or an offer stands).
  const d = (kind: Observation["kind"], over: Partial<Observation>) => panelKinds({ kind, enemy: null, devilPresent: true, asksLeft: 3, offer: null, ...over });
  assert.deepEqual(d("campfire", {}), ["choose", "devil"]);
  assert.deepEqual(d("campfire", { asksLeft: 0 }), ["choose"], "rested, trained or decided");
  assert.deepEqual(d("well", {}), ["choose", "devil"]);
  assert.deepEqual(d("well", { asksLeft: 0, offer: { dialogue: "x", effects: {} } }), ["choose", "devil"], "haggled out, offer still standing");
  assert.deepEqual(d("well", { devilPresent: false, asksLeft: 0 }), ["choose"], "no devil at this well");
  assert.deepEqual(k("fight"), []);
  assert.deepEqual(k("final"), []);
  const foe = { name: "cave rat", hp: 3, maxHp: 3, boss: false };
  assert.deepEqual(k("fight", foe), ["fight"]);
  assert.deepEqual(k("boss", foe), ["fight"]);
});

test("devil phase and how a deal ended come from the engine flags plus the log", () => {
  const offer = { dialogue: "x", effects: { gold: 1 } };
  assert.equal(devilPhase({ resolved: false, offer: null }, null), "ask");
  assert.equal(devilPhase({ resolved: false, offer }, null), "offer");
  assert.equal(devilPhase({ resolved: true, offer: null }, "struck"), "struck");
  assert.equal(devilPhase({ resolved: true, offer: null }, "walked"), "walked");
  assert.equal(devilPhase({ resolved: true, offer: null }, null), "settled");
  assert.equal(dealEnd([{ type: "deal_refused" }, { type: "deal_offered", deal: offer }]), "walked");
  assert.equal(dealEnd([{ type: "deal_applied", deal: offer, changes: {} }, { type: "deal_refused" }]), "struck"); // newest wins
  assert.equal(dealEnd([{ type: "moved", from: "a", to: "b", kind: "deal", act: 0 }, { type: "deal_refused" }]), null); // an older node's deal
  assert.equal(dealEnd([]), null);
  assert.equal(haggleText(2, true), "Haggles left: 2");
  assert.match(haggleText(0, true), /Haggles left: 0/);
  assert.match(haggleText(3, false), /3 times/);
  assert.equal(questionsText(7), "Questions left this run: 7");
});

test("askBlockReason: the run-wide limit outranks the per-node haggle limit; null while asking works", () => {
  assert.equal(askBlockReason({ questionsLeft: 4, asksLeft: 2 }), null);
  assert.match(askBlockReason({ questionsLeft: 4, asksLeft: 0 })!, /done haggling/);
  assert.equal(askBlockReason({ questionsLeft: 0, asksLeft: 2 }), "The devil has heard enough from you this run.");
  assert.equal(askBlockReason({ questionsLeft: 0, asksLeft: 0 }), "The devil has heard enough from you this run.");
});

test("shop lists price tags at the village only; the well's blessing is a single-use choice", () => {
  const g = createGame("ui-1"), o = g.observe();
  const village = { ...o, kind: "village" as const, state: { ...o.state, gold: 10, hp: o.state.maxHp - 5 } };
  const items = shopItems(village, availableActions(village));
  assert.deepEqual(items.map((i) => [i.item, i.cost, i.affordable, i.reason]), [["heal", 10, true, null], ["blade", 12, false, "need 2 more gold"]]);
  const well = { ...o, kind: "well" as const, resolved: false, state: { ...o.state, gold: 12 } };
  assert.deepEqual(shopItems(well, availableActions(well)), []);
  assert.deepEqual(chooseCards(well, availableActions(well)).map((c) => [c.key, c.state]), [["blessing", "available"]]);
  const broke = { ...well, state: { ...well.state, gold: 5 } };
  const [c] = chooseCards(broke, availableActions(broke));
  assert.deepEqual([c.state, c.note], ["short", "need 3 more gold"]);
  assert.deepEqual(chooseCards({ ...well, resolved: true }, availableActions({ ...well, resolved: true })).map((c) => c.state), ["chosen"]);
  const camp = { ...o, kind: "campfire" as const, resolved: false, devilPresent: true, asksLeft: 3 };
  assert.deepEqual(chooseCards(camp, availableActions(camp)).map((c) => [c.key, c.state]), [["rest", "available"], ["train", "available"], ["deal", "available"]]);
  const spent = { ...camp, resolved: true }, cards = (f: FireChoice) => chooseCards(spent, availableActions(spent), f).map((c) => c.state);
  assert.deepEqual(cards("rest"), ["chosen", "closed", "closed"]);
  assert.deepEqual(cards("train"), ["closed", "chosen", "closed"]);
  assert.deepEqual(cards("deal"), ["closed", "closed", "chosen"]);
  assert.deepEqual(cards(null), ["closed", "closed", "closed"], "a resumed run cannot say which");
  const talking = { ...camp, asksLeft: 2 };
  assert.deepEqual(chooseCards(talking, availableActions(talking)).map((c) => c.state), ["closed", "closed", "chosen"], "the first ask spends the fire");
  const mute = { ...camp, questionsLeft: 0 };
  assert.deepEqual(chooseCards(mute, availableActions(mute)).map((c) => [c.state, c.note])[2], ["short", "The devil has heard enough from you this run."]);
  const strong = { ...camp, state: { ...camp.state, attack: 12 } };
  assert.deepEqual(chooseCards(strong, availableActions(strong)).map((c) => [c.key, c.state, c.note]).slice(0, 2), [["rest", "available", null], ["train", "short", "Attack is already at its peak (12)"]]);
  assert.deepEqual(chooseCards(village, availableActions(village)), []);
});

test("real engine: one pick resolves campfire and well; the village keeps selling", () => {
  // Walk seeds until each kind turns up, driving the engine with the bot-ish rule: take exit 1, fight when blocked.
  const seen = new Set<string>();
  for (let i = 0; i < 60 && !["village", "well", "campfire", "train"].every((k) => seen.has(k)); i++) {
    const g = createGame(`panel-${i}`);
    for (let step = 0; step < 60; step++) {
      const v = g.view();
      if (v.ending) break;
      const A = availableActions(v, false, v.actions);
      if (v.kind === "campfire" && !v.resolved) {
        assert.deepEqual(chooseCards(v, A).map((c) => c.state), ["available", "available", "available"]);
        assert.deepEqual(panelKinds(v), ["choose", "devil"]);
        assert.ok(A.rest && A.train);
        const pick = seen.has("campfire") ? "train" : "rest"; // try both across the walk
        const r = pick === "train" ? g.train() : g.rest(); const after = g.view();
        const log = [...r.events].reverse(), Aft = availableActions(after, false, after.actions);
        assert.equal(fireChoice([...log, { type: "moved", from: "x", to: v.nodeId, kind: "campfire", act: v.act }]), pick);
        assert.deepEqual(chooseCards(after, Aft, pick).map((c) => c.state), pick === "rest" ? ["chosen", "closed", "closed"] : ["closed", "chosen", "closed"]);
        assert.ok(!after.actions.some((c) => c.cmd === "rest" || c.cmd === "train" || c.cmd === "deal"), "one of the three, never two");
        assert.deepEqual(panelKinds(after), ["choose"], "the devil leaves a spent fire");
        if (pick === "train") { assert.equal(after.state.attack, v.state.attack + 1); seen.add("train"); }
        seen.add("campfire");
      }
      if (v.kind === "village" && v.state.gold >= 10) {
        g.buy("heal"); const after = g.view();
        assert.deepEqual(panelKinds(after), ["shop"]);
        assert.ok(after.actions.some((c) => c.cmd === "buy" && c.item === "heal") === (after.state.gold >= 10));
        seen.add("village");
      }
      if (v.kind === "well" && v.state.gold >= 8 && !v.resolved) {
        g.buy("blessing"); const after = g.view();
        assert.ok(after.resolved && !after.actions.some((c) => c.cmd === "buy"));
        assert.equal(chooseCards(after, availableActions(after, false, after.actions))[0].state, "chosen");
        assert.ok(!after.actions.some((c) => c.cmd === "deal"), "the blessing locks the devil's deal (one choice per well)");
        assert.deepEqual(panelKinds(after), ["choose"]);
        seen.add("well");
      }
      if (v.enemy) g.fight(); else if (v.exits.length) g.go(1); else break;
    }
  }
  assert.ok(seen.has("campfire") && seen.has("train"), `saw ${[...seen]}`);
});

test("fireChoice reads what was done at this campfire from the log (newest first)", () => {
  const moved: GameEvent = { type: "moved", from: "a", to: "b", kind: "campfire", act: 0 };
  assert.equal(fireChoice([{ type: "trained", amount: 1, attack: 4 }, moved]), "train");
  assert.equal(fireChoice([{ type: "healed", amount: 5, source: "the campfire", hp: 30 }, moved]), "rest");
  assert.equal(fireChoice([moved]), "rest", "rested at full HP: no healed event, still a rest");
  assert.equal(fireChoice([{ type: "started", seed: "x" }]), null);
  assert.equal(fireChoice([]), null);
  assert.equal(eventClass({ type: "trained", amount: 1, attack: 4 }), "ev-good");
});

test("planarOrder: removes avoidable crossings; every real act is planar in the generator's own order", async () => {
  const { planarOrder } = await import("./logic");
  // Two crossed edges: a->d, b->c with order [a,b] / [c,d] crosses once; reordering the top layer fixes it.
  const r = planarOrder([["a", "b"], ["c", "d"]], [["a", "d"], ["b", "c"]]);
  assert.equal(r.crossings, 0);
  // K2,2 is planar in layers; K-style full bipartite 2x2 always has 1 crossing.
  assert.equal(planarOrder([["a", "b"], ["c", "d"]], [["a", "c"], ["a", "d"], ["b", "c"], ["b", "d"]]).crossings, 1);
  const { generateAct } = await import("../map");
  let planar = 0, total = 0;
  for (let s = 0; s < 300; s++) for (let a = 0; a < 3; a++) {
    const act = generateAct(`p${s}`, a);
    const layers: string[][] = [];
    for (const n of act.nodes) (layers[n.layer] ??= []).push(n.id);
    const edges = act.nodes.flatMap((n) => n.next.map((t) => [n.id, t] as [string, string]));
    const res = planarOrder(layers, edges);
    total++; if (res.crossings === 0) planar++;
    for (const l of res.order) assert.ok(l.length <= 4);
    assert.deepEqual(res.order, layers, "the generator's slot order is already crossing-free, so it is kept");
  }
  assert.equal(planar, total, `planar ${planar}/${total}`);
  console.log(`# planar acts: ${planar}/${total}`);
});

test("devil strikes: the log shows the anger card until an offer, a decision or a move replaces it; Outcome marks it bad", () => {
  const struck: GameEvent = { type: "devil_struck", dialogue: "Speak plainly or bleed.", effects: { hp: -4 } };
  const offered: GameEvent = { type: "deal_offered", deal: { dialogue: "x", effects: {} } };
  assert.equal(eventClass(struck), "ev-bad");
  assert.equal(STRIKE_HEAD, "The devil strikes!");
  assert.deepEqual(lastStrike([struck, { type: "moved", from: "a", to: "b", kind: "deal", act: 0 }]), { dialogue: "Speak plainly or bleed.", effects: { hp: -4 } });
  assert.equal(lastStrike([]), null);
  assert.equal(lastStrike([offered, struck]), null, "a newer offer replaces the card");
  assert.ok(lastStrike([struck, offered]), "a strike newer than a standing offer shows beside it");
  assert.ok(lastStrike([{ type: "revived", hp: 15 }, struck]), "revival does not hide it");
  for (const e of [{ type: "deal_applied", deal: { dialogue: "x", effects: {} }, changes: {} }, { type: "deal_refused" }, { type: "moved", from: "a", to: "b", kind: "fight", act: 0 }, { type: "started", seed: "s" }] as GameEvent[])
    assert.equal(lastStrike([e, struck]), null, e.type);
  assert.deepEqual(effectChips(struck.type === "devil_struck" ? struck.effects : {}), [{ text: "−4 HP", tone: "bad" }]);
});

test("diffDeal explains how a forced strike was cut down", () => {
  const raw = { dialogue: "x", forced: true, effects: { hp: -20, gold: 50 }, curse: { trigger: "on_hit", effect: { hp: -1 } } };
  const notes = diffDeal(raw, sanitizeDeal(raw));
  assert.ok(notes.some((c) => c.path === "effects.hp" && /at most 8/.test(c.note)));
  assert.ok(notes.some((c) => c.path === "effects.gold") && notes.some((c) => c.path === "curse"));
  assert.ok(!notes.some((c) => c.path === "forced"), "forced is a known field");
});

test("eventText: the Outcome speaks to the player, with no console commands or node ids", () => {
  const deal = { dialogue: "A bargain.", effects: { gold: 10, hp: -3 }, curse: { trigger: "on_hit" as const, effect: { hp: -2 } }, rewrite: { nodeId: "a0n3", to: "fight" as const } };
  const offer = eventText({ type: "deal_offered", deal });
  assert.ok(offer.includes("A bargain.") && offer.includes("+10 Gold, −3 HP") && offer.includes("when you are hit: −2 HP") && offer.includes("Accept or refuse?"), offer);
  assert.ok(!/\(\)|->/.test(offer), offer);
  const text = [
    eventText({ type: "moved", from: "a0n1", to: "final", kind: "final", act: 2 }),
    eventText({ type: "devil_struck", dialogue: "Insolent.", effects: { hp: -3 } }),
    eventText({ type: "curse_added", curse: deal.curse }),
    eventText({ type: "curse_fired", trigger: "on_hit", effect: { hp: -2 }, changes: { hp: -2 } }),
  ].join("\n");
  assert.ok(!/\(\)|->|final \(final\)|you take: HP/.test(text), text);
  assert.ok(text.includes("You take −3 HP") && text.includes("You reach the final door."), text);
  const g = createGame("demo"), l = g.look().events[0];
  assert.equal(eventText(l), describe(l), "other events keep describe()'s wording");
});

test("real engine: a deal at the campfire shows on the choice cards and the devil's table, then spends the fire", async () => {
  const s = initialState("ui-fire");
  s.acts[0].nodes[0].kind = "campfire";
  const g = restoreGame(s);
  const v = g.view(), A = availableActions(v, false, v.actions);
  assert.ok(A.ask && A.ask.enabled && !A.ask.again);
  const r = await g.deal("gold");
  const mid = g.view(), log = [...r.events].reverse(), Am = availableActions(mid, false, mid.actions);
  assert.equal(fireChoice(log), "deal");
  assert.deepEqual(chooseCards(mid, Am, fireChoice(log)).map((c) => c.state), ["closed", "closed", "chosen"]);
  assert.deepEqual(panelKinds(mid), ["choose", "devil"]);
  assert.equal(devilPhase(mid, dealEnd(log)), "offer");
  assert.ok(!Am.rest && !Am.train && Am.offer);
  const end = g.refuse(), after = g.view(), log2 = [...[...end.events].reverse(), ...log];
  assert.equal(fireChoice(log2), "deal");
  assert.deepEqual(chooseCards(after, availableActions(after, false, after.actions), fireChoice(log2)).map((c) => c.state), ["closed", "closed", "chosen"]);
  assert.deepEqual(panelKinds(after), ["choose"]);
  assert.ok(!after.actions.some((c) => ["rest", "train", "deal"].includes(c.cmd)), "refusing still spent the fire");
});

test("chooseCards: at a well, asking the devil closes the blessing, with the reason", () => {
  const A = { rest: false, buy: [{ item: "blessing" as const, cost: 8, affordable: true }] };
  const o = { kind: "well" as const, resolved: false, state: { hp: 30, maxHp: 30, gold: 20, attack: 3, soul: 1 as const, act: 0, nodeId: "w", log: [] }, devilPresent: true };
  assert.equal(chooseCards({ ...o, asksLeft: MAX_ASKS }, A)[0].state, "available");
  const [c] = chooseCards({ ...o, asksLeft: MAX_ASKS - 1 }, { ...A, buy: [] });
  assert.equal(c.state, "closed");
  assert.match(c.note!, /chose the devil/);
});

test("eventText: no node ids in any event, whatever the engine's console text says", () => {
  const events: GameEvent[] = [
    { type: "moved", from: "a0n1", to: "a0n6", kind: "deal", act: 0 },
    { type: "node_rewritten", change: { nodeId: "a0n6", from: "fight", to: "campfire", polarityFlip: true } },
    { type: "rewrite_failed", nodeId: "a0n6", reason: "unknown node a0n6" },
    { type: "deal_offered", deal: { dialogue: "A bargain.", effects: { gold: 5 }, rewrite: { nodeId: "a0n6", to: "fight" } } },
    { type: "rejected", reason: "drowned monk blocks the way; fight()" },
    { type: "rejected", reason: "no exit 3; choose 1..2" },
    { type: "enemy_appeared", enemy: { name: "ash hound", hp: 9, maxHp: 9, boss: false } },
  ];
  for (const e of events) assert.ok(!/\ba\d+n\d+\b|\(\)|->|fight_result/.test(eventText(e)), `${e.type}: ${eventText(e)}`);
  assert.equal(eventText(events[0]), "You come to the devil's table.");
  assert.equal(eventText(events[1]), "The devil turned a fight ahead into a campfire (good turned bad, or the reverse).");
  assert.match(eventText(events[3]), /a stop ahead becomes a fight/);
});

test("rewriteText says what the node is when the map is known, and never its id", () => {
  const m = fixture(); // b is a fight
  assert.equal(rewriteText({ nodeId: "b", to: "campfire" }, kindLookup(m)), "a fight ahead becomes a campfire");
  assert.equal(rewriteText({ nodeId: "nope", to: "well" }, kindLookup(m)), "a stop ahead becomes a well");
  assert.equal(rewriteText({ nodeId: "b", to: "well" }), "a stop ahead becomes a well");
  assert.match(eventText({ type: "deal_offered", deal: { dialogue: "x", effects: {}, rewrite: { nodeId: "b", to: "campfire" } } }, kindLookup(m)), /a fight ahead becomes a campfire/);
});

test("rejectedText drops console hints and ends with a full stop", () => {
  assert.equal(rejectedText("the devil is waiting for your answer: accept() or refuse()"), "the devil is waiting for your answer.");
  assert.equal(rejectedText("rat blocks the way; fight()"), "rat blocks the way.");
  assert.equal(rejectedText("nobody asked the devil anything; deal() first"), "nobody asked the devil anything.");
  assert.equal(rejectedText("the fight is still on; send fight_result"), "the fight is still on.");
  assert.equal(rejectedText("no exit 3; choose 1..2"), "That way is not open.");
  assert.equal(rejectedText("the embers are spent"), "the embers are spent.");
  assert.equal(rejectedText("fight()"), "That is not possible right now.");
});

test("capitalize: sentences start with a capital, quotes and the devil's words are left alone", () => {
  assert.equal(capitalize("drowned monk falls. +4 gold."), "Drowned monk falls. +4 gold.");
  assert.equal(capitalize("the unlit falls."), "The unlit falls.");
  assert.equal(capitalize("(rat blocks the way)"), "(Rat blocks the way)");
  assert.equal(capitalize("Already fine."), "Already fine.");
  assert.equal(capitalize('  he gives: x\nthe price'), "  He gives: x\nThe price");
  assert.equal(capitalize('The devil: "yes. perhaps."'), 'The devil: "yes. perhaps."');
  assert.equal(capitalize("+4 gold"), "+4 gold");
  assert.equal(capitalize(""), "");
});

test("eventText: the fight summary starts every sentence with a capital", () => {
  const slain = eventText({ type: "enemy_slain", name: "drowned monk", gold: 4, boss: false });
  assert.equal(slain, "Drowned monk falls. +4 gold.");
  const bout = eventText({ type: "fought", dealt: 9, enemyHp: 0, taken: 0, bout: { timeMs: 20100, hits: 0, enemy: "drowned monk", outcome: "won" } });
  assert.equal(bout, "After 20.1 s of fighting you dealt 9 and took no damage.");
  assert.equal(eventText({ type: "rejected", reason: "the embers are spent" }), "The embers are spent.");
  assert.equal(eventText({ type: "enemy_appeared", enemy: { name: "cave rat", hp: 6, maxHp: 6, boss: false } }), "An enemy appears: cave rat (6 HP).");
});

test("shopGuard: a heal at full HP is pointless (UI-only); nothing else is guarded", () => {
  assert.equal(pointlessBuy("heal", 30, 30), FULL_HEALTH);
  assert.equal(pointlessBuy("heal", 31, 30), FULL_HEALTH);
  assert.equal(pointlessBuy("heal", 29, 30), null);
  assert.equal(pointlessBuy("blade", 30, 30), null);
  assert.equal(pointlessBuy("blessing", 30, 30), null);
  assert.equal(pointlessBuy("heal", undefined, undefined), null, "unknown HP: leave it to the engine");
  assert.equal(pointlessBuy("heal", 0, 0), null);
  assert.equal(FULL_HEALTH, "You're at full health");
});

test("DOM shop: the Heal card is disabled at full HP with the reason, enabled when hurt", () => {
  const g = createGame("ui-1"), o = g.observe();
  const at = (hp: number) => { const v = { ...o, kind: "village" as const, state: { ...o.state, gold: 99, hp } }; return shopItems(v, availableActions(v)); };
  const [healFull, bladeFull] = at(o.state.maxHp);
  assert.deepEqual([healFull.item, healFull.affordable, healFull.reason], ["heal", false, FULL_HEALTH]);
  assert.deepEqual([bladeFull.item, bladeFull.affordable, bladeFull.reason], ["blade", true, null], "the blade is not guarded");
  const [healHurt] = at(o.state.maxHp - 1);
  assert.deepEqual([healHurt.affordable, healHurt.reason], [true, null]);
});

test("placeWord tells siblings apart without ids", () => {
  assert.equal(placeWord(0, 1), "");
  assert.deepEqual([0, 1].map((i) => placeWord(i, 2)), ["on the left", "on the right"]);
  assert.deepEqual([0, 1, 2].map((i) => placeWord(i, 3)), ["on the left", "in the middle", "on the right"]);
  assert.equal(new Set([0, 1, 2, 3].map((i) => placeWord(i, 4))).size, 4);
  assert.equal(placeWord(4, 6), "5 of 6 from the left");
});

test("map labels name no node id, on a real act", () => {
  const g = createGame("label-ids"), v = g.view();
  const d = dagModel(v, v.map, false, v.actions);
  for (const n of d.rows.flat()) assert.ok(!/\ba\d+n\d+\b/.test(n.label), n.label);
});
