/**
 * How hard the run is: the engine's enemies, its free healing, and the revival, in one place (difficulty pass, 4 Oct;
 * kbph: "the game feels way too easy to beat"). No imports, so any engine file may use it. Gold lives in economy.ts.
 * Measured numbers are in docs/FEATURES.md (section 5.3). Realtime fights (src/fight) start from these same HP and power
 * numbers (FightRequest), then apply their own SCALING on top.
 */

/** Regular foe, by act (0-based): HP `hp[act] + d(hpSpread)` (the die is 0..spread-1), damage per round `power[act] + d3`. */
export const FOE = { hp: [8, 12, 18], hpSpread: 4, power: [2, 3, 4] } as const;
/** Boss, by act: HP and damage per round (`power[act] + d3`). */
export const BOSS = { hp: [18, 28, 34], power: [3, 5, 5] } as const;
/** Free healing: after a boss falls (`victory`) and on the stairs down to the next act (`stairs`). */
export const FREE_HEAL = { victory: 10, stairs: 6 } as const;
/** The one revival (the soul pays): you wake with this share of max HP (rounded up, at least 1). */
export const REVIVE_SHARE = 0.5;
