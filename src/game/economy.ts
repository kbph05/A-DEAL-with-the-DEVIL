/**
 * The gold economy: every knob that decides how much gold comes in and what it buys, in one place (balance pass, 4 Oct;
 * kbph: "the gold inflation is insane"). No imports, so any engine file may use it.
 *
 * The aim: about one meaningful purchase per village visit, so heal-or-blade is a real choice; little gold left over at
 * the end (there is no shop after the act-3 boss, so his bounty and late act-3 kills are mostly dead gold); and the
 * devil's gold rare and small early, larger later, and always paid for with something real. Measured numbers are in
 * docs/FEATURES.md (section 5.3 and the simulation notes); `src/game/economy.test.ts` guards them.
 */

/** Gold a new run starts with (act 1 opens on a village: enough for one heal). */
export const START_GOLD = 10;

/**
 * Prices. The village sells heal (+12 HP) and blade (+1 attack); a well sells one blessing. The blade came down from 15
 * when income was cut by about 40%: a typical village visit (about 15g in hand) buys a blade or a heal, not both.
 */
export const WARES = { heal: { cost: 10 }, blade: { cost: 12 }, blessing: { cost: 8 } } as const;

/**
 * Regular kill bounty: `KILL_GOLD.base[act] + d(KILL_GOLD.spread)` (the die is 0..spread-1; act is 0-based): 4-6, 5-7,
 * 2-4 (was `4 + d5 + act`, 4-10). Act 3 pays little: most of what it pays comes after the last village.
 */
export const KILL_GOLD = { base: [4, 5, 2], spread: 3 } as const;
/** Boss bounty, the same way: 12-14, 14-16, 0-2 (was 12-17 each). Nothing is for sale after the act-3 boss. */
export const BOSS_GOLD = { base: [12, 14, 0], spread: 3 } as const;

/**
 * Most gold one deal may **give** (a curse or deal may still take up to 100). Enforced by sanitizeDeal (through
 * DELTA_RANGE in state.ts) for every devil, the StubDevil and the Gemini backend alike: see docs/devil-api.md.
 */
export const MAX_DEAL_GOLD = 30;

/**
 * The StubDevil's gold (src/game/devil.ts), scaled by `progress` (DevilContext: 0 at the start of act 1, 1 at the act-3
 * boss). An offer that pays gold pays `devilGold(progress)`: DEVIL_GOLD.min early, up to DEVIL_GOLD.max late, always well
 * under MAX_DEAL_GOLD.
 */
export const DEVIL_GOLD = { min: 4, max: 18 } as const;
/** Before this progress (mid act 2) the devil's opener offers the broke and the soul-seller no gold at all. */
export const DEVIL_GOLD_FROM = 0.5;
/**
 * Chance that a stub reply leads with a gold offer when one is in the pool, from progress 0 to 1 (linear): `unasked`
 * when the wish did not ask for gold, `asked` when it did (otherwise he steers the wish to something else).
 */
export const DEVIL_GOLD_LEAD = { unasked: [0.05, 0.4], asked: [0.25, 0.9] } as const;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * Math.min(1, Math.max(0, t));
/** The stub's gold payout at this point of the run. */
export const devilGold = (progress: number): number => Math.round(lerp(DEVIL_GOLD.min, DEVIL_GOLD.max, progress));
/** The chance that the stub leads with gold at this point of the run. */
export const devilGoldLead = (progress: number, asked: boolean): number => {
  const [early, late] = asked ? DEVIL_GOLD_LEAD.asked : DEVIL_GOLD_LEAD.unasked;
  return lerp(early, late, progress);
};
