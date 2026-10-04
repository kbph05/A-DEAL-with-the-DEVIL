/** Headless automated play: runs a policy against the engine. Works in Node tests and in the browser console. */
import type { Devil } from "./devil";
import type { Ending, GameEvent, Result } from "./events";
import { MAX_ASKS, type Command } from "./gameState";
import { createGame, type Game, type Observation } from "./run";
import { STAT_RANGE } from "./state";

export type { Command } from "./gameState";
/** A policy is a pure function of what it can see. Return null to give up (counts as a stall). */
export type Policy = (obs: Observation) => Command | null;
export type Outcome = Ending | "timeout";
export interface AutoplayResult { seed: string; outcome: Outcome; steps: number; events: GameEvent[] }
export type Tally = Record<Outcome, number> & { total: number };

export async function execute(g: Game, c: Command): Promise<Result> {
  switch (c.cmd) {
    case "look": return g.look();
    case "go": return g.go(c.n);
    case "fight": return g.fight(c.realtime === true);
    case "fight_result": return g.fightResult(c);
    case "rest": return g.rest();
    case "train": return g.train();
    case "buy": return g.buy(c.item);
    case "deal": return g.deal(c.text);
    case "accept": return g.accept();
    case "refuse": return g.refuse();
    case "devil_reply": return g.devilReply(c.deal);
  }
}

/**
 * Default bot: fights; at a fire trains when HP is at least 70% of max (and attack is below its cap), else rests, but takes
 * the devil's deal instead when neither would do anything (attack at its cap and HP at least 90%); spends gold on healing
 * (when hurt) or blades, at a well hears out the devil if he is sitting there and will listen, else drinks the blessing (one or the other); takes his free opening offer wherever he sits and haggles once past it (questions allowing); alternates refusing and
 * accepting deals (refuse first) wherever they are; and otherwise takes the first exit. It never sends text, so the
 * StubDevil stays deterministic, and it only asks while the engine would listen (`asksLeft`, `questionsLeft`).
 */
export const botPolicy: Policy = (o) => {
  if (o.enemy) return { cmd: "fight" };
  const { hp, maxHp, gold } = o.state;
  const canAsk = o.opening || (o.asksLeft > 0 && o.questionsLeft > 0);
  // An offer on the table (deal node, campfire or well): haggle once past his opener (if a question is left), then decide.
  if (o.offer) {
    if (o.asksLeft === MAX_ASKS && o.questionsLeft > 0) return { cmd: "deal" };
    return { cmd: o.dealsDecided % 2 === 0 ? "refuse" : "accept" };
  }
  switch (o.kind) {
    case "campfire":
      if (o.resolved) break;
      if (o.asksLeft < MAX_ASKS) { if (canAsk) return { cmd: "deal" }; break; } // asked here already: the fire is the devil's
      if (canAsk && o.state.attack >= STAT_RANGE.attack[1] && hp >= 0.9 * maxHp) return { cmd: "deal" };
      return { cmd: hp >= 0.7 * maxHp && o.state.attack < STAT_RANGE.attack[1] ? "train" : "rest" };
    case "village":
      if (hp <= maxHp - 12 && gold >= 10) return { cmd: "buy", item: "heal" };
      if (gold >= 15) return { cmd: "buy", item: "blade" };
      break;
    case "well":
      // One choice per well: the devil if he sits there and will listen, else the blessing (never both: ONE_CHOICE).
      if (canAsk) return { cmd: "deal" };
      if (!o.resolved && (!o.devilPresent || o.asksLeft === MAX_ASKS) && gold >= 8) return { cmd: "buy", item: "blessing" };
      break;
    case "deal":
      if (canAsk) return { cmd: "deal" };
      break;
  }
  return o.exits.length ? { cmd: "go", n: 1 } : null;
};

/** Play one seeded run to its end (or `maxSteps` commands). Each command is one step. */
export async function autoplay(seed?: string | number, policy: Policy = botPolicy, maxSteps = 1000, devil?: Devil): Promise<AutoplayResult> {
  const g = createGame(seed, devil);
  const events: GameEvent[] = [{ type: "started", seed: g.seed }];
  let steps = 0;
  while (!g.ending && steps < maxSteps) {
    const c = policy(g.observe());
    if (!c) break;
    steps++;
    events.push(...(await execute(g, c)).events);
  }
  return { seed: g.seed, outcome: g.ending ?? "timeout", steps, events };
}

/** Run `n` seeded games (`${prefix}-0` ...) and count the outcomes. */
export async function simulate(n = 100, policy: Policy = botPolicy, maxSteps = 1000, prefix = "sim"): Promise<Tally> {
  const t: Tally = { win: 0, lose: 0, hell: 0, timeout: 0, total: 0 };
  for (let i = 0; i < n; i++) {
    t[(await autoplay(`${prefix}-${i}`, policy, maxSteps)).outcome]++;
    t.total++;
  }
  return t;
}
