/** Headless automated play: runs a policy against the engine. Works in Node tests and in the browser console. */
import type { Devil } from "./devil";
import type { Ending, GameEvent, Result } from "./events";
import type { Command } from "./gameState";
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
    case "fight": return g.fight();
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
 * Default bot: fights; at a fire trains when HP is at least 70% of max (and attack is below its cap), else rests; spends gold on healing (when hurt) or blades, drinks from wells,
 * alternates refusing and accepting deals (refuse first), and otherwise takes the first exit.
 */
export const botPolicy: Policy = (o) => {
  if (o.enemy) return { cmd: "fight" };
  const { hp, maxHp, gold } = o.state;
  switch (o.kind) {
    case "campfire":
      if (!o.resolved) return { cmd: hp >= 0.7 * maxHp && o.state.attack < STAT_RANGE.attack[1] ? "train" : "rest" };
      break;
    case "village":
      if (hp <= maxHp - 12 && gold >= 10) return { cmd: "buy", item: "heal" };
      if (gold >= 15) return { cmd: "buy", item: "blade" };
      break;
    case "well": if (!o.resolved && gold >= 8) return { cmd: "buy", item: "blessing" }; break;
    case "deal":
      if (!o.resolved) {
        if (!o.offer) return { cmd: "deal" };
        return { cmd: o.dealsDecided % 2 === 0 ? "refuse" : "accept" };
      }
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
