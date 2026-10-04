import assert from "node:assert/strict";
import { test } from "node:test";
import type { GameEvent } from "../game";
import { deltaChip, deltaChips, noticeOf, sceneTheme, shopIcon } from "./notice";
import { NOTICE_ICONS } from "./noticeIcons";

test("delta chips: +gold gold, −gold dim red, +HP green, −HP red, +ATK silver", () => {
  assert.deepEqual(deltaChip("gold", 5), { text: "+5 gold", tone: "gold" });
  assert.deepEqual(deltaChip("gold", -8), { text: "−8 gold", tone: "gold-loss" });
  assert.deepEqual(deltaChip("hp", 12), { text: "+12 HP", tone: "hp-up" });
  assert.deepEqual(deltaChip("hp", -3), { text: "−3 HP", tone: "hp-down" });
  assert.deepEqual(deltaChip("attack", 1), { text: "+1 ATK", tone: "atk" });
  assert.deepEqual(deltaChip("max_hp", 3), { text: "+3 max HP", tone: "hp-up" });
  assert.equal(deltaChip("gold", 0), null);
  assert.deepEqual(deltaChips({ hp: -2, attack: 1, gold: 4, soul: 0 }).map((c) => c.text), ["+4 gold", "−2 HP", "+1 ATK"]);
});

test("notice: a purchase shows its price as a gold-loss chip and what it did", () => {
  const n = noticeOf([{ type: "bought", item: "heal", cost: 10, changes: { hp: 12 } }])!;
  assert.equal(n.icon, "heart");
  assert.equal(n.title, "Bought heal");
  assert.deepEqual(n.chips, [{ text: "−10 gold", tone: "gold-loss" }, { text: "+12 HP", tone: "hp-up" }]);
  assert.equal(noticeOf([{ type: "bought", item: "blade", cost: 15, changes: { attack: 1 } }])!.icon, "sword");
});

test("notice: a rest, a sharpened weapon, a deal, a rejection", () => {
  const rest = noticeOf([{ type: "healed", amount: 12, source: "the campfire", hp: 30 }])!;
  assert.deepEqual([rest.icon, rest.reject, rest.chips], ["flame", false, [{ text: "+12 HP", tone: "hp-up" }]]);
  const train = noticeOf([{ type: "trained", amount: 1, attack: 4 }])!;
  assert.deepEqual([train.icon, train.chips.map((c) => c.tone)], ["sword", ["atk"]]);
  const deal = noticeOf([{ type: "deal_applied", deal: { dialogue: "", effects: {} } as never, changes: { gold: 20, hp: -5 } }])!;
  assert.deepEqual([deal.icon, deal.title, deal.chips.map((c) => c.tone)], ["devil", "Deal struck", ["gold", "hp-down"]]);
  const no = noticeOf([{ type: "rejected", reason: "not enough gold" }])!;
  assert.deepEqual([no.icon, no.reject, no.title, no.chips], ["cross", true, "Not enough gold.", []]);
  const refused = noticeOf([{ type: "deal_refused" }])!;
  assert.equal(refused.icon, "devil");
  assert.match(refused.title, /^You refuse/);
});

test("notice: nothing to say is null; extra events go in the detail line", () => {
  assert.equal(noticeOf([]), null);
  const ev: GameEvent[] = [{ type: "healed", amount: 5, source: "the campfire", hp: 9 }, { type: "curse_fired", trigger: "on_hit", effect: { hp: -1 }, changes: { hp: -1 } }];
  assert.deepEqual(noticeOf(ev)!.chips.map((c) => c.text), ["+5 HP", "−1 HP"]);
});

test("shop icon, scene theme", () => {
  assert.deepEqual(["heal", "blade", "blessing", undefined].map(shopIcon), ["heart", "sword", "coin", "coin"]);
  assert.equal(sceneTheme("village", "closed"), "village");
  assert.equal(sceneTheme("village", "open"), "map");
  assert.equal(sceneTheme("campfire", "forced"), "map");
  assert.equal(sceneTheme("fight", "closed"), "forest");
  assert.equal(sceneTheme("well", "closed"), "well");
  assert.equal(sceneTheme("campfire", "closed"), "campfire");
  assert.equal(sceneTheme("deal", "closed"), "dark");
  assert.equal(sceneTheme("village", "closed", true), "dark");
});

test("notice icons are 16x16", () => {
  for (const g of Object.values(NOTICE_ICONS)) { assert.equal(g.rows.length, 16); for (const r of g.rows) assert.equal(r.length, 16); }
});

// ---- the themes in play.css: text on every card must be WCAG AA (4.5:1) ------------------------------------------------
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("./play.css", import.meta.url), "utf8");
const lum = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** The custom properties a rule block with this selector sets (the theme blocks are single rules). */
function vars(selector: string): Record<string, string> {
  const blocks = [...css.matchAll(new RegExp(`^${selector.replace(/[[\]".]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "gm"))];
  assert.ok(blocks.length, `no rule for ${selector}`);
  return Object.fromEntries(blocks.flatMap((m) => [...m[1].matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((x) => [x[1], x[2]])));
}
test("themes: every card's text, button and chips are AA", () => {
  const base = vars(".play");
  const darkChips = vars(".play");
  const lightChips = vars('.play[data-scene="village"], .play[data-scene="map"]');
  for (const scene of ["dark", "village", "forest", "well", "campfire", "map"]) {
    const t = { ...base, ...(scene === "dark" ? {} : vars(`.play[data-scene="${scene}"]`)) };
    const chips = scene === "village" || scene === "map" ? { ...darkChips, ...lightChips } : darkChips;
    const need = (fg: string, bg: string, what: string): void => assert.ok(ratio(t[fg] ?? chips[fg], t[bg] ?? chips[bg]) >= 4.5, `${scene}: ${what} ${ratio(t[fg] ?? chips[fg], t[bg] ?? chips[bg]).toFixed(2)}`);
    need("--pc-ink", "--pc-bg", "ink"); need("--pc-dim", "--pc-bg", "dim"); need("--pc-warn", "--pc-bg", "reason line");
    need("--pc-btn-ink", "--pc-btn-bg", "button");
    for (const k of ["gold", "loss", "up", "down", "atk", "plain"]) need(`--ch-${k}-ink`, `--ch-${k}-bg`, `chip ${k}`);
  }
});
