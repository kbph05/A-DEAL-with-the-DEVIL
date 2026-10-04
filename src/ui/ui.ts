/** Game UI: plain DOM over the headless engine. Every button calls the same engine functions as the console. */
import "./ui.css";
import { describe, execute, type Command, type GameEvent } from "../game";
import type { Session } from "../game/session";
import { mountChoices } from "./choices";
import { h, region } from "./dom";
import { availableActions, blurbOf, dealEnd, fireChoice, lastStrike, outcomeEvents } from "./logic";
import { createHistory, renderOutcome } from "./outcome";
import { renderSituation } from "./situation";

const END: Record<string, [string, string]> = {
  win: ["You win.", "The devil is gracious about it, which is worse."],
  hell: ["HELL.", "You won, but you sold your soul."],
  lose: ["You died.", "The devil keeps the change."],
};
const HISTORY_MAX = 200;

/**
 * Mounts the Game column and returns the layout grid. In test builds `mountTools` adds a second column ("Run & dev
 * tools") to it; the final build never creates one, so it contains no trace of the tools.
 */
export function mountUI(root: HTMLElement, session: Session): { layout: HTMLElement } {
  let log: GameEvent[] = [];     // full history, newest first
  let outcome: GameEvent[] = []; // events of the most recent action only
  let busy = false;
  let refocus = false;           // a choice button was activated: put focus on the new first choice after redraw

  const banner = h("div", { class: "banner" });
  banner.setAttribute("role", "status");
  const sit = region("situation", "Situation", "card situation");
  const ch = region("choices", "Your choices", "card choices");
  const out = region("outcome", "Outcome", "card outcome");
  const outBox = h("div", { class: "outcome-box", aria: { live: "polite" } });
  out.body.append(outBox);
  const history = createHistory();
  const game = h("main", { class: "game" }, banner, sit.sec, ch.sec, out.sec, history.el);
  const layout = h("div", { class: "layout" }, game);
  root.replaceChildren(h("header", {}, h("h1", { text: "A DEAL with the DEVIL" })), layout);

  const push = (events: GameEvent[]) => {
    const shown = outcomeEvents(events); // the UI draws state itself; `looked` is console chatter
    for (const e of shown) log.unshift(e);
    log = log.slice(0, HISTORY_MAX);
    if (shown.length) outcome = shown;   // an empty batch (console look, re-render ping) keeps the last outcome
  };

  async function run(c: Command) {
    if (busy) return; // double-click guard (the engine also rejects a second deal while one is pending)
    const g = session.game();
    busy = true; refocus = true; render();
    let events: GameEvent[] = [];
    try { events = (await execute(g, c)).events; } finally { busy = false; }
    if (session.game() !== g) return; // a new game replaced the run while the devil was thinking
    session.emit(events); // our own subscriber below records and redraws; the dev tools listen too
  }
  const choices = mountChoices(ch.body, (c) => void run(c));

  function render() {
    const g = session.game(), v = g.view(), o = v, A = availableActions(o, busy, v.actions);
    const looked = g.look().events[0] as Extract<GameEvent, { type: "looked" }>;
    banner.replaceChildren();
    banner.className = o.ending ? `banner show ${o.ending}` : "banner";
    if (o.ending) {
      const again = h("button", { text: "New game", class: "choice primary" });
      again.type = "button";
      again.onclick = () => session.newGame();
      banner.append(h("b", { text: END[o.ending][0] }), " ", END[o.ending][1], " ", again);
    }
    renderSituation(sit.body, o, blurbOf(looked, describe(looked)), looked.curses);
    choices.render(v, A, busy, dealEnd(log), fireChoice(log), lastStrike(log));
    renderOutcome(outBox, outcome);
    history.update(log);
    if (refocus && !A.locked) {
      refocus = false;
      (ch.body.querySelector<HTMLElement>(".actions button:not(:disabled)") ?? ch.body.querySelector<HTMLElement>(".dag button:not(:disabled)"))?.focus();
    }
  }

  session.subscribe((events) => {
    if (events.some((e) => e.type === "started")) { log = []; outcome = []; busy = false; }
    push(events);
    render();
  });
  push([{ type: "started", seed: session.game().seed }]);
  render();
  return { layout };
}
