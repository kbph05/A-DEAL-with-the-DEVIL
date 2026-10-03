/** Pure helpers for the test UI: which buttons make sense, and how to style events. No DOM here, so tests can import it. */
import type { Deal, GameEvent, Observation } from "../game";
import { WARES } from "../game/run";

export type Ware = keyof typeof WARES;
export interface Actions {
  /** Everything is disabled: a run that is over, or the devil is mid-sentence. */
  locked: boolean;
  exits: Observation["exits"];
  fight: boolean;
  rest: boolean;
  buy: Array<{ item: Ware; cost: number; affordable: boolean }>;
  /** Show the "ask the devil" row (wish input + button); `again` means an offer is already on the table (haggle). */
  ask: { again: boolean } | null;
  offer: Deal | null;
}

/**
 * Buttons derived from observe() only. Anything the observation can't tell us (e.g. how many haggles are left)
 * stays enabled and the engine's `rejected` reason is shown instead.
 */
export function availableActions(o: Observation, busy = false): Actions {
  const wares: Ware[] = o.kind === "village" ? ["heal", "blade"] : o.kind === "well" && !o.resolved ? ["blessing"] : [];
  return {
    locked: busy || o.pending || o.ending !== null,
    exits: o.exits,
    fight: o.enemy !== null,
    rest: o.kind === "campfire" && !o.resolved,
    buy: wares.map((item) => ({ item, cost: WARES[item].cost, affordable: o.state.gold >= WARES[item].cost })),
    ask: o.kind === "deal" && !o.resolved && !o.enemy ? { again: o.offer !== null } : null,
    offer: o.offer,
  };
}

/** CSS class for a log line, so the devil's meddling stands out. */
export function eventClass(e: GameEvent): string {
  switch (e.type) {
    case "node_rewritten": case "rewrite_failed": return "ev-rewrite";
    case "curse_added": case "curse_fired": return "ev-curse";
    case "deal_offered": case "deal_applied": case "deal_refused": return "ev-devil";
    case "damaged": case "lost": case "hell": return "ev-bad";
    case "healed": case "enemy_slain": case "won": case "revived": return "ev-good";
    case "rejected": return "ev-reject";
    case "started": case "act_advanced": return "ev-head";
    default: return "ev";
  }
}
