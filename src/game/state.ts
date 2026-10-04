/** Player state, clamping helpers, and the one place stat ranges live. */
import { REVIVE_SHARE } from "./difficulty";
import { MAX_DEAL_GOLD, START_GOLD } from "./economy";

export interface PlayerState {
  hp: number;
  maxHp: number;
  gold: number;
  attack: number;
  /** 1 = still yours, 0 = sold or spent on a revival. */
  soul: 1 | 0;
  /** 0-based act index. */
  act: number;
  nodeId: string;
  log: string[];
}

export type StatKey = "hp" | "max_hp" | "gold" | "attack" | "soul";

/** Absolute range of each stat. */
export const STAT_RANGE: Record<"maxHp" | "gold" | "attack" | "soul", readonly [number, number]> = {
  maxHp: [1, 60], gold: [0, 999], attack: [1, 12], soul: [0, 1],
};
/** Range of a single signed change per stat: what a deal or curse may ask for at most. Gold gains stop at MAX_DEAL_GOLD (economy.ts). */
export const DELTA_RANGE: Record<StatKey, readonly [number, number]> = {
  hp: [-25, 25], max_hp: [-10, 10], gold: [-100, MAX_DEAL_GOLD], attack: [-3, 3], soul: [-1, 1],
};
/** Accepted effect keys. Anything else is ignored. "damage" is the team's name for attack. */
const ALIASES: Record<string, StatKey> = {
  hp: "hp", max_hp: "max_hp", maxHp: "max_hp", gold: "gold", attack: "attack", damage: "attack", soul: "soul",
};

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const LOG_CAP = 100;

export function newPlayer(nodeId: string): PlayerState {
  return { hp: 30, maxHp: 30, gold: START_GOLD, attack: 3, soul: 1, act: 0, nodeId, log: [] };
}

/** Pull every stat back into its legal range (hp 0..maxHp, gold >= 0, ...). Mutates and returns `s`. */
export function normalize(s: PlayerState): PlayerState {
  s.maxHp = clamp(Math.round(Number(s.maxHp)) || STAT_RANGE.maxHp[0], ...STAT_RANGE.maxHp);
  s.hp = clamp(Math.round(Number(s.hp)) || 0, 0, s.maxHp);
  s.gold = clamp(Math.round(Number(s.gold)) || 0, ...STAT_RANGE.gold);
  s.attack = clamp(Math.round(Number(s.attack)) || STAT_RANGE.attack[0], ...STAT_RANGE.attack);
  s.soul = s.soul === 1 ? 1 : 0;
  return s;
}

export const heal = (s: PlayerState, n: number): PlayerState => { s.hp += Math.max(0, n); return normalize(s); };
export const hurt = (s: PlayerState, n: number): PlayerState => { s.hp -= Math.max(0, n); return normalize(s); };
export const addGold = (s: PlayerState, n: number): PlayerState => { s.gold += n; return normalize(s); };
/** Pay `n` gold if you can afford it. */
export function spend(s: PlayerState, n: number): boolean {
  if (s.gold < n) return false;
  s.gold -= n;
  return true;
}

export function note(s: PlayerState, text: string): void {
  s.log.push(text);
  if (s.log.length > LOG_CAP) s.log.splice(0, s.log.length - LOG_CAP);
}

/**
 * HP <= 0 loses, except the soul revives you once (soul -> 0, back to REVIVE_SHARE of max HP). Call after anything that
 * lowers hp. "revived" and "dead" are the only results that change the state.
 */
export function settle(s: PlayerState): "alive" | "revived" | "dead" {
  normalize(s);
  if (s.hp > 0) return "alive";
  if (s.soul === 1) {
    s.soul = 0;
    s.hp = Math.max(1, Math.ceil(s.maxHp * REVIVE_SHARE));
    return "revived";
  }
  s.hp = 0;
  return "dead";
}

/** Keep known keys with finite numbers, clamp each to its per-change range. Never throws; junk in, {} out. */
export function sanitizeEffects(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!Object.hasOwn(ALIASES, k) || typeof v !== "number" || !Number.isFinite(v)) continue;
    const key = ALIASES[k];
    const [lo, hi] = DELTA_RANGE[key];
    const n = clamp(Math.round(v), lo, hi);
    out[key] = clamp((out[key] ?? 0) + n, lo, hi); // "damage" + "attack" both land on attack
  }
  return out;
}

/**
 * Apply effects (sanitized again, so callers can't skip it). Returns the deltas that actually landed after
 * clamping, keyed by stat (zero changes omitted).
 */
export function applyEffects(s: PlayerState, raw: unknown): Partial<Record<StatKey, number>> {
  const e = sanitizeEffects(raw);
  const before = { ...s };
  s.maxHp += e.max_hp ?? 0;
  normalize(s); // max_hp first so a same-deal hp gain is judged against the new cap
  s.hp += e.hp ?? 0;
  s.gold += e.gold ?? 0;
  s.attack += e.attack ?? 0;
  if (e.soul) s.soul = e.soul > 0 ? 1 : 0;
  normalize(s);
  const out: Partial<Record<StatKey, number>> = {};
  const put = (k: StatKey, was: number, now: number) => { if (was !== now) out[k] = now - was; };
  put("max_hp", before.maxHp, s.maxHp); put("hp", before.hp, s.hp); put("gold", before.gold, s.gold);
  put("attack", before.attack, s.attack); put("soul", before.soul, s.soul);
  return out;
}

/** Detached copy for events and for handing to the devil, so nobody can mutate live state through it. */
export const snapshot = (s: PlayerState): PlayerState => ({ ...s, log: [...s.log] });
