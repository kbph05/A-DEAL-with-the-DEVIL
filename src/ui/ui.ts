/** Game UI: plain DOM over the headless engine. Every button calls the same engine functions as the console. */
import "./ui.css";
import { describe, execute, type Command, type GameEvent } from "../game";
import type { FightSim } from "../fight";
import type { Session } from "../game/session";
import { mountChoices } from "./choices";
import { h, region } from "./dom";
import { availableActions, blurbOf, dealEnd, fireChoice, lastStrike, outcomeEvents } from "./logic";
import { createHistory, renderOutcome } from "./outcome";
import { renderSituation } from "./situation";
import { fightModeFor } from "../fight/mode";

const END: Record<string, [string, string]> = {
  win: ["You win.", "The devil is gracious about it, which is worse."],
  hell: ["HELL.", "You won, but you sold your soul."],
  lose: ["You died.", "The devil keeps the change."],
};
const HISTORY_MAX = 200;

export interface UIOptions {
  /** Offer "Auto-resolve (quick)" (the old one-round fights) beside the realtime fight. Test builds only. */
  quickFight?: boolean;
  /** Test hook: the live fight simulation of each realtime fight (null once it ends). */
  onFightDebug?: (sim: FightSim | null) => void;
}

/**
 * Mounts the Game column and returns the layout grid. In test builds `mountTools` adds a second column ("Run & dev
 * tools") to it; the final build never creates one, so it contains no trace of the tools.
 */
export function mountUI(root: HTMLElement, session: Session, opts: UIOptions = {}): { layout: HTMLElement } {
  let log: GameEvent[] = [];     // full history, newest first
  let outcome: GameEvent[] = []; // events of the most recent action only
  let busy = false;
  let refocus = false;           // a choice button was activated: put focus on the new first choice after redraw
  let fighting = false;          // a realtime fight is on screen: the stage replaces the choices, everything else waits
  let fightBroken = false;       // the realtime fight failed to load: offer the quick fight from then on

  const banner = h("div", { class: "banner" });
  banner.setAttribute("role", "status");
  const sit = region("situation", "Situation", "card situation");
  const ch = region("choices", "Your choices", "card choices");
  // The realtime fight's stage: a sibling of the choices body (which every render replaces), shown instead of it.
  const stage = h("div", { class: "fight-stage", aria: { label: "Realtime fight" } });
  stage.hidden = true;
  ch.sec.append(stage);
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

  /**
   * The realtime fight (docs/fight.md): step `fight` realtime (or resume a pending one), play `runFight` on the stage
   * (Phaser is loaded on first use), then step `fight_result` with what it reported. The Outcome shows both steps' events.
   */
  async function realtimeFight() {
    if (busy) return;
    const g = session.game();
    let req = g.gameState.pendingFight ?? null, pre: GameEvent[] = [];
    if (!req) {
      const r = g.step({ cmd: "fight", realtime: true });
      if (!r.ok || !r.awaiting?.fight) { session.emit(r.events); return; }
      req = r.awaiting.fight; pre = r.events;
    }
    busy = true; fighting = true; refocus = true;
    (document.activeElement as HTMLElement | null)?.blur(); // Space must not press a button behind the fight
    render();
    stage.scrollIntoView({ block: "nearest" });
    let report: unknown = null, failure: string | null = null;
    try {
      const { runFight, runForestFight } = await import("../fight");
      const debug = opts.onFightDebug ? { onDebug: opts.onFightDebug } : {};
      // Bosses fight on the forest path (Big Chungus, 4 Oct); regular fights keep the arena here.
      report = fightModeFor(req) === "forest" ? await runForestFight(stage, req, debug) : await runFight(stage, req, debug);
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
      fightBroken = true;
    } finally {
      opts.onFightDebug?.(null);
      stage.replaceChildren();
      busy = false; fighting = false;
    }
    if (session.game() !== g) { render(); return; } // a new game replaced the run mid-fight
    const r = g.fightResult(report ?? {}); // nothing reported (it failed): an unfinished fight, nothing changes
    const note: GameEvent[] = failure ? [{ type: "rejected", reason: `the realtime fight could not start (${failure}); try again or use Auto-resolve` }] : [];
    session.emit([...pre, ...note, ...r.events]);
  }

  /** The old turn-based fight, round after round until the enemy falls, you are revived, or the run ends. */
  function quickFight() {
    if (busy) return;
    const g = session.game(), events: GameEvent[] = [];
    for (let i = 0; i < 100; i++) {
      const r = g.fight();
      events.push(...r.events);
      if (!r.ok || g.ending || !g.observe().enemy || r.events.some((e) => e.type === "revived")) break;
    }
    refocus = true;
    session.emit(events);
  }

  const choices = mountChoices(ch.body, (c) => void run(c), {
    realtime: () => void realtimeFight(), quick: quickFight, showQuick: () => opts.quickFight === true || fightBroken,
  });

  function render() {
    const g = session.game(), v = g.view(), o = v, A = availableActions(o, busy, v.actions);
    // The devil opens with an offer of his own where he simply appears (his table, a well); at a fire he waits for Deal.
    if (v.opening && !busy && (v.kind === "deal" || v.kind === "well")) queueMicrotask(() => void run({ cmd: "deal" }));
    const looked = g.look().events[0] as Extract<GameEvent, { type: "looked" }>;
    banner.replaceChildren();
    banner.className = o.ending ? `banner show ${o.ending}` : "banner";
    if (o.ending) {
      const again = h("button", { text: "New game", class: "choice primary" });
      again.type = "button";
      again.onclick = () => session.newGame();
      banner.append(h("b", { text: END[o.ending][0] }), " ", END[o.ending][1], " ", again);
    }
    renderSituation(sit.body, o, blurbOf(looked, describe(looked)), looked.curses, fighting);
    ch.body.hidden = fighting; stage.hidden = !fighting;
    for (const el of layout.children) if (el !== game) (el as HTMLElement).inert = fighting; // the dev tools wait too
    if (!fighting) choices.render(v, A, busy, dealEnd(log), fireChoice(log), lastStrike(log));
    renderOutcome(outBox, outcome);
    history.update(log);
    if (refocus && !A.locked && !fighting) {
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
