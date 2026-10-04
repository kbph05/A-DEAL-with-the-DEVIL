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
  /** Questions the player may still ask the devil this run, after this one (0 = this was the last; handy for taunts). */
  questionsLeft: number;
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

// ---- gibberish: random keyboard mashing makes the devil angry ----------------------------------------------------

const VOWELS = new Set("aeiouy");
const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"].flatMap((r) => [r, [...r].reverse().join("")]);
/** Real words that trip the low-vowel rule (8+ letters, at most one vowel). */
const LOW_VOWEL_WORDS = new Set(["strengths", "twelfths"]);

/** One run of Latin letters (lowercased, accents stripped): does it look typed at random? */
function junkWord(w: string): boolean {
  const n = w.length;
  if (n < 4) return false; // "hmm", "brr", "shh", "lol", "I", "me": too short to judge
  if (n >= 4 && KEY_ROWS.some((r) => r.includes(w))) return true; // "asdf", "hjkl", "zxcvbnm"
  if (n >= 5 && KEY_ROWS.some((r) => [...Array(n - 4).keys()].some((i) => r.includes(w.slice(i, i + 5))))) return true; // "qwerty...", "...asdfg..."
  const letters = [...w], vowels = letters.filter((c) => VOWELS.has(c)).length, distinct = new Set(letters).size;
  if (n >= 5 && vowels === 0 && distinct > 2) return true; // "kjhkjh", "sdfsdfsdf" ("hmmmm", "shhhh" have <= 2 distinct letters)
  if (/[^aeiouy]{6,}/.test(w) && vowels / n < 0.2) return true; // six consonants in a row: "asdfjkl" (not "Knightsbridge")
  if (n >= 8 && vowels / n < 0.2 && !LOW_VOWEL_WORDS.has(w)) return true; // "laksjdhflkajshdg"
  if (n >= 10 && distinct <= 2) return true; // "aaaaaaaaaaaa", "ababababab"
  if (n >= 9 && /^(.{1,3})\1{2,}$/.test(w)) return true; // "abcabcabc"
  return false;
}

/**
 * Is the player's text random keyboard noise rather than a (however odd) request? Deterministic and cheap: no
 * dictionary. Splits the text on spaces and looks at each Latin-letter run: no vowels at 5+ letters, six consonants in a
 * row, a low vowel share at 8+ letters, a keyboard row ("qwerty", "asdfg"), one or two letters repeated, or a short unit
 * repeated; a long token that flips between letters and digits ("a1b2c3d4") also counts. The text is gibberish when
 * half or more of its words are junk, or when it is mostly symbols (5+ non-letters, under half of them letters). Plain
 * short wishes ("gold", "heal me", "I read the fine print"), numbers, emoji, other scripts and the empty text are not.
 */
export function isGibberish(text: string | null | undefined): boolean {
  if (typeof text !== "string") return false;
  const t = text.normalize("NFD").replace(/\p{M}+/gu, "").trim();
  if (!t) return false;
  let words = 0, junk = 0, letters = 0, symbols = 0;
  for (const tok of t.split(/\s+/)) {
    for (const ch of tok) {
      if (/\p{L}/u.test(ch)) letters++;
      else if (!/[\p{N}.,'’"\-:;()\p{Extended_Pictographic}️‍]/u.test(ch)) symbols++;
    }
    const flips = (tok.match(/\p{L}(?=\d)|\d(?=\p{L})/gu) ?? []).length;
    if (tok.length >= 6 && flips >= 3) { words++; junk++; continue; } // "a1b2c3d4"
    for (const part of tok.split(/[^\p{L}]+/u)) {
      if (!part || !/^\p{Script=Latin}+$/u.test(part)) continue; // other scripts: not ours to judge
      words++;
      if (junkWord(part.toLowerCase())) junk++;
    }
  }
  if (symbols >= 5 && letters < symbols) return true; // "!@#$%^&*()"
  return words > 0 && junk * 2 >= words;
}

/** What he says to nonsense. No two alike; none of it kind. */
const ANGRY: readonly string[] = [
  "Did a cat walk across your keyboard, or is that your considered position? I have sat at this table a very long time. I do not enjoy being mocked, and I keep accounts.",
  "That was not a request. That was noise. You woke me for NOISE? Fine. Since you won't speak plainly, I'll choose the terms.",
  "Gibberish. To me. You spit nonsense across my table and expect courtesy back? Take what I give you and be grateful it's anything.",
  "Do not waste my patience on scribble. I am old, and I am very, very angry. Here: a bargain that matches your effort.",
];
/** Spite offers: strictly worse than the usual stock, and the curse is never optional. `hurts` ones need HP to spare. */
const SPITE: Array<{ hurts: boolean; make: () => Pick<Deal, "effects" | "curse"> }> = [
  { hurts: true, make: () => ({ effects: { hp: -8, gold: 10 }, curse: { trigger: "on_fight", effect: { attack: -1 } } }) },
  { hurts: false, make: () => ({ effects: { max_hp: -6, gold: 15 }, curse: { trigger: "next_node", effect: { hp: -6 } } }) },
  { hurts: false, make: () => ({ effects: { attack: -1, gold: 20 }, curse: { trigger: "on_hit", effect: { hp: -5 } } }) },
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
    if (isGibberish(text)) return this.angry(state, rng, context); // nonsense: no listening, no loopholes
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
    return { ...deal, dialogue: deal.dialogue + taunt(context) };
  }

  /** Angry reply to gibberish: in-character rant and a punitive offer. The fine-print trick does not work on it. */
  private angry(state: Readonly<PlayerState>, rng: Rng, context: DevilContext): Deal {
    const line = pick(rng, ANGRY);
    const spite = pick(rng, SPITE.filter((o) => !o.hurts || state.hp > 8));
    return { dialogue: line + taunt(context), ...spite.make() };
  }
}

/** A word about the run-wide question limit, once it is nearly spent. */
const taunt = (c: DevilContext): string =>
  c.questionsLeft === 0 ? " That was your last question, mortal." : c.questionsLeft === 1 ? " You have one question left. Spend it better." : "";
