/**
 * Thin devtools layer: exposes the engine's commands on `window` and logs the returned events as plain text.
 * No game logic here. The real point of the console is poking the engine and running `autoplay` / `simulate`.
 */
import { autoplay, simulate, type Policy } from "./autoplay";
import { describe, type Result } from "./events";
import type { Game } from "./run";
import { createSession, type Session } from "./session";

type Log = (...args: unknown[]) => void;

const HELP = [
  "look()            describe where you are and the numbered exits",
  "go(n)             take exit n",
  "fight()           one round against the enemy here",
  "rest()            campfire: heal",
  "buy(item)         village: 'heal' | 'blade'; well: 'blessing'",
  "deal(text?)       ask the devil for an offer (say something to steer him)",
  "accept() refuse() take or decline his offer",
  "map()             current act as plain data (also logged)",
  "newgame(seed?)    restart; ?seed=abc in the URL fixes the first run",
  "autoplay(seed?, policy?, maxSteps?)   let a bot play a whole run: await it for {outcome, steps, events}",
  "simulate(n?, policy?)                 n bot runs, returns outcome counts: await it",
  "(a policy is a function (observation) => {cmd: 'go', n: 1} | {cmd: 'fight'} | ... | null)",
].join("\n");

/** Pass a shared `session` to drive the same run as the UI; every command's events are also emitted on it. */
export function installConsole(target: object = window, session: Session | string = createSession(), log: Log = (...a) => console.log(...a)): { game: () => Game } {
  if (typeof session === "string") session = createSession(session);
  const s = session;
  const game = () => s.game();
  const show = (r: Result) => { for (const e of r.events) log(describe(e)); s.emit(r.events); };
  const w = target as Record<string, unknown>;
  const start = () => { log(`A DEAL with the DEVIL (seed "${game().seed}")\nThe road ends at a table. Someone is already sitting there.`); log(HELP); show(game().look()); };

  Object.assign(w, {
    help: () => log(HELP),
    look: () => show(game().look()),
    go: (n: number | string) => { const r = game().go(n); show(r); if (r.ok && !game().ending) show(game().look()); },
    fight: () => { const r = game().fight(); show(r); if (r.ok && !game().ending && !game().observe().enemy) show(game().look()); },
    rest: () => show(game().rest()),
    buy: (item?: string) => show(game().buy(item)),
    deal: (text?: string) => { s.emit([]); void game().deal(text).then(show); },
    accept: () => show(game().accept()),
    refuse: () => show(game().refuse()),
    map: () => { const m = game().map(); log(m); return m; },
    newgame: (seed?: string | number) => { s.newGame(seed); start(); },
    autoplay: async (seed?: string | number, policy?: Policy, maxSteps?: number) => {
      const r = await autoplay(seed, policy, maxSteps);
      log(`autoplay "${r.seed}": ${r.outcome} in ${r.steps} steps`);
      return r;
    },
    simulate: async (n?: number, policy?: Policy, maxSteps?: number) => {
      const t = await simulate(n, policy, maxSteps);
      log("simulate:", t);
      return t;
    },
  });
  start();
  return { game };
}
