/**
 * The in-game HUD: a DOM overlay over the game canvas (crisp text, real buttons, restyled with CSS alone).
 * `mountHud(parent)` appends it to `parent` (which must be positioned: the HUD is `position: absolute; inset: 0`);
 * feed it `hudModel(view)` after every engine step. Only the item buttons and curse chips take pointer events, so
 * touches elsewhere reach the canvas (the touch stick). See docs/hud.md.
 */
import "./hud.css";
import { announce, hudShown, type HudItem, type HudModel, type HudVariant } from "./model";

export interface HudOptions {
  /** Called with the item when its slot is pressed (only usable items are enabled). Send `item.command` to the engine. */
  onUseItem?: (item: HudItem) => void;
  /** "full" (default, the labs): every field and the item bar. "play" (the play page): no item bar, ATK, Soul or Revive (`hudShown`). */
  variant?: HudVariant;
}

export interface HudHandle {
  el: HTMLElement;
  update(model: HudModel): void;
  destroy(): void;
}

const SOUL_TEXT = { kept: "kept", sold: "sold", spent: "spent" } as const;
const REVIVE_TEXT = { available: "ready", used: "used", forfeit: "none" } as const;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A labelled stat cell: `<span class="hud-stat"><small>Gold</small><b>10</b></span>`. */
function stat(cls: string, label: string): { el: HTMLElement; value: HTMLElement } {
  const el = h("span", `hud-stat ${cls}`), value = h("b");
  el.append(h("small", "", label), value);
  return { el, value };
}

function itemLabel(i: HudItem): string {
  const price = i.cost !== null ? `, ${i.cost} gold` : "";
  const count = i.count !== null ? `, ${i.count} held` : "";
  const verb = i.kind === "ware" ? "Buy " : "Use ";
  return `${i.usable ? verb : ""}${i.label}${i.hint ? `, ${i.hint}` : ""}${price}${count}${i.usable ? "" : `. Unavailable: ${i.reason ?? "not now"}`}`;
}

export function mountHud(parent: HTMLElement, options: HudOptions = {}): HudHandle {
  const el = h("div", "hud");
  el.dataset.hud = options.variant ?? "full";

  // Top-left stats strip.
  const stats = h("section", "hud-stats");
  stats.setAttribute("aria-label", "Status");
  const where = h("div", "hud-where");
  const bar = h("div", "hud-hp");
  bar.setAttribute("role", "meter");
  bar.setAttribute("aria-label", "HP");
  bar.setAttribute("aria-valuemin", "0");
  const fill = h("div", "hud-hp-fill"), hpText = h("span", "hud-hp-text");
  bar.append(fill, hpText);
  const row = h("div", "hud-row");
  const gold = stat("hud-gold", "Gold"), atk = stat("hud-atk", "ATK"), spd = stat("hud-spd", "SPD"), soul = stat("hud-soul", "Soul"), revive = stat("hud-revive", "Revive");
  row.append(gold.el, atk.el, spd.el, soul.el, revive.el);
  const devil = h("div", "hud-devil");
  const curses = h("ul", "hud-curses");
  curses.setAttribute("aria-label", "Curses");
  const status = h("div", "hud-status");
  stats.append(where, bar, row, devil, curses, status);

  // Polite live region: HP and gold changes only (see `announce`).
  const live = h("div", "hud-sr");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("role", "status");

  // Item bar (bottom-right in landscape, right-edge column in portrait: clear of the touch stick).
  const items = h("section", "hud-items");
  items.setAttribute("aria-label", "Items");

  el.append(stats, live, items);
  parent.append(el);

  let prev: HudModel | null = null;
  let itemKey = "";
  let current: HudItem[] = [];

  items.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-i]");
    if (!btn || btn.disabled) return;
    const item = current[Number(btn.dataset.i)];
    btn.blur(); // so Space/Enter (attack in the fight) does not press it again
    if (item?.usable) options.onUseItem?.(item);
  });

  function renderItems(list: HudItem[]): void {
    const key = JSON.stringify(list);
    if (key === itemKey) return;
    itemKey = key;
    current = list;
    items.replaceChildren(...list.map((i, n) => {
      const b = h("button", `hud-slot${i.usable ? "" : " off"}`);
      b.type = "button";
      b.dataset.i = String(n);
      b.dataset.item = i.id;
      b.disabled = !i.usable || !options.onUseItem;
      b.setAttribute("aria-label", itemLabel(i));
      b.title = itemLabel(i);
      const tag = i.count !== null ? `x${i.count}` : i.cost !== null ? `${i.cost}g` : "";
      b.append(h("span", "hud-slot-name", i.label), h("span", "hud-slot-tag", tag), h("span", "hud-slot-hint", i.usable ? i.hint : (i.reason ?? "not now")));
      return b;
    }));
    items.hidden = list.length === 0;
  }

  function update(m: HudModel): void {
    where.textContent = [`Act ${m.act}`, m.layer !== null ? `Layer ${m.layer}/${m.layers ?? "?"}` : m.kind === "final" ? "Final door" : "", m.kind && m.kind !== "final" ? m.kind : ""]
      .filter(Boolean).join(" · ");
    const pct = Math.round((m.hp / m.maxHp) * 100);
    fill.style.width = `${pct}%`;
    bar.classList.toggle("low", pct <= 30);
    hpText.textContent = `HP ${m.hp}/${m.maxHp}`;
    bar.setAttribute("aria-valuenow", String(m.hp));
    bar.setAttribute("aria-valuemax", String(m.maxHp));
    bar.setAttribute("aria-valuetext", `${m.hp} of ${m.maxHp}`);
    gold.value.textContent = String(m.gold);
    const show = hudShown(m, options.variant);
    atk.el.hidden = !show.attack;
    soul.el.hidden = !show.soul;
    revive.el.hidden = !show.revive;
    atk.value.textContent = String(m.attack);
    spd.el.hidden = !show.speed;
    spd.value.textContent = m.speed === null ? "" : String(m.speed);
    soul.value.textContent = SOUL_TEXT[m.soul];
    soul.el.classList.toggle("lost", m.soul !== "kept");
    revive.value.textContent = REVIVE_TEXT[m.revive];
    revive.el.classList.toggle("lost", m.revive !== "available");
    devil.hidden = !show.devil;
    devil.textContent = m.devil.asksLeft === null ? "" : `Devil: ${m.devil.asksLeft} ${m.devil.asksLeft === 1 ? "ask" : "asks"} here · ${m.devil.questionsLeft}/${m.devil.max} questions this run`;
    curses.replaceChildren(...m.curses.map((c) => {
      const li = h("li", "hud-curse");
      li.title = c.tooltip;
      li.append(h("span", "", c.label), h("span", "hud-sr", ` (${c.tooltip})`));
      return li;
    }));
    curses.hidden = !show.curses;
    const st = m.ending === "win" ? "You won" : m.ending === "hell" ? "The devil collects" : m.ending === "lose" ? "You died" : m.busy === "devil" ? "The devil is speaking…" : m.busy === "fight" ? "Fighting…" : "";
    status.textContent = st;
    status.hidden = !st;
    renderItems(show.items ? m.items : []);
    const say = announce(prev, m);
    if (say) live.textContent = say;
    prev = m;
  }

  return { el, update, destroy: () => el.remove() };
}
