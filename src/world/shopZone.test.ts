import { test } from "node:test";
import assert from "node:assert/strict";
import { WARES, initialState, step, view, type GameState } from "../game";
import { exitPrompt, shopPrompt } from "./shopZone";
import { sceneById } from "./scenes";
import { pointIn, type SceneZone } from "./scene";

const village = sceneById("village")!;
// The village has no shrine (blessings are sold at wells), so a blessing zone is a stand-in for the well panel's own.
const zone = (item: string): SceneZone => village.zones!.find((z) => z.kind === "shop" && z.item === item) ?? { id: item, kind: "shop", item, label: item, x: 0, y: 0, w: 1, h: 1 };
const withGold = (s: GameState, gold: number): GameState => ({ ...s, player: { ...s.player, gold } });
const withHp = (s: GameState, hp: number): GameState => ({ ...s, player: { ...s.player, hp } });

test("village: the Healer and the Smith (the designer's two shopfronts), and an exit; no shrine, blessings are a well's", () => {
  const shops = village.zones!.filter((z) => z.kind === "shop");
  assert.deepEqual(shops.map((z) => z.item).sort(), ["blade", "heal"]);
  assert.deepEqual(shops.map((z) => z.label).sort(), ["Healer", "Smith"]);
  assert.ok(!village.zones!.some((z) => z.item === "blessing"));
  const exit = village.zones!.find((z) => z.kind === "exit")!;
  assert.equal(exit.label, "Leave the village");
  assert.equal(exitPrompt(exit), "Leave the village (map: coming soon)");
});

test("village: the shopfronts are drawn in assets/village.png (2x), above the walkable strip; each buy zone is in front of its shop", () => {
  const b = village.bounds;
  assert.deepEqual(village.size, { w: 768, h: 512 }, "the 384x256 picture at exactly 2x");
  assert.ok(!village.actors || village.actors.length === 0, "no generated stalls drawn over the art");
  // Shopfront spans in picture pixels (x ranges, from the image), times 2: the Smith's 112-188 and the Healer's 270-338.
  const front = { Smith: [224, 376], Healer: [540, 676] } as const;
  const BUILDING_FRONT_Y = 176; // the buildings' bottom edge, 88 px x 2
  assert.ok(b.y >= BUILDING_FRONT_Y, "the walkable rect starts below the buildings, so you can't walk into them");
  for (const z of village.zones!.filter((q) => q.kind === "shop")) {
    const [x0, x1] = front[z.label as keyof typeof front];
    assert.equal(z.y, b.y, `${z.id} touches the bounds' top edge, in front of its shop`);
    assert.ok(z.x >= b.x && z.x + z.w <= b.x + b.w && z.y + z.h <= b.y + b.h, `${z.id} lies inside bounds`);
    assert.ok(z.x >= x0 && z.x + z.w <= x1, `${z.id} lies under its shopfront (${x0}-${x1})`);
  }
  assert.ok(pointIn(village.spawn, b));
  const exit = village.zones!.find((z) => z.kind === "exit")!;
  assert.ok(exit.x + exit.w === b.x + b.w, "the exit is on the east edge");
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
