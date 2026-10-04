import assert from "node:assert/strict";
import { test } from "node:test";
import { initialState, MAX_DEVIL_QUERIES, step, view, type GameState } from "../game";
import { announce, curseInfo, effectText, hudModel } from "./model";

const deepFreeze = <T>(o: T): T => {
  if (typeof o === "object" && o !== null) { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
};
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

test("hudModel: a new run (village, 10g) shows stats and the shop; heal usable, blade short of gold", () => {
  const m = hudModel(initialState("hud"));
  assert.equal(m.hp, 30); assert.equal(m.maxHp, 30); assert.equal(m.gold, 10); assert.equal(m.attack, 3);
  assert.equal(m.speed, null);
  assert.equal(m.soul, "kept"); assert.equal(m.revive, "available");
  assert.equal(m.kind, "village"); assert.equal(m.act, 1); assert.equal(m.layer, 1); assert.ok(m.layers! >= 6);
  assert.deepEqual(m.items.map((i) => [i.id, i.usable, i.reason, i.cost, i.count]), [["heal", true, null, 10, null], ["blade", false, "need 2g more", 12, null]]);
  assert.deepEqual(m.items[0].command, { cmd: "buy", item: "heal" });
  assert.deepEqual(m.devil, { questionsLeft: MAX_DEVIL_QUERIES, max: MAX_DEVIL_QUERIES, asksLeft: null });
  assert.deepEqual(m.curses, []); assert.equal(m.ending, null); assert.equal(m.busy, null);
});

test("hudModel: a GameState and its View give the same model; inputs are not mutated", () => {
  let s = initialState("same");
  for (const c of [{ cmd: "buy", item: "heal" }, { cmd: "go", n: 1 }] as const) s = step(s, c).state;
  const frozen = deepFreeze(clone(s));
  assert.deepEqual(hudModel(frozen), hudModel(view(s)));
  assert.equal(hudModel(frozen).layer, 2);
});

test("hudModel: tolerates empty, partial and junk input", () => {
  for (const x of [undefined, null, 42, "x", [], {}, { state: null }, { state: { hp: "a" } }, { map: { layers: "no" }, actions: "no", curses: [null, 3] }]) {
    const m = hudModel(x);
    assert.ok(Number.isFinite(m.hp) && m.maxHp >= 1 && m.items.length === 0, JSON.stringify(x));
  }
  const m = hudModel({ state: { hp: 7, maxHp: 20, gold: 3 } });
  assert.deepEqual([m.hp, m.maxHp, m.gold, m.attack, m.layer, m.kind], [7, 20, 3, 0, null, ""]);
  assert.equal(hudModel({ state: { hp: 99, maxHp: 20 } }).hp, 20, "hp clamped to maxHp");
});

test("hudModel: speed and inventory show only when present", () => {
  const s = initialState("speed");
  const fast = clone(s); (fast.player as unknown as Record<string, unknown>).speed = 1.5;
  assert.equal(hudModel(fast).speed, 1.5);
  assert.equal(hudModel({ ...view(s), state: { ...view(s).state, speed: 2 } }).speed, 2);
  const v = { ...view(s), inventory: { heal: 2, junk: 0 }, actions: [...view(s).actions, { cmd: "use", item: "heal" }] };
  const held = hudModel(v).items.filter((i) => i.kind === "consumable");
  assert.deepEqual(held.map((i) => [i.id, i.count, i.usable]), [["heal", 2, true]]);
  const arr = hudModel({ state: { items: [{ id: "potion", count: 3 }] } }).items;
  assert.deepEqual(arr.map((i) => [i.label, i.count, i.usable, i.reason]), [["Potion", 3, false, "not now"]]);
});

test("hudModel: curses get a short label and a tooltip", () => {
  const s: GameState = { ...clone(initialState("curse")), curses: [{ trigger: "on_hit", effect: { hp: -4 } }, { trigger: "next_node", effect: { gold: -12 } }] };
  const m = hudModel(s);
  assert.deepEqual(m.curses.map((c) => c.label), ["On hit: -4 HP", "On leaving: -12 gold"]);
  assert.match(m.curses[0].tooltip, /fires once the next time an enemy hits you/);
  assert.equal(curseInfo({ trigger: "weird", effect: { attack: -1, luck: 2 } }).label, "weird: -1 ATK, +2 luck");
  assert.equal(effectText({}), "no effect");
});

test("hudModel: soul sold vs spent on a revival", () => {
  const base = clone(initialState("soul"));
  const sold = hudModel({ ...base, player: { ...base.player, soul: 0 } });
  assert.deepEqual([sold.soul, sold.revive], ["sold", "forfeit"]);
  const spent = hudModel({ ...base, player: { ...base.player, soul: 0, log: ["soul spent on a revival"] } });
  assert.deepEqual([spent.soul, spent.revive], ["spent", "used"]);
});

test("hudModel: devil counters on a deal node; items blocked while the devil speaks", () => {
  const v = { ...view(initialState("deal")), kind: "deal", asksLeft: 2, questionsLeft: 7 };
  assert.deepEqual(hudModel(v).devil, { questionsLeft: 7, max: MAX_DEVIL_QUERIES, asksLeft: 2 });
  const busy = hudModel({ ...view(initialState("busy")), pending: true, actions: [{ cmd: "devil_reply", deal: null }] });
  assert.equal(busy.busy, "devil");
  assert.deepEqual(busy.items.map((i) => [i.usable, i.reason]), [[false, "the devil is speaking"], [false, "the devil is speaking"]]);
});

test("hudModel: a pending realtime fight and the end of a run", () => {
  const fighting = hudModel({ ...view(initialState("f")), kind: "fight", actions: [{ cmd: "fight_result", won: false, hpLeft: 30 }] });
  assert.equal(fighting.busy, "fight");
  const over = hudModel({ ...view(initialState("e")), ending: "hell", actions: [] });
  assert.equal(over.ending, "hell");
  assert.ok(over.items.every((i) => !i.usable && i.reason === "the run is over"));
});

test("announce: only HP and gold changes, with direction", () => {
  const a = hudModel(initialState("ann"));
  assert.equal(announce(null, a), "");
  assert.equal(announce(a, a), "");
  assert.equal(announce(a, { ...a, hp: 24 }), "HP 24 of 30, down 6.");
  assert.equal(announce(a, { ...a, gold: 15, attack: 9 }), "Gold 15, up 5.");
  assert.equal(announce(a, { ...a, hp: 15, revive: "used", soul: "spent" }), "HP 15 of 30, down 15. Your soul paid for a revival.");
});
