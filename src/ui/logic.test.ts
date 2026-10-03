import { test } from "node:test";
import type { MapView, Observation } from "../game";
import assert from "node:assert/strict";
import { createGame, describe } from "../game";
import type { Command } from "../game";
import { availableActions, blurbOf, chooseCards, dealEnd, devilPhase, haggleText, panelKinds, shopItems, buyLabel, curseText, effectChips, eventClass, afterKinds, dagModel, exitNumber, fightLabel, lockReason, moveLock, nodeState, nodeTitle, outcomeEvents, pct, STAIRS_ID, topId } from "./logic";
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
  assert.equal(by.b.label, "Go to fight b, then deal");
  assert.equal(by.a.label, "You are here: deal a");
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
});

test("shop lists price tags at the village only; the well's blessing is a single-use choice", () => {
  const g = createGame("ui-1"), o = g.observe();
  const village = { ...o, kind: "village" as const, state: { ...o.state, gold: 12 } };
  const items = shopItems(village, availableActions(village));
  assert.deepEqual(items.map((i) => [i.item, i.cost, i.affordable, i.reason]), [["heal", 10, true, null], ["blade", 15, false, "need 3 more gold"]]);
  const well = { ...o, kind: "well" as const, resolved: false, state: { ...o.state, gold: 12 } };
  assert.deepEqual(shopItems(well, availableActions(well)), []);
  assert.deepEqual(chooseCards(well, availableActions(well)).map((c) => [c.key, c.state]), [["blessing", "available"]]);
  const broke = { ...well, state: { ...well.state, gold: 5 } };
  const [c] = chooseCards(broke, availableActions(broke));
  assert.deepEqual([c.state, c.note], ["short", "need 3 more gold"]);
  assert.deepEqual(chooseCards({ ...well, resolved: true }, availableActions({ ...well, resolved: true })).map((c) => c.state), ["chosen"]);
  const camp = { ...o, kind: "campfire" as const, resolved: false };
  assert.deepEqual(chooseCards(camp, availableActions(camp)).map((c) => [c.key, c.state]), [["rest", "available"]]);
  assert.deepEqual(chooseCards({ ...camp, resolved: true }, availableActions({ ...camp, resolved: true })).map((c) => c.state), ["chosen"]);
  assert.deepEqual(chooseCards(village, availableActions(village)), []);
});

test("real engine: one pick resolves campfire and well; the village keeps selling", () => {
  // Walk seeds until each kind turns up, driving the engine with the bot-ish rule: take exit 1, fight when blocked.
  const seen = new Set<string>();
  for (let i = 0; i < 40 && seen.size < 3; i++) {
    const g = createGame(`panel-${i}`);
    for (let step = 0; step < 60; step++) {
      const v = g.view();
      if (v.ending) break;
      const A = availableActions(v, false, v.actions);
      if (v.kind === "campfire" && !v.resolved) {
        assert.equal(chooseCards(v, A)[0].state, "available");
        g.rest(); const after = g.view();
        assert.equal(chooseCards(after, availableActions(after, false, after.actions))[0].state, "chosen");
        assert.ok(!after.actions.some((c) => c.cmd === "rest"));
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
        seen.add("well");
      }
      if (v.enemy) g.fight(); else if (v.exits.length) g.go(1); else break;
    }
  }
  assert.ok(seen.has("campfire"), `saw ${[...seen]}`);
});

test("planarOrder: removes avoidable crossings; real acts lay out with no crossings when possible", async () => {
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
    for (const l of res.order) assert.ok(l.length <= 3);
  }
  assert.ok(planar / total > 0.5, `planar ${planar}/${total}`);
  console.log(`# planar acts: ${planar}/${total}`);
});
