/** Outcome (the narration of the last move only) and History (everything, collapsed). */
import { describe, type GameEvent } from "../game";
import { h } from "./dom";
import { eventClass } from "./logic";

const line = (e: GameEvent) => h("p", { class: `entry ${eventClass(e)}`, text: describe(e) });

export function renderOutcome(el: HTMLElement, events: GameEvent[]): void {
  el.replaceChildren(...(events.length ? events.map(line) : [h("p", { class: "muted", text: "Nothing has happened yet." })]));
}

/** The <details> element is created once so it stays open across renders; `update` only swaps its contents. */
export function createHistory(): { el: HTMLElement; update(log: GameEvent[]): void } {
  const summary = h("summary", { text: "History" }), list = h("div", { class: "log" });
  return {
    el: h("details", { class: "history" }, summary, list),
    update(log) {
      summary.textContent = `History (${log.length} event${log.length === 1 ? "" : "s"}, newest first)`;
      list.replaceChildren(...log.map(line));
    },
  };
}
