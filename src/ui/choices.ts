/**
 * "Your choices": up to one action panel per kind of choice, beside "Where to next" (the act's map as a DAG; clicking a node is `go`).
 * The panels are deliberately unlike each other: the Devil's table (purple), the Shop (gold; buy as many as you like), "Choose one"
 * (neutral radio cards; single-use) and Fight (red). Which ones show comes from `panelKinds` in logic.ts.
 */
import type { Command, View } from "../game";
import { fmtDeltas } from "../game/events";
import { chip, h } from "./dom";
import { mountDag } from "./dag";
import {
  chooseCards, curseText, dagModel, DEVIL_END_TEXT, devilPhase, effectChips, fightLabel, haggleText, lockReason, PANEL_TITLE, panelKinds, shopItems,
  type Actions, type ChooseCard, type DealEnd, type PanelKind, type ShopItem,
} from "./logic";

export interface Choices { render(v: View, A: Actions, busy: boolean, end: DealEnd): void }

/** `send` runs a command; the wish input is read at click time, so it stays current. */
export function mountChoices(el: HTMLElement, send: (c: Command) => void): Choices {
  const wish = h("input", { id: "wish", class: "wish" });
  wish.placeholder = "e.g. a sharper sword, and I'm not afraid of a curse";
  wish.autocomplete = "off";
  const wishLabel = h("label", { text: "Tell the devil what you want (optional)" });
  wishLabel.htmlFor = "wish";

  const btn = (label: string, c: Command | (() => Command), off: boolean, cls = "choice", name?: string) => {
    const b = h("button", { text: label, class: cls, aria: name ? { label: name } : {} });
    b.type = "button";
    b.disabled = off;
    b.onclick = () => send(typeof c === "function" ? c() : c);
    return b;
  };

  /** One panel: a labelled region with its own heading (icon is decoration; the title carries the meaning). */
  const panel = (kind: PanelKind, ...kids: Node[]): HTMLElement => {
    const { icon, title } = PANEL_TITLE[kind], id = `panel-${kind}-h`;
    return h("section", { class: `panel panel-${kind}`, aria: { labelledby: id } },
      h("h3", { id, class: "panel-h" }, h("span", { class: "panel-ico", text: icon, aria: { hidden: "true" } }), title), ...kids);
  };

  function devilPanel(o: View, A: Actions, end: DealEnd): HTMLElement {
    const phase = devilPhase(o, end), kids: Node[] = [];
    if (phase === "struck" || phase === "walked" || phase === "settled") {
      const t = DEVIL_END_TEXT[phase];
      kids.push(h("div", { class: `deal-end ${phase}`, aria: { live: "polite" } },
        h("b", { text: `${phase === "struck" ? "🤝" : phase === "walked" ? "🚶" : "🕯️"} ${t.head}` }), h("p", { text: t.body })));
      return panel("devil", ...kids);
    }
    if (A.offer) {
      const d = A.offer;
      const gives = h("div", { class: "chips" }, h("span", { class: "muted", text: "The devil gives:" }));
      const eff = effectChips(d.effects);
      if (eff.length) for (const c of eff) gives.append(chip(c.text, c.tone)); else gives.append(chip(fmtDeltas(d.effects), "none"));
      const card = h("div", { class: "offer-card" }, h("h4", { text: "The devil's offer" }), h("blockquote", { text: `“${d.dialogue}”` }), gives);
      if (d.curse) card.append(h("p", { class: "callout ev-curse", text: `Curse: ${curseText(d.curse)}` }));
      if (d.rewrite) card.append(h("p", { class: "callout ev-rewrite", text: `Rewrites the map: ${d.rewrite.nodeId} becomes ${d.rewrite.to}` }));
      card.append(h("div", { class: "row" }, btn("Accept", { cmd: "accept" }, A.locked, "choice primary accept"), btn("Refuse", { cmd: "refuse" }, A.locked, "choice primary refuse")));
      kids.push(card);
    }
    if (A.ask) kids.push(h("div", { class: "ask" }, wishLabel, h("div", { class: "row" }, wish,
      btn(A.ask.again ? "Haggle" : "Ask the devil", () => ({ cmd: "deal", text: wish.value }), A.locked || !A.ask.enabled, "choice devil-ask")),
      h("p", { class: "haggles", text: haggleText(o.asksLeft, A.offer !== null) })));
    return panel("devil", ...kids);
  }

  function shopPanel(o: View, A: Actions): HTMLElement {
    const card = (it: ShopItem) => h("li", { class: `price-card${it.affordable ? "" : " short"}` },
      h("span", { class: "price-ico", text: it.icon, aria: { hidden: "true" } }),
      h("b", { class: "price-name", text: it.name }),
      h("span", { class: "price-effect", text: it.effect }),
      h("span", { class: "price-tag", text: `${it.cost}g` }),
      btn("Buy", { cmd: "buy", item: it.item }, A.locked || !it.affordable, "choice buy", `Buy ${it.name} for ${it.cost} gold`),
      h("span", { class: "price-note", text: it.reason ?? "" }));
    return panel("shop",
      h("p", { class: "muted", text: `You have ${o.state.gold} gold. The stall never runs out: buy the same thing again and again, as long as you can pay.` }),
      h("ul", { class: "shop-grid" }, ...shopItems(o, A).map(card)));
  }

  function choosePanel(o: View, A: Actions): HTMLElement {
    const cards = chooseCards(o, A);
    const done = cards.some((c) => c.state === "chosen");
    const card = (c: ChooseCard) => {
      const b = h("button", { class: `choose-card ${c.state}` },
        h("span", { class: "radio", aria: { hidden: "true" }, text: c.state === "chosen" ? "●" : "○" }),
        h("span", { class: "choose-ico", text: c.icon, aria: { hidden: "true" } }),
        h("span", { class: "choose-text" }, h("b", { text: c.title }), h("span", { text: c.effect }),
          h("span", { class: "choose-note", text: c.state === "chosen" ? "✓ Chosen" : c.note ?? "" })));
      b.type = "button";
      b.disabled = A.locked || c.state !== "available";
      b.setAttribute("aria-pressed", String(c.state === "chosen"));
      b.onclick = () => send(c.cmd);
      return b;
    };
    return panel("choose",
      h("p", { class: "muted", text: done ? "You made your choice here. The rest is closed." : "Only one. Once you take it, it is gone. Or skip it and move on." }),
      h("div", { class: "choose-list" }, ...cards.map(card)));
  }

  function fightPanel(o: View, A: Actions): HTMLElement {
    return panel("fight", h("p", { class: "muted", text: "Something blocks the way. Beat it to move on." }),
      o.enemy ? btn(fightLabel(o.enemy), { cmd: "fight" }, A.locked || !A.fight, "choice primary") : h("span"));
  }

  const dag = mountDag(send);

  return {
    render(o, A, busy, end) {
      const why = lockReason(o, busy);
      const panels = panelKinds(o).map((k) => k === "devil" ? devilPanel(o, A, end) : k === "shop" ? shopPanel(o, A) : k === "choose" ? choosePanel(o, A) : fightPanel(o, A));
      if (!panels.length) panels.push(h("p", { class: "muted", text: o.ending ? "Nothing more to do." : "Nothing to do here. Pick where to go next." }));
      const kids: Node[] = [];
      if (why) kids.push(h("p", { class: o.ending ? "muted" : "wait", text: why }));
      kids.push(h("div", { class: "choice-body" },
        h("div", { class: "actions" }, ...panels),
        h("div", { class: "where-next" }, h("h3", { text: "Where to next" }), dag.el)));
      el.replaceChildren(...kids);
      dag.update(dagModel(o, o.map, busy, o.actions)); // after attaching: edge lines are measured from the live layout
    },
  };
}
