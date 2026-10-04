/** Situation card: where you are, what it looks like, your stats, curses and the enemy. */
import type { Observation } from "../game";
import type { Curse } from "../game";
import { bar, chip, h } from "./dom";
import { curseText, nodeTitle, pct } from "./logic";

export function renderSituation(el: HTMLElement, o: Observation, blurb: string, curses: Curse[], fighting = false): void {
  const s = o.state;
  const stat = (k: string, v: string | number, cls = "") => h("div", { class: `stat ${cls}` }, h("small", { text: k }), h("b", { text: String(v) }));
  const curseRow = h("div", { class: "chips", aria: { label: "Active curses" } });
  if (curses.length) for (const c of curses) curseRow.append(chip(`Curse · ${curseText(c)}`, "curse"));
  else curseRow.append(h("span", { class: "muted", text: "No curses." }));
  el.replaceChildren(
    h("p", { class: "where", text: nodeTitle(o.act, o.kind) }),
    h("p", { class: "blurb", text: blurb }),
    h("div", { class: "statbar" },
      bar(s.hp, s.maxHp, pct(s.hp, s.maxHp), "HP", "hp"), stat("Gold", s.gold), stat("Attack", s.attack), stat("Soul", s.soul ? "yours" : "gone", s.soul ? "" : "lost")),
    curseRow,
  );
  if (o.enemy) {
    const e = o.enemy;
    // The engine's HP is only updated when the realtime fight reports; the arena has the live bar, so don't show a stale one.
    el.append(h("div", { class: "enemy-card" }, h("div", { class: "enemy-name" }, h("b", { text: e.name }), e.boss ? chip("Boss", "bad") : ""),
      fighting ? h("p", { class: "muted", text: "Fighting now. Its health is in the arena." }) : bar(e.hp, e.maxHp, pct(e.hp, e.maxHp), "Enemy HP", "foe")));
  }
}
