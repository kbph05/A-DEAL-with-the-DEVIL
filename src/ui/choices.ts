/** "Your choices": only the currently sensible actions, as big buttons, plus the devil's offer card. */
import type { Command, MapView, Observation } from "../game";
import { fmtDeltas } from "../game/events";
import { chip, h } from "./dom";
import { buyLabel, curseText, effectChips, exitLabel, exitLabels, fightLabel, lockReason, type Actions } from "./logic";

export interface Choices { render(o: Observation, A: Actions, busy: boolean, map?: MapView): void }

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

  return {
    render(o, A, busy, map) {
      const why = lockReason(o, busy);
      const list = h("div", { class: "choice-list" });
      if (A.fight && o.enemy) list.append(btn(fightLabel(o.enemy), { cmd: "fight" }, A.locked, "choice primary"));
      if (A.rest) list.append(btn("Rest at the campfire", { cmd: "rest" }, A.locked));
      for (const w of A.buy) {
        const l = buyLabel(w, o.state.gold);
        list.append(btn(l.label, { cmd: "buy", item: w.item }, A.locked || !w.affordable));
      }
      const labels = map ? exitLabels(o, map) : A.exits.map(exitLabel);
      A.exits.forEach((x, i) => list.append(btn(labels[i], { cmd: "go", n: x.n }, A.locked)));

      const kids: Node[] = [];
      if (why) kids.push(h("p", { class: o.ending ? "muted" : "wait", text: why }));
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
        kids.push(card);
      }
      if (list.childElementCount) kids.push(list);
      if (A.ask) kids.push(h("div", { class: "ask" }, wishLabel, h("div", { class: "row" }, wish,
        btn(A.ask.again ? "Haggle" : "Ask the devil", () => ({ cmd: "deal", text: wish.value }), A.locked, "choice"))));
      if (!list.childElementCount && !A.offer && !A.ask && !o.ending) kids.push(h("p", { class: "muted", text: "No moves available." }));
      el.replaceChildren(...kids);
    },
  };
}
