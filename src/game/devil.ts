import { hashSeed, mulberry32, type Kind, type Rng } from "../map";
import type { PlayerState } from "./state";

export type CurseTrigger = "on_hit" | "on_enter" | "on_fight" | "next_node";
export interface Curse { trigger: CurseTrigger; effect: Record<string, number> }

/** The team's deal JSON shape (requirements.md "Deal format"), plus the optional node rewrite. */
export interface Deal {
  dialogue: string;
  effects: Record<string, number>;
  curse?: { trigger: "on_hit" | "on_enter" | "on_fight" | "next_node"; effect: Record<string, number> };
  rewrite?: { nodeId: string; to: Kind };
}

/** Everything the devil may look at besides the player. Plain JSON, so it can go to a backend as-is. */
export interface DevilContext {
  seed: string;
  act: number;
  nodeId: string;
  /** How many times the devil has been asked this run (including this one). */
  askIndex: number;
  /** Upcoming nodes in this act the devil is allowed to rewrite (ahead of you, unvisited, not the boss). */
  rewritable: Array<{ id: string; kind: Kind }>;
  /** Curses already on the player. */
  curses: Curse[];
}

export interface Devil {
  /** May reject, throw, or return junk: the game validates and survives all of it. */
  offer(state: Readonly<PlayerState>, context: DevilContext, playerText?: string): Promise<Deal>;
}

// ===========================================================================================
// GEMINI PLUG-IN POINT (kbph): implement `Devil` with a client that POSTs {state, context,
// playerText} to the backend proxy and returns the parsed JSON, then call
// `setDevil(new GeminiDevil(...))` once at boot (src/main.ts). Everything it returns is run through
// sanitizeDeal() in deal.ts, so a malformed or hostile reply cannot crash a run.
// ===========================================================================================
let custom: Devil | null = null;
/** Install a devil for all future games (null restores the StubDevil). */
export function setDevil(devil: Devil | null): void { custom = devil; }
/** The devil a new game gets: the installed one, else a seeded StubDevil. */
export const devilFor = (seed: string): Devil => custom ?? new StubDevil(seed);

interface Offer {
  id: string;
  /** Words from the player that make the devil lean this way. */
  hint?: RegExp;
  /** 0 = not on the table right now. */
  eligible(s: Readonly<PlayerState>, ctx: DevilContext): boolean;
  make(s: Readonly<PlayerState>, ctx: DevilContext, rng: Rng): Deal;
}

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
const GOOD: Kind[] = ["campfire", "village", "well", "deal"];

const OFFERS: Offer[] = [
  {
    id: "coin", hint: /gold|coin|rich|money/i, eligible: () => true,
    make: () => ({
      dialogue: "A coin for your trouble. It's warm. It remembers where it was minted, and it will want to go home through your ribs.",
      effects: { gold: 25 }, curse: { trigger: "on_hit", effect: { hp: -4 } },
    }),
  },
  {
    id: "sharpen", hint: /attack|sword|strong|damage|blade/i, eligible: () => true,
    make: () => ({
      dialogue: "Sharper teeth, thinner skin. Surely a fair swap. Nobody has ever complained, at least not for long.",
      effects: { attack: 2, max_hp: -6 },
    }),
  },
  {
    id: "mend", hint: /heal|hp|life|mend|hurt/i, eligible: (s) => s.hp < s.maxHp,
    make: () => ({
      dialogue: "Healing on credit. I'm a patient creditor. I collect the moment you turn your back.",
      effects: { hp: 15 }, curse: { trigger: "next_node", effect: { gold: -12 } },
    }),
  },
  {
    id: "soul", hint: /soul|forever|eternal/i, eligible: (s) => s.soul === 1,
    make: () => ({
      dialogue: "A formality. Sign here and the road gets easy. Think of me as insurance. You'll never need the claim.",
      effects: { soul: -1, gold: 60, max_hp: 10, attack: 1 },
    }),
  },
  {
    id: "bleed", hint: /blood|bleed|pain/i, eligible: (s) => s.hp > 8,
    make: () => ({ dialogue: "Gold is only blood that has been polite. Pay in the original currency.", effects: { hp: -5, gold: 40 } }),
  },
  {
    id: "fineprint", hint: /luck|safe|fortune|protect/i, eligible: () => true,
    make: () => ({
      dialogue: "More life in you, friend! Of course the first beast you meet might be a touch less friendly toward your sword arm.",
      effects: { max_hp: 8 }, curse: { trigger: "on_fight", effect: { attack: -1 } },
    }),
  },
  {
    id: "movefurniture", hint: /road|map|path|ahead|future/i,
    eligible: (_s, ctx) => ctx.rewritable.some((n) => GOOD.includes(n.kind)),
    make: (_s, ctx, rng) => {
      const target = pick(rng, ctx.rewritable.filter((n) => GOOD.includes(n.kind)));
      return {
        dialogue: "I've seen the road ahead, and frankly it was too comfortable. Let me move some furniture. You'll thank me. Eventually.",
        effects: { gold: 30, attack: 1 }, rewrite: { nodeId: target.id, to: "fight" },
      };
    },
  },
  {
    id: "hearth", hint: /rest|camp|road|ahead|safe/i,
    eligible: (s, ctx) => s.hp > 8 && ctx.rewritable.some((n) => n.kind === "fight"),
    make: (_s, ctx, rng) => {
      const target = pick(rng, ctx.rewritable.filter((n) => n.kind === "fight"));
      return {
        dialogue: "Ahead there's a beast waiting for you. I can make it a hearth instead, for a modest donation of blood. Don't ask what's feeding the fire.",
        effects: { hp: -8 }, rewrite: { nodeId: target.id, to: "campfire" },
      };
    },
  },
];

const FINE_PRINT = /fine print|loophole|clause|read the contract|contract/i;

/** Canned bad-faith offers, deterministic in (seed, ask sequence). Stands in until the Gemini devil is plugged in. */
export class StubDevil implements Devil {
  /**
   * Pure: the offer depends only on the request (seed, askIndex, state, context, text), never on what this
   * instance said before, so a saved GameState resumes identically with any StubDevil (or the mock server).
   * The seed argument is kept for API compatibility; the run seed in the context is what counts.
   */
  constructor(_seed?: string | number) {}

  async offer(state: Readonly<PlayerState>, context: DevilContext, playerText?: string): Promise<Deal> {
    const text = playerText ?? "";
    const rng: Rng = mulberry32(hashSeed(`devil:${context.seed}:${context.askIndex}`));
    const eligible = OFFERS.filter((o) => o.eligible(state, context));
    // He listens: if the wish names a theme (gold, strength, healing, the road...), he only offers deals on it.
    const heard = eligible.filter((o) => o.hint?.test(text));
    const pool = heard.length ? heard : eligible;
    const weights = pool.map(() => 1);
    let r = rng() * weights.reduce((a, b) => a + b, 0);
    let chosen = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) if ((r -= weights[i]) < 0) { chosen = pool[i]; break; }
    const deal = chosen.make(state, context, rng);
    if (deal.curse && FINE_PRINT.test(text)) { // the player's trick: he slips up and the curse is struck
      delete deal.curse;
      deal.dialogue = `You read the fine print aloud. He winces. "...Struck. Hateful habit, reading." ${deal.dialogue}`;
    }
    return deal;
  }
}
