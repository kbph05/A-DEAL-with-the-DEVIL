/**
 * Encounters (kbph, Big Chungus): who you meet on a forest path, and how hard they are. Pure and seeded:
 * `encounterFor(request)` turns the engine's fight request into a group of roster enemies (enemies.ts).
 *
 * - **Progress** is how far up the run the fight is: `(act + layer / layers) / acts` from the request's `where` (the
 *   engine's act is 0-based), 0 at the bottom of act 1,
 *   near 1 at the top of the last act. Later acts start harder because they start higher.
 * - **Count and composition** come from the band the progress falls in (`ENCOUNTER_BANDS`): 1 to 2 orcs at the
 *   bottom, up to 3 to 5 near the top (orcs only since 4 Oct: the enemies we have sprites for). The seed picks the count.
 * - **Per-enemy feel** scales with progress too (Big Chungus: "don't just scale damage and defense"): walking speed
 *   up, attack cooldown down, the hitstun it inflicts up, and the stun it takes when hit down (tougher enemies shrug
 *   it off faster). Each is the enemy's base value (ENEMIES) times a progress curve (`SCALING`).
 * - **The engine's numbers stay authoritative:** the group's HP adds up to the engine enemy's `hp`, and each enemy's
 *   power is the engine enemy's `power` times its damage factor. So the FightResult maps back as is: `enemyHpLeft`
 *   is the sum left, `won` means all of them dropped.
 * - **Bosses:** a boss request is one boss, `miniboss1` in act 1, `miniboss2` in act 2, `final_boss` in the last act.
 * - **Names:** the engine's enemy is the encounter. Its name is the encounter's `title` ("Orc raider", or "Orc raider and
 *   its pack" for a group) and labels the group's lead (the band's `lead`, which every group has); the rest of the pack
 *   keep their roster labels. A boss keeps the engine's boss name. The end-of-fight line (`encounterSummary`) says
 *   "Orc raider falls." as the engine's `enemy_slain` event does.
 */
import { hashSeed, mulberry32 } from "../map/rng";
import { ENEMIES, baseParams, enemyPower, enemyTier, type EnemyId, type EnemyParams } from "./enemies";
import type { FightRequest } from "../game/fightResult";
import { sanitizeInput, type FightInput } from "./logic";

/**
 * Where the fight is on the run's map: the engine's optional `FightRequest.where` (src/game/fightResult.ts): `act`
 * of `acts` (0-based), the node's `layer` of the act's `layers` (0 = the entry, `layers - 1` = the boss), the node
 * `kind`. Optional: older saved requests lack it.
 */
export type FightWhere = NonNullable<FightRequest["where"]>;
/** The fight request (`FightRequest` from src/game/fightResult.ts), with the optional `where`. */
export type ForestRequest = FightInput & { where?: FightWhere };

export interface EncounterBand {
  /** This band covers progress up to (not including) `upTo`; the last one catches the rest. */
  upTo: number;
  /** How many enemies, inclusive (capped by the HP: every enemy needs at least 1). */
  count: readonly [number, number];
  /** Always in the group. */
  lead: EnemyId;
  /** The rest are drawn from these weights. */
  mix: Partial<Record<EnemyId, number>>;
}

/**
 * Tunable: count and composition by progress. Since 4 Oct (Big Chungus: "disable any enemies we don't have sprites
 * for") every band is orcs only: the count still rises with progress, and each orc's feel scales with `SCALING`. The
 * slime, demon and skeleton archer are out of the tables but still in the roster (ENEMIES), so putting one back is a
 * data change here. The bands as they were: slime; slime 3 + demon 1; slime 2 + demon 2 (demon lead); slime 1 +
 * demon 2 + archer 1 (demon lead); slime 1 + demon 2 + archer 2 (archer lead).
 */
export const ENCOUNTER_BANDS: readonly EncounterBand[] = [
  { upTo: 0.15, count: [1, 2], lead: "orc", mix: { orc: 1 } },
  { upTo: 0.35, count: [2, 3], lead: "orc", mix: { orc: 1 } },
  { upTo: 0.55, count: [2, 4], lead: "orc", mix: { orc: 1 } },
  { upTo: 0.75, count: [3, 4], lead: "orc", mix: { orc: 1 } },
  { upTo: Number.POSITIVE_INFINITY, count: [3, 5], lead: "orc", mix: { orc: 1 } },
];

export type ScaledStat = "speed" | "attackCd" | "hitstun" | "stunTaken";
/** Tunable: each stat's multiplier at progress 0 and at progress 1 (linear in between). */
export const SCALING: Readonly<Record<ScaledStat, readonly [number, number]>> = {
  speed: [0.85, 1.25], // walking speed: faster higher up
  attackCd: [1.3, 0.7], // attack cooldown: shorter higher up
  hitstun: [0.6, 1.5], // the hitstun it inflicts on you: longer higher up
  stunTaken: [1.5, 0.45], // how long a sword hit stuns it: shorter higher up
};

/** Where along the path enemies stand, nearest first: slimes, then demons, then archers behind them. */
const RANK: Record<EnemyId, number> = { orc: 0, slime: 0, demon: 1, skeleton_archer: 2, miniboss1: 3, miniboss2: 3, final_boss: 3 };

/** Without `where` (an older engine): the act from the enemy's power, a mid-act layer (the top for a boss), 3 acts. */
export const FALLBACK = { acts: 3, regularLayer: 0.5, bossLayer: 6 / 7 } as const;

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Progress 0..1 up the run: `(act + layer / layers) / acts`, with the engine's 0-based act. */
export function progressOf(req: ForestRequest): number {
  const w = req.where;
  if (w && [w.act, w.acts, w.layer, w.layers].every((n) => typeof n === "number" && Number.isFinite(n)) && w.acts > 0) {
    return clamp01((w.act + clamp01(w.layers > 0 ? w.layer / w.layers : 0)) / w.acts);
  }
  const boss = req.enemy?.boss === true;
  const act = enemyTier(Number(req.enemy?.power) || 0, boss) + 1;
  return clamp01((act - 1 + (boss ? FALLBACK.bossLayer : FALLBACK.regularLayer)) / FALLBACK.acts);
}

/** The act (1-based) and the run's act count, from `where` or the fallback. */
function actOf(req: ForestRequest): { act: number; acts: number } {
  const w = req.where;
  if (w && Number.isFinite(w.act) && Number.isFinite(w.acts) && w.acts > 0) return { act: Math.round(w.act) + 1, acts: Math.round(w.acts) };
  return { act: enemyTier(Number(req.enemy?.power) || 0, req.enemy?.boss === true) + 1, acts: FALLBACK.acts };
}

/** The band for a progress. */
export const bandAt = (progress: number): number => {
  const i = ENCOUNTER_BANDS.findIndex((b) => progress < b.upTo);
  return i < 0 ? ENCOUNTER_BANDS.length - 1 : i;
};

/** A stat's multiplier at `progress`. */
export const scaleAt = (stat: ScaledStat, progress: number): number => {
  const [a, b] = SCALING[stat];
  return a + (b - a) * clamp01(progress);
};

/** An enemy's params at `progress`: its base values times the curve. */
export function scaledParams(id: EnemyId, progress: number): EnemyParams {
  const b = baseParams(id);
  return {
    ...b,
    speed: Math.round(b.speed * scaleAt("speed", progress)),
    attackCdMs: Math.round(b.attackCdMs * scaleAt("attackCd", progress)),
    hitstunMs: Math.round(b.hitstunMs * scaleAt("hitstun", progress)),
    stunTakenMs: Math.round(b.stunTakenMs * scaleAt("stunTaken", progress)),
  };
}

/** The boss for an act: miniboss 1 in act 1, the final boss in the last act, miniboss 2 between. */
export const bossFor = (act: number, acts: number): EnemyId => (act >= acts ? "final_boss" : act <= 1 ? "miniboss1" : "miniboss2");

/**
 * Split `total` across `weights` so the parts add up exactly: each gets 1 first (when there's enough), the rest by
 * weight, rounding by largest remainder (ties to the earlier one).
 */
export function splitHp(total: number, weights: readonly number[]): number[] {
  const n = weights.length;
  const t = Math.max(0, Math.round(total));
  if (n === 0) return [];
  const floor = t >= n ? 1 : 0;
  const rest = t - floor * n;
  const W = weights.reduce((a, w) => a + w, 0) || 1;
  const raw = weights.map((w) => (rest * w) / W);
  const out = raw.map((r) => floor + Math.floor(r));
  let left = t - out.reduce((a, v) => a + v, 0);
  const order = raw.map((r, i) => ({ f: r - Math.floor(r), i })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) out[order[k].i]++;
  return out;
}

export interface EncounterEnemy {
  id: EnemyId;
  /** Shown above it: the engine's enemy name for the boss and the group's lead, the roster label for the rest. */
  name: string;
  boss: boolean;
  hp: number;
  maxHp: number;
  /** Its power (damage), from the engine enemy's. */
  power: number;
  /** Its params at this progress (speed, cooldown, stuns scaled). */
  params: EnemyParams;
}

export interface Encounter {
  /** The engine enemy's name, as the engine's events say it ("orc raider", "the Gatekeeper"). */
  foe: string;
  /** Shown as the fight's heading: the engine name, capitalized, plus " and its pack" for a group. */
  title: string;
  progress: number;
  /** Index into ENCOUNTER_BANDS (-1 for a boss). */
  band: number;
  act: number;
  acts: number;
  boss: boolean;
  enemies: EncounterEnemy[];
  /** The engine enemy's HP, split across the group (the sum of `enemies[].hp`). */
  totalHp: number;
  /** The curve's multipliers at this progress, for the lab's readout. */
  scale: Record<ScaledStat, number>;
}

export interface EncounterOptions {
  /** Lab: make every enemy this kind (a boss id gives a single boss). */
  force?: EnemyId;
}

/** Capitalize the first letter only ("orc raider" -> "Orc raider", "the Gatekeeper" -> "The Gatekeeper"), as the UI's `capitalize`. */
const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** The encounter's heading from the engine's enemy name: "Orc raider", or "Orc raider and its pack" for a group. */
export const encounterTitle = (foe: string, count: number, boss = false): string =>
  `${cap(foe)}${!boss && count > 1 ? " and its pack" : ""}`;

/** The end-of-fight line, in the engine's words: "Orc raider falls." (its `enemy_slain`), or "Orc raider still stands." */
export const encounterSummary = (enc: Pick<Encounter, "foe">, won: boolean): string =>
  `${cap(enc.foe)} ${won ? "falls" : "still stands"}.`;

/** Who you meet on the path for this request. Pure; seeded by `request.seed`. */
export function encounterFor(request: ForestRequest, opts: EncounterOptions = {}): Encounter {
  const inp = sanitizeInput(request);
  const progress = progressOf(request);
  const { act, acts } = actOf(request);
  const total = inp.enemy.hp;
  const scale = { speed: scaleAt("speed", progress), attackCd: scaleAt("attackCd", progress), hitstun: scaleAt("hitstun", progress), stunTaken: scaleAt("stunTaken", progress) };
  const forcedBoss = opts.force !== undefined && ENEMIES[opts.force].boss;
  const boss = forcedBoss || (inp.enemy.boss && (opts.force === undefined));
  let ids: EnemyId[];
  let band = -1;
  let lead: EnemyId | null = null;
  if (boss) ids = [forcedBoss ? opts.force! : bossFor(act, acts)];
  else {
    band = bandAt(progress);
    const B = ENCOUNTER_BANDS[band];
    const rng = mulberry32(hashSeed(`encounter:${inp.seed}`));
    const count = B.count[0] + Math.floor(rng() * (B.count[1] - B.count[0] + 1));
    const n = Math.max(1, Math.min(count, total));
    const pool = Object.entries(B.mix) as [EnemyId, number][];
    const W = pool.reduce((a, [, w]) => a + w, 0);
    ids = [B.lead];
    lead = B.lead;
    for (let i = 1; i < n; i++) {
      let r = rng() * W;
      let pick = pool[pool.length - 1][0];
      for (const [id, w] of pool) { if (r < w) { pick = id; break; } r -= w; }
      ids.push(pick);
    }
    if (opts.force) { ids = ids.map(() => opts.force!); lead = opts.force; }
    ids = ids.map((id, i) => ({ id, i })).sort((a, b) => RANK[a.id] - RANK[b.id] || a.i - b.i).map((x) => x.id);
  }
  const weights = ids.map((id) => ENEMIES[id].hpShare);
  const hps = splitHp(total, weights);
  const maxes = splitHp(inp.enemy.maxHp, weights);
  const leadAt = lead === null ? -1 : ids.indexOf(lead); // after the sort: the first of the lead's kind
  const enemies = ids.map((id, i): EncounterEnemy => ({
    id, name: ENEMIES[id].boss && inp.enemy.boss && !opts.force ? inp.enemy.name : i === leadAt ? cap(inp.enemy.name) : ENEMIES[id].label, boss: ENEMIES[id].boss,
    hp: hps[i], maxHp: Math.max(hps[i], maxes[i], 1), power: enemyPower(id, inp.enemy.power), params: scaledParams(id, progress),
  }));
  const foe = inp.enemy.name;
  return { foe, title: encounterTitle(foe, enemies.length, boss), progress, band, act, acts, boss, enemies, totalHp: total, scale };
}
