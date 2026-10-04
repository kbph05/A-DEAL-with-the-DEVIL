import { test } from "node:test";
import assert from "node:assert/strict";
import { WARES, initialState, step, view, type GameState } from "../game";
import { exitPrompt, shopPrompt } from "./shopZone";
import { sceneById } from "./scenes";
import { pointIn, type SceneZone } from "./scene";

const village = sceneById("village")!;
const zone = (item: string): SceneZone => village.zones!.find((z) => z.kind === "shop" && z.item === item)!;
const withGold = (s: GameState, gold: number): GameState => ({ ...s, player: { ...s.player, gold } });
const withHp = (s: GameState, hp: number): GameState => ({ ...s, player: { ...s.player, hp } });

test("village: three stalls, one shop zone per engine ware, and an exit", () => {
  const shops = village.zones!.filter((z) => z.kind === "shop");
  assert.deepEqual(shops.map((z) => z.item).sort(), Object.keys(WARES).sort());
  assert.deepEqual(shops.map((z) => z.label), ["Healer", "Smith", "Shrine"]);
  for (const z of shops) assert.ok(village.actors!.some((a) => a.label === z.label && a.id.startsWith("stall-")), z.id);
  const exit = village.zones!.find((z) => z.kind === "exit")!;
  assert.equal(exit.label, "Leave the village");
  assert.equal(exitPrompt(exit), "Leave the village (map: coming soon)");
});

test("village: the stalls form an evenly spaced row on the top edge, outside bounds; each buy zone is in front of its stall", () => {
  const b = village.bounds;
  const stalls = village.actors!.filter((a) => a.id.startsWith("stall-")).sort((p, q) => p.x - q.x);
  assert.equal(stalls.length, 3);
  const gaps = stalls.slice(1).map((a, i) => a.x - stalls[i].x);
  assert.ok(gaps.every((g) => g === gaps[0]), "even spacing");
  for (const a of stalls) {
    assert.ok(a.y < b.y && !pointIn(a, b), `${a.id} stands just above the bounds' top edge, not in the walkable area`);
    assert.equal(a.y, stalls[0].y, "one line");
    const z = village.zones!.find((q) => q.kind === "shop" && q.label === a.label)!;
    assert.equal(z.y, b.y, `${z.id} touches the bounds' top edge`);
    assert.ok(z.x >= b.x && z.x + z.w <= b.x + b.w && z.y + z.h <= b.y + b.h, `${z.id} lies inside bounds`);
    assert.ok(Math.abs(z.x + z.w / 2 - a.x) <= 1, `${z.id} is centred on its stall`);
  }
  assert.ok(pointIn(village.spawn, b));
  assert.ok(village.actors!.every((a) => a.y < b.y || !a.id.startsWith("house-")), "cottages are on the edge too");
});

test("shopPrompt: enabled exactly when the engine lists the buy, and Buy sends it", () => {
  const s = withHp(withGold(initialState("shop-test"), WARES.heal.cost + 5), 20); // hurt, so a heal is worth buying
  const v = view(s);
  assert.equal(v.kind, "village", "act 1 starts at the village");
  const heal = shopPrompt(zone("heal"), v);
  assert.equal(heal.enabled, v.actions.some((c) => c.cmd === "buy" && c.item === "heal"));
  assert.equal(heal.price, WARES.heal.cost);
  assert.match(heal.title, /Healer: Heal/);
  assert.match(heal.desc, /12 HP/);
  if (v.state.gold >= WARES.heal.cost) {
    assert.ok(heal.enabled);
    assert.equal(heal.reason, undefined);
    const r = step(s, heal.command!);
    assert.ok(r.ok);
    assert.equal(r.state.player.gold, s.player.gold - WARES.heal.cost);
    assert.ok(r.events.some((e) => e.type === "bought"));
  }
});

test("shopPrompt: disabled with a reason (gold, wrong node, spent well, not a shop)", () => {
  const s = initialState("shop-test");
  const poor = shopPrompt(zone("blade"), view(withGold(s, 3)));
  assert.equal(poor.enabled, false);
  assert.equal(poor.reason, "Not enough gold: need 12g, you have 3g");
  assert.equal(poor.command, undefined);
  const rich = shopPrompt(zone("blade"), view(withGold(s, 99)));
  assert.equal(rich.enabled, true);
  assert.deepEqual(rich.command, { cmd: "buy", item: "blade" });

  const shrine = shopPrompt(zone("blessing"), view(withGold(s, 99)));
  assert.equal(shrine.enabled, false, "the engine sells blessings at wells only");
  assert.equal(shrine.reason, "Only sold at a well, not in the village");

  const base = { state: { gold: 99 }, actions: [] };
  assert.equal(shopPrompt(zone("heal"), { ...base, kind: "fight" }).reason, "Not at a shop (this is a fight node)");
  assert.equal(shopPrompt(zone("blessing"), { ...base, kind: "well", resolved: true }).reason, "The well has given what it will give");
  assert.equal(shopPrompt(zone("blessing"), { ...base, kind: "well", actions: [{ cmd: "buy", item: "blessing" }] }).enabled, true);
  assert.equal(shopPrompt(zone("heal"), { ...base, kind: "village", ending: "lose" }).reason, "The run is over");
  assert.equal(shopPrompt(zone("heal"), { ...base, kind: "village", pending: true }).reason, "The devil is speaking");
  const odd = shopPrompt({ id: "x", x: 0, y: 0, w: 1, h: 1, kind: "shop", item: "potion", label: "Odd" }, view(s));
  assert.deepEqual([odd.enabled, odd.price, odd.reason], [false, null, "Nothing for sale here"]);
});

test("shopPrompt: a well's blessing is locked once the devil was asked there (one choice per well)", () => {
  const z = { id: "well", kind: "shop" as const, item: "blessing", label: "Well", x: 0, y: 0, w: 1, h: 1 };
  const p = shopPrompt(z, { kind: "well", state: { gold: 20 }, actions: [], resolved: false, devilPresent: true, asksLeft: 2 });
  assert.equal(p.enabled, false);
  assert.equal(p.reason, "You chose the devil at this well");
});

test("shopPrompt: a heal at full health is disabled with the reason (UI-only: the engine still lists the buy)", () => {
  const s = withGold(initialState("shop-test"), 99);
  const full = view(s);
  assert.equal(full.state.hp, full.state.maxHp);
  assert.ok(full.actions.some((c) => c.cmd === "buy" && c.item === "heal"), "the engine would take the gold");
  const heal = shopPrompt(zone("heal"), full);
  assert.deepEqual([heal.enabled, heal.reason, heal.command], [false, "You're at full health", undefined]);
  assert.equal(heal.price, WARES.heal.cost, "the price is still shown");
  const hurt = shopPrompt(zone("heal"), view(withHp(s, full.state.maxHp - 1)));
  assert.deepEqual([hurt.enabled, hurt.reason, hurt.command], [true, undefined, { cmd: "buy", item: "heal" }]);
  assert.equal(shopPrompt(zone("blade"), full).enabled, true, "other wares are not guarded");
});
