/** "Your choices": "Actions here" (fight, rest, buy, the devil's offer) beside "Where to next" (the act's map as a DAG; clicking a node is `go`). */
import type { Command, View } from "../game";
import { fmtDeltas } from "../game/events";
import { chip, h } from "./dom";
import { mountDag } from "./dag";
import { buyLabel, curseText, dagModel, effectChips, fightLabel, lockReason, type Actions } from "./logic";

export interface Choices { render(v: View, A: Actions, busy: boolean): void }

/** `send` runs a command; the wish input is read at click time, so it stays current. */
export function mountChoices(el: HTMLElement, send: (c: Command) => void): Choices {
  const wish = h("input", { id: "wish", class: "wish" });
  wish.placeholder = "e.g. a sharper sword, and I'm not afraid of a curse";
  wish.autocomplete = "off";
  const wishLabel = h("label", { text: "Tell the devil what you want (optional)" });
  wishLabel.htmlFor = "wish";

  const btn = (label: string, c: Command | (() => Command), off: boolean, cls = "choice") => {
    const b = h("button", { text: label, class: cls });
    b.type = "button";
    b.disabled = off;
    b.onclick = () => send(typeof c === "function" ? c() : c);
    return b;
  };

  const dag = mountDag(send);

  return {
    render(o, A, busy) {
      const why = lockReason(o, busy);
      const list = h("div", { class: "choice-list" });
      if (A.fight && o.enemy) list.append(btn(fightLabel(o.enemy), { cmd: "fight" }, A.locked, "choice primary"));
      if (A.rest) list.append(btn("Rest at the campfire", { cmd: "rest" }, A.locked));
      for (const w of A.buy) {
        const l = buyLabel(w, o.state.gold);
        list.append(btn(l.label, { cmd: "buy", item: w.item }, A.locked || !w.affordable));
      }

      const acts: Node[] = [h("h3", { text: "Actions here" })];
      if (A.offer) {
        const d = A.offer;
        const gives = h("div", { class: "chips" }, h("span", { class: "muted", text: "The devil gives:" }));
        const eff = effectChips(d.effects);
        if (eff.length) for (const c of eff) gives.append(chip(c.text, c.tone)); else gives.append(chip(fmtDeltas(d.effects), "none"));
        const card = h("div", { class: "offer-card" },
          h("h3", { text: "The devil's offer" }),
          h("blockquote", { text: `“${d.dialogue}”` }), gives);
        if (d.curse) card.append(h("p", { class: "callout ev-curse", text: `Curse: ${curseText(d.curse)}` }));
        if (d.rewrite) card.append(h("p", { class: "callout ev-rewrite", text: `Rewrites the map: ${d.rewrite.nodeId} becomes ${d.rewrite.to}` }));
        card.append(h("div", { class: "row" }, btn("Accept", { cmd: "accept" }, A.locked, "choice primary accept"), btn("Refuse", { cmd: "refuse" }, A.locked, "choice primary refuse")));
        acts.push(card);
      }
      if (list.childElementCount) acts.push(list);
      if (A.ask) acts.push(h("div", { class: "ask" }, wishLabel, h("div", { class: "row" }, wish,
        btn(A.ask.again ? "Haggle" : "Ask the devil", () => ({ cmd: "deal", text: wish.value }), A.locked || !A.ask.enabled, "choice"))));
      if (acts.length === 1) acts.push(h("p", { class: "muted", text: o.ending ? "Nothing more to do." : "Nothing to do here. Pick where to go next." }));
      const kids: Node[] = [];
      if (why) kids.push(h("p", { class: o.ending ? "muted" : "wait", text: why }));
      kids.push(h("div", { class: "choice-body" },
        h("div", { class: "actions" }, ...acts),
        h("div", { class: "where-next" }, h("h3", { text: "Where to next" }), dag.el)));
      el.replaceChildren(...kids);
      dag.update(dagModel(o, o.map, busy, o.actions)); // after attaching: edge lines are measured from the live layout
    },
  };
}
