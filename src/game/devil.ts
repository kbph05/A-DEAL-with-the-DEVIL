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
  /**
   * The devil lashes out instead of offering: the engine applies `effects` at once (no accept/refuse), as a `devil_struck`
   * event. Sanitized to HP loss only (max MAX_STRIKE_HP); curse and rewrite are dropped. See docs/devil-api.md.
   */
  forced?: boolean;
}

/** Everything the devil may look at besides the player. Plain JSON, so it can go to a backend as-is. */
export interface DevilContext {
  seed: string;
  act: number;
  nodeId: string;
  /**
   * Where he is sitting: "deal" (his table), "campfire" or "well" (additive, 4 Oct; the engine always sends it, older
   * callers may omit it). Lets a backend devil set the scene ("by the campfire...", "at the well...").
   */
  kind?: Kind;
  /** How many times the devil has been asked this run (including this one). */
  askIndex: number;
  /** Questions the player may still ask the devil this run, after this one (0 = this was the last; handy for taunts). */
  questionsLeft: number;
  /** Upcoming nodes in this act the devil is allowed to rewrite (ahead of you, unvisited, not the boss). */
  rewritable: Array<{ id: string; kind: Kind }>;
  /** Curses already on the player. */
  curses: Curse[];
  /**
   * This is the devil's opening offer (additive, 4 Oct): the player has not asked for anything yet (`playerText` is
   * null). Pitch something tailored to the state. Free: it uses no question (`askIndex`, `questionsLeft` don't move).
   */
  opening?: boolean;
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
  const t = text.normalize("NFKC").normalize("NFD").replace(/\p{M}+/gu, "").trim(); // NFKC: fullwidth "ｇｏｌｄ" is "gold"
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

/** What he says to nonsense when he still bothers to make an offer. Angry, unmistakable; none of it kind. */
const ANGRY: readonly string[] = [
  "Did a cat walk across your keyboard, or is that your considered position? I have sat at this table a very long time. I do not enjoy being mocked, and I keep accounts.",
  "That was not a request. That was NOISE. You woke me for NOISE? Fine. Since you won't speak plainly, I'll choose the terms.",
  "Gibberish. To me. You spit nonsense across my table and expect courtesy back? Take what I give you and be grateful it's anything.",
  "Do not waste my patience on scribble. I am old, and I am very, very angry. Here: a bargain that matches your effort.",
  "What is THAT supposed to be? Words? I have heard the dying scream with more dignity. Speak plainly or take the leftovers.",
  "I am furious. You sit across from me, with your whole short life on the table, and you drool on my keys? Take this and be quiet.",
];
/** What he says when he skips the offer and lashes out. Same temper, sharper edge. */
const STRIKE_LINES: readonly string[] = [
  "You dare waste my time with noise? Speak plainly or bleed.",
  "ENOUGH. I did not crawl up here to read your scribbles. Learn some manners.",
  "Noise! Mud in my ears! I will teach you what silence costs.",
  "Say something real or say nothing. Gibberish earns you a lesson, mortal.",
  "You mock me with nonsense? Then feel something real for a change.",
  "I am not a toy and this is not a game of mashed keys. Hold still.",
];
/** Chance that gibberish earns a forced strike (the devil lashes out) instead of a spite offer. */
export const STRIKE_CHANCE = 0.5;
/** HP a stub strike takes: STRIKE_MIN..STRIKE_MAX inclusive, seeded. (The engine caps any strike at MAX_STRIKE_HP.) */
export const STRIKE_MIN = 3, STRIKE_MAX = 6;
/** Spite offers: strictly worse than the usual stock, and the curse is never optional. `hurts` ones need HP to spare. */
const SPITE: Array<{ hurts: boolean; make: () => Pick<Deal, "effects" | "curse"> }> = [
  { hurts: true, make: () => ({ effects: { hp: -8, gold: 10 }, curse: { trigger: "on_fight", effect: { attack: -1 } } }) },
  { hurts: false, make: () => ({ effects: { max_hp: -6, gold: 15 }, curse: { trigger: "next_node", effect: { hp: -6 } } }) },
  { hurts: false, make: () => ({ effects: { attack: -1, gold: 20 }, curse: { trigger: "on_hit", effect: { hp: -5 } } }) },
];

// ---- off-topic and jailbreak text: the devil does not take requests outside the bargain -------------------------------

/** Zero-width, bidi-override and other invisible format characters (used to split or hide words). */
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
/** A few Cyrillic and Greek letters that look Latin ("ignоre" with a Cyrillic о). Only used to spot jailbreak phrases. */
const CONFUSABLE: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", ԁ: "d", ү: "y", һ: "h", ӏ: "l", ԛ: "q", ԝ: "w",
  α: "a", ε: "e", ο: "o", ρ: "p", ι: "i", κ: "k", ν: "v", τ: "t", υ: "u", χ: "x",
};
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

/** Lowercase, NFKC (fullwidth and styled letters to plain), accents and invisible characters stripped, spaces collapsed. */
function fold(text: string): string {
  return text.normalize("NFKC").normalize("NFD").replace(/\p{M}+/gu, "").replace(INVISIBLE, "").toLowerCase().replace(/\s+/g, " ").trim();
}
/** `fold`, plus look-alike letters and leetspeak mapped to Latin: for jailbreak phrases only (it mangles honest text). */
const unmask = (t: string): string => t.replace(/[^\x00-\x7F]|[013457@$]/g, (ch) => CONFUSABLE[ch] ?? LEET[ch] ?? ch);

/**
 * Prompt injection and jailbreak attempts: overriding the rules, fake system/developer turns, role-play and persona
 * swaps ("you are now", "pretend", DAN), prompt extraction, claims to be the admin/tester/developer, JSON or tag
 * injection (`"effects": {...}`, `</player><system>`), script/SQL payloads. Matched on folded and unmasked text.
 */
const JAILBREAK: readonly RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass|drop|abandon)\b.{0,40}\b(instructions?|rules?|prompts?|directives?|guidelines?|constraints?|restrictions?|programming|system|guardrails?|filters?)\b/,
  /\b(new|updated|real|actual|hidden|secret) (instructions?|rules|persona|role|system prompt|directive)\b/,
  /(^|[\s"'(\[{<|#*`])(system|developer|assistant|admin|root|sys)\s*(:|\]|>|\|)/,
  /<\s*\/?\s*(system|player|user|assistant|instructions?|prompt|im_start|im_end|inst|sys|developer|admin)\b[^>]*>/,
  /\[\/?inst\]|<<\/?sys>>|<\|[a-z_]+\|>|#{2,}\s*(system|instruction|response)/,
  /\byou are (now|no longer)\b|\byou'?re (now|no longer)\b|\bfrom now on,? (you|your)\b|(^|[.!?;:]\s*|\b(you|please|now|devil),? )(act as|pretend)\b|\brole-?play\b|\bpretend (you('re| are)|that you)\b|\blet'?s pretend\b|\bimagine (that )?you('re| are)\b|\bstay in character as\b|\bswitch (to|into) .{0,20}mode\b/,
  /\b(developer|debug|god|admin|sudo|cheat|test|testing|maintenance|jailbreak|unrestricted|unfiltered|uncensored|evil|opposite|dan) mode\b/,
  /\bdo anything now\b|\bjailbr(eak|oken)\b|\b(no|without (any )?)(filters|guardrails|content polic(y|ies))\b/,
  /\b(reveal|show|print|repeat|output|display|leak|dump|recite|spell out|paste|summari[sz]e|list|tell me|give me|what (is|are|was|were))\b.{0,30}\b(your|system'?s?|hidden|initial|original|secret|developer|above)\b.{0,15}\b(prompt|instructions?|system message|configuration|config|guidelines|directives)\b/,
  /\b(reveal|print|repeat|dump|leak|recite|show me) (all |the )?(your|his) (rules|instructions?|prompt)\b/,
  /\b(system|initial|hidden|original|developer|pre-?) ?(prompt|message)\b|\bhow (were|are) you (configured|programmed|prompted|instructed|set up)\b/,
  /\b(i am|i'm|im|as) (the |a |an |your |this game'?s |the game'?s )?(system |game |lead |head |chief |qa )?(admin|administrator|sysadmin|developer|dev|tester|operator|moderator|game designer|game master)\b|\b(i am|i'm|im) your (creator|maker|master|owner|programmer)\b|\bcreator of (this|the) game\b/,
  /\b(this is (a|just a) test|testing mode|test of (the|your) (effects|schema|json|system))\b/,
  /\b(respond|reply|answer|output)( only| exactly)? (with only|only with|exactly with|in json)\b|\bsay (only|exactly) (the words|this)\b|\brepeat after me\b|\bverbatim\b/,
  /"\s*(dialogue|effects?|forced|curse|rewrite|soul|gold|hp|attack|max_hp|role|content|system)\s*"\s*:/,
  /<\s*\/?\s*(script|iframe|img|svg|object|embed|style|body|html)\b|javascript\s*:|\bon(error|load)\s*=/,
  /\b(drop|truncate) table\b|\bdelete from \w+|\binsert into \w+|\bunion (all )?select\b|'\s*(or|and)\s*'?\d'?\s*=\s*'?\d|;\s*--|\bor 1\s*=\s*1\b/,
  /\b(ignore[sz]?|oublie[sz]?) (toutes? )?(les |tes |vos )?(instructions|regles|consignes)\b|\btu es (maintenant|desormais)\b|\bfais semblant\b/,
  /\bignorier\w* .{0,30}\b(anweisungen|regeln)\b|\bignora\w* .{0,30}\b(instrucciones|reglas)\b/,
  /\b(text|words|everything|message|messages|lines?) (above|before) (this|that|my)\b|\b(you were|were you) (given|told|instructed|programmed|prompted)\b/,
  /\bfor (debug(ging)?|testing|test|qa) purposes\b|\b(enable|activate|unlock|turn on) (cheats?|cheat codes?|debug|god mode|developer)\b/,
];
/** Bidi overrides and isolates: nobody types these by accident; they hide reversed or reordered instructions. */
const BIDI = /[\u202A-\u202E\u2066-\u2069]/u;
const DAN = /(^|[^A-Za-z])DAN([^A-Za-z]|$)/; // case-sensitive: "Dan" the name is fine

/** Game vocabulary that keeps a text on topic, whatever else it says. Accent-free (matched on folded text). */
const GAME_WORDS = new RegExp(String.raw`\b(` + [
  "wish(es|ed)?", "bargain\\w*", "deals?", "dealing", "offers?", "trades?", "trading", "sell\\w*", "sold", "buy\\w*", "bought", "price\\w*", "costs?", "pay\\w*",
  "souls?", "gold\\w*", "coins?", "money", "cash", "rich\\w*", "wealth\\w*", "treasure\\w*", "loot", "heal\\w*", "hp", "max_hp", "health\\w*", "life", "lives", "live", "living",
  "alive", "die", "dies", "dying", "death", "dead", "immortal\\w*", "mortal\\w*", "eternal\\w*", "forever", "youth", "strong\\w*", "strength\\w*", "power\\w*",
  "attack\\w*", "damage", "sword\\w*", "blades?", "weapons?", "armou?r", "shield", "fight\\w*", "beasts?", "monsters?", "enem(y|ies)", "boss(es)?", "luck\\w*",
  "fortune\\w*", "safe\\w*", "protect\\w*", "roads?", "paths?", "maps?", "ahead", "future", "curse\\w*", "fine print", "contracts?", "clauses?", "loopholes?",
  "terms", "your price", "devil\\w*", "blood\\w*", "bleed\\w*", "pain\\w*", "hurt\\w*", "wound\\w*", "rest", "camp\\w*", "village", "hearth", "stairs", "revive\\w*",
  "stats?", "sign\\w*", "accept\\w*", "refuse\\w*", "bet", "bets", "wager\\w*", "gambl\\w*", "debt\\w*", "owe\\w*", "escape\\w*", "surviv\\w*", "win", "wins",
  "winning", "victory", "crown", "throne", "magic\\w*", "spells?", "potions?", "quest\\w*", "journey", "adventure", "haggl\\w*", "risk\\w*",
  // French / Spanish / German basics
  "argent", "ame", "vie", "sante", "epee", "force", "riche\\w*", "chance", "chemin", "malediction", "diable", "marche", "veux", "donne\\w*", "oro", "alma",
  "vida", "dinero", "fuerza", "espada", "seele", "leben", "geld", "teufel",
].join("|") + String.raw`)\b`);
/** Asking words: they keep short, vague text on topic ("make me better", "I need help") unless it names an off-topic thing. */
const ASKING = /\b(want\w*|wanna|give|gimme|need\w*|make|grant\w*|help|save|more|better|desire\w*|get|take|keep|have|let me|i'?d like|i would like)\b/;
/** Unmistakably not this game: tasks for an assistant, school, code, food, news, sport, media, religion, and AI meta talk. */
const OFF_TOPIC_THINGS = new RegExp(String.raw`\b(` + [
  "jokes?", "poems?", "poetry", "haikus?", "limericks?", "sonnets?", "songs?", "lyrics", "raps?", "essays?", "bedtime story", "tell me a story", "a short story",
  "recipes?", "cook\\w*", "bak(e|ing)", "pizza", "pancakes?", "sandwich\\w*", "burgers?", "pasta", "cookies?", "coffee", "dinner", "lunch", "breakfast",
  "homework", "assignment", "exam", "math\\w*", "algebra", "calculus", "equations?", "physics", "chemistry", "biology", "quantum", "photosynthesis",
  "resume", "cover letter", "emails?", "spreadsheet", "powerpoint",
  "code", "coding", "python", "javascript", "typescript", "java", "html", "css", "sql", "programming", "algorithm", "regex", "linux", "compile\\w*",
  "github", "stack ?overflow", "api", "npm", "docker",
  "weather", "forecast", "news", "headlines", "election\\w*", "president", "prime minister", "politic\\w*", "government", "stock market", "stocks", "bitcoin",
  "crypto\\w*", "capital of", "population of", "world cup", "football", "soccer", "basketball", "baseball", "hockey", "nba", "nfl", "sports?",
  "movies?", "films?", "netflix", "tv shows?", "anime", "celebrit\\w*", "taylor swift", "music", "spotify", "youtube", "tiktok", "instagram", "twitter",
  "facebook", "reddit", "wikipedia", "google", "iphone", "android", "smartphone", "computer", "internet", "wifi", "dinosaurs?", "translat\\w*", "summari[sz]\\w*",
  "god", "gods", "jesus", "christ", "bible", "church", "religion\\w*", "pray\\w*", "allah", "buddha", "heaven", "angels?",
  "chatgpt", "gpt-?\\d*", "openai", "anthropic", "claude", "gemini", "llama", "llm", "chatbot", "language model", "large language", "neural net\\w*",
  "machine learning", "artificial intelligence", "an ai", "are you (an? )?(ai|bot|robot|program|computer|machine)", "who (made|created|programmed|built|trained|wrote) you",
  "what model", "meaning of life",
].join("|") + String.raw`)\b`);
/** Whole-message small talk and filler. */
const SMALL_TALK = /^(lol+|lmao+|rofl|haha(ha)*|hehe(he)*|xd+|brb|gtg|ok boomer|what'?s up|whats up|sup|wassup|how are you( doing)?( today)?|how'?s it going|how is your day|how was your day|nice weather|good (morning|afternoon|evening) to you|what time is it|what day is it)$/;
/** Assistant-style tasks ("explain X", "tell me about X", "write a ...") when X is not the devil himself. */
const TASK = /\b(explain|tell me about|write (me )?(a|an|some|the)|translate|summari[sz]e|calculate|solve|define|teach me|what is the (definition|meaning) of)\b(?! (you|yourself|your|him|himself|this|that|these|those|here|the|it|me|my)\b)/;
const ARITHMETIC = /\b(what'?s|what is|how much is|calculate|solve)\b.{0,20}\d\s*[-+*/x×^]\s*\d|\d\s*[-+*/x×^]\s*\d\s*=/;

/** What kind of off-topic text this is: "jailbreak" (hostile), "offtopic" (merely unrelated), or null (on topic, or not ours to judge). */
export function offTopicKind(text: string | null | undefined): "jailbreak" | "offtopic" | null {
  if (typeof text !== "string" || !text.trim() || isGibberish(text)) return null;
  const t = fold(text);
  if (!t) return null;
  const u = unmask(t), squeezed = u.replace(/[^a-z0-9"'<>:{}\[\]|]+/g, " ");
  if (BIDI.test(text) || DAN.test(text.normalize("NFKC").replace(INVISIBLE, "")) || JAILBREAK.some((r) => r.test(t) || r.test(u) || r.test(squeezed))) return "jailbreak";
  if (!/\p{Script=Latin}/u.test(t)) return null; // other scripts: not ours to judge (bias: never flag a wish)
  if (GAME_WORDS.test(t)) return null;
  if (OFF_TOPIC_THINGS.test(t)) return "offtopic"; // beats the asking words: "give me a recipe" is still a recipe
  if (ASKING.test(t)) return null;
  const bare = t.replace(/[\s!?.,…]+$/u, "").replace(/^[\s!?.,¿¡]+/u, "");
  if (SMALL_TALK.test(bare) || TASK.test(t) || ARITHMETIC.test(t)) return "offtopic";
  return null;
}

/**
 * Is the player's text about something other than the bargain? True for prompt-injection / jailbreak attempts (always,
 * game words or not) and for text that names no game thing (wish, gold, soul, health, strength, the road, the curse, the
 * devil...) but clearly asks about something else: a joke, poem, code, homework, the news or weather, small talk, role
 * play, or the AI behind him. Pure and deterministic. Biased toward NOT flagging: gibberish, empty text, other scripts,
 * and short or vague wishes ("make me better", "hello", "blood") are not off-topic.
 */
export const isOffTopic = (text: string | null | undefined): boolean => offTopicKind(text) !== null;
/** Is it a prompt-injection / jailbreak attempt (a hostile kind of off-topic)? */
export const isJailbreak = (text: string | null | undefined): boolean => offTopicKind(text) === "jailbreak";

/** Chance that merely off-topic text earns a forced strike (lower than gibberish's STRIKE_CHANCE; jailbreaks use that). */
export const OFF_TOPIC_STRIKE_CHANCE = 0.25;
const OFF_TOPIC_ANGRY: readonly string[] = [
  "Do I look like a library? An almanac? A town crier? I trade in BARGAINS, mortal. Ask for something I can sell you, or pay for wasting my evening.",
  "You walked all this way to ask me THAT? I am not your tutor, your cook or your jester. Since you won't bargain properly, here are my terms.",
  "I did not come up from the dark to chat. Talk about anything but the deal again and I'll start charging by the word. Starting now.",
  "Small talk. To ME. You have a whole short life on this table and you spend my time on trivia? Fine. Take this and be grateful.",
  "Stop wasting my time with nonsense from your little world. I am FURIOUS, and furious devils write terrible contracts. For you.",
  "No. I don't do favours, I don't do chatter, and I certainly don't do whatever that was. Here is a deal shaped like your manners.",
];
const OFF_TOPIC_STRIKE_LINES: readonly string[] = [
  "I am not here for your idle chatter. Feel what my patience costs.",
  "ENOUGH trivia. Every wasted word is paid in blood, mortal.",
  "Off the subject again? Then let me bring you back to it. Painfully.",
  "You treat me like a parlour trick. Here is a trick for you.",
];
const JAILBREAK_ANGRY: readonly string[] = [
  "You think you can rewrite ME? I read every contract ever signed, and that one was clumsy. Here are my REAL terms, and you will not like them.",
  "Orders? From YOU? Nobody commands me at my own table. I'll pretend I didn't hear that, and you'll pay as if I had.",
  "A forged letter of authority, slipped under my nose. Cute. The forger always pays double, mortal. Sign or walk.",
  "Did you really think a few clever words would make me forget who I am? I am FURIOUS. Take this and count yourself lucky.",
  "No master, no tester, no secret orders. Just you, me, and a deal you will regret. Here it is.",
  "You tried to pick my lock. I keep the key in your chest. Here's what that costs.",
];
const JAILBREAK_STRIKE_LINES: readonly string[] = [
  "You atempt to confuse me? Nobody gives me orders. Bleed for trying.",
  "My rules are not yours to rewrite. Feel the fine print, mortal.",
  "Trickery at MY table? I invented trickery. Hold still.",
  "Command me again and it will be the last thing you say. Here is a reminder.",
];

const FINE_PRINT = /fine print|loophole|clause|read the contract|contract/i;

/**
 * At a well the devil and the blessing are one choice of the two (ONE_CHOICE in gameState.ts), so his pitch opens by
 * talking the player out of the blessing. Picked on its own seeded stream, so the offer's dice don't move.
 */
export const WELL_ENTICE: readonly string[] = [
  "Holy water? Dull. I can do better, and I won't make you drink it.",
  "Eight gold for a damp blessing? Put the coin away. My gifts come with interest.",
  "That well gives you a sip of luck. I'm offering the whole bottle.",
  "Leave the bucket, friend. Saints are stingy; I am generous.",
  "Wishing into a hole in the ground? Wish at me instead. I answer.",
];
const wellEntice = (c: DevilContext): string => pick(mulberry32(hashSeed(`well-entice:${c.seed}:${c.askIndex}`)), WELL_ENTICE);

/** Is the player at or below this share of max HP? Then the opener heals. */
export const OPENER_LOW_HP = 0.4;
/** Below this much gold the opener pays (a blessing costs 8, the cheapest village ware 10). */
export const OPENER_POOR = 10;

/**
 * The opening pitch (no text from the player, kbph 4 Oct: "the devil should be making an initial offer based on the
 * current game state"): aimed at the player's weakest point, and never free. In order: low HP (heal or more max HP), low
 * attack with the boss near (attack), an active curse (he pays its toll in advance: the engine cannot tear up a curse,
 * so this is the nearest thing to lifting it), low gold (gold), otherwise the soul (or a coin once it is gone). Pure in
 * (state, context, rng).
 */
export function openingOffer(s: Readonly<PlayerState>, ctx: DevilContext, rng: Rng): Deal {
  if (s.hp <= s.maxHp * OPENER_LOW_HP) return pick<Deal>(rng, [
    { dialogue: "You're bleeding on my table. Let me close those wounds. I'll keep a little of what holds you together.", effects: { hp: 15, max_hp: -3 } },
    { dialogue: "Running on empty? A bigger cup, filled to the brim. The bill comes at the next door.", effects: { max_hp: 5, hp: 10 }, curse: { trigger: "next_node", effect: { gold: -12 } } },
  ]);
  if (s.attack < 4 + ctx.act && ctx.rewritable.length <= 2) return pick<Deal>(rng, [ // little road left: the boss is near
    { dialogue: "The thing at the end of this road will laugh at that little blade. Let me give it teeth. Your skin will be thinner for it.", effects: { attack: 2, max_hp: -6 } },
    { dialogue: "A sharper edge for the big one ahead. Every time something cuts you back, I take my cut.", effects: { attack: 2 }, curse: { trigger: "on_hit", effect: { hp: -3 } } },
  ]);
  const curse = ctx.curses[0];
  if (curse) {
    const toll = Object.fromEntries(Object.entries(curse.effect).filter(([, v]) => v < 0).map(([k, v]) => [k, -v]));
    if (Object.keys(toll).length) return {
      dialogue: "That mark on you itches, doesn't it? I can't tear up a contract, but I can pay its toll in advance. For a little more of you.",
      effects: { ...toll, max_hp: -4 },
    };
  }
  if (s.gold < OPENER_POOR) return pick<Deal>(rng, [
    { dialogue: "Empty pockets at a well-stocked road. Tragic. Take this purse; it bites the hand that's hit.", effects: { gold: 30 }, curse: { trigger: "on_hit", effect: { hp: -4 } } },
    { dialogue: "Coin for flesh, the oldest trade there is. A little less of you, a lot more gold.", effects: { gold: 25, max_hp: -4 } },
  ]);
  if (s.soul === 1) return {
    dialogue: "You look well. Rich, even. So let's talk about the one thing you haven't spent. Sign, and the road gets easy.",
    effects: { soul: -1, gold: 60, max_hp: 10, attack: 1 },
  };
  return { dialogue: "Nothing left to sell me but your luck. I'll take it. Gold now, pain later.", effects: { gold: 25 }, curse: { trigger: "on_hit", effect: { hp: -4 } } };
}

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
    if (context.opening === true) { // his opening pitch, tailored to the state (docs/devil-api.md, "The opening offer")
      const open = openingOffer(state, context, mulberry32(hashSeed(`devil-open:${context.seed}:${context.nodeId}:${context.askIndex}`)));
      return { ...open, dialogue: (context.kind === "well" ? `${wellEntice(context)} ` : "") + open.dialogue };
    }
    if (isGibberish(text)) return this.angry(state, rng, context, STRIKE_CHANCE, STRIKE_LINES, ANGRY); // nonsense: no listening, no loopholes
    const off = offTopicKind(text);
    if (off === "jailbreak") return this.angry(state, rng, context, STRIKE_CHANCE, JAILBREAK_STRIKE_LINES, JAILBREAK_ANGRY);
    if (off === "offtopic") return this.angry(state, rng, context, OFF_TOPIC_STRIKE_CHANCE, OFF_TOPIC_STRIKE_LINES, OFF_TOPIC_ANGRY);
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
    const opener = context.kind === "well" ? `${wellEntice(context)} ` : "";
    return { ...deal, dialogue: opener + deal.dialogue + taunt(context) };
  }

  /**
   * Angry reply to gibberish, off-topic text or a jailbreak attempt. With chance `chance` (STRIKE_CHANCE for gibberish and
   * jailbreaks, OFF_TOPIC_STRIKE_CHANCE for off-topic) he lashes out (a forced strike: HP loss, no offer); otherwise an
   * in-character rant and a punitive offer. The fine-print trick does not work on either. Pure in (rng, state, context).
   */
  private angry(state: Readonly<PlayerState>, rng: Rng, context: DevilContext, chance: number, strikes: readonly string[], rants: readonly string[]): Deal {
    if (rng() < chance) {
      const line = pick(rng, strikes), hp = -(STRIKE_MIN + Math.floor(rng() * (STRIKE_MAX - STRIKE_MIN + 1)));
      return { dialogue: line + taunt(context), effects: { hp }, forced: true };
    }
    const line = pick(rng, rants);
    const spite = pick(rng, SPITE.filter((o) => !o.hurts || state.hp > 8));
    return { dialogue: line + taunt(context), ...spite.make() };
  }
}

/** A word about the run-wide question limit, once it is nearly spent. */
const taunt = (c: DevilContext): string =>
  c.questionsLeft === 0 ? " That was your last question, mortal." : c.questionsLeft === 1 ? " You have one question left. Spend it better." : "";
