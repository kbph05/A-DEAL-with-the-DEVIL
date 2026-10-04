/**
 * The enemy roster (Big Chungus): orc, slime, demon, skeleton archer, miniboss 1, miniboss 2 and the final boss. Data plus
 * behaviour, pure (no Phaser): each enemy is an `EnemyDef` (id, label, HP share, damage, speed, size, behaviour and
 * the base values the encounter scaling multiplies), and every behaviour runs on the one state machine below
 * (`nextEnemyMode` / `tickBrain`), stepped by `FightSim`. Tested in node (enemies.test.ts, logic.test.ts).
 *
 * - orc: the slime's numbers and behaviour, drawn with the Orc sprite (src/render/sprites.ts). Since 4 Oct the only
 *   regular enemy in the encounter tables; the slime, demon and skeleton archer stay defined (the lab can force them).
 * - slime: the original fight enemy. Chases, telegraphs (swells, a lane on the floor), lunges, recovers. Touching it
 *   while it walks hurts a little.
 * - demon: stalks from further out, then a fast, long lunge after a clear telegraph, then a long recovery window
 *   (your opening). It only hurts with the lunge.
 * - skeleton_archer: keeps its distance (backs off when you get close), draws its bow (the telegraph: an aim line
 *   that follows you, then locks), and looses an arrow, a projectile that flies straight and can miss.
 * - miniboss1, miniboss2, final_boss: the original boss logic (lunges plus the radial bullet burst), at the act 1,
 *   2 and 3 boss numbers. TODO(Big Chungus): their own designs.
 */
import { isReady, tick } from "./timers";

// ---------------------------------------------------------------------------------------------------------------
// The state machine

export type EnemyMode = "idle" | "chase" | "windup" | "lunge" | "recover" | "burstWindup";

/** How an enemy moves and attacks. `lunger`: slime and demon; `archer`: shoots instead of lunging; `boss`: lunges and bursts. */
export type Behaviour = "lunger" | "archer" | "boss";

export interface EnemyParams {
  behaviour: Behaviour;
  radius: number;
  speed: number;
  aggroRange: number; // idle -> chase when the gap is under this...
  idleMaxMs: number; // ...or after this long anyway (Infinity: only the range wakes it)
  lungeRange: number; // chase -> windup when the gap is under this and the attack is ready (archers: firing range)
  windupMs: number;
  lungeMs: number;
  lungeSpeed: number;
  recoverMs: number;
  attackCdMs: number; // from lunge start (archers: from the shot)
  knockTaken: number; // knockback impulse a sword hit gives it
  burstEveryMs: number; // 0 = no burst (regular enemies)
  burstWindupMs: number;
  burstCount: number;
  burstSpeed: number;
  /** Walking into it while it chases hurts (`contactDamage`). */
  contact: boolean;
  /** Hitstun it inflicts: the player can't move, swing or dash for this long after its hit (0 in the arena). */
  hitstunMs: number;
  /** How long a sword hit stuns it (its brain and feet freeze; knockback still carries it). 0 in the arena. */
  stunTakenMs: number;
  /** Archers: back off (and don't draw) when the gap is under this. 0: never. */
  keepAway: number;
  /** Archers: arrow speed, units/s. */
  shotSpeed: number;
}

/** Which act (0-based) the enemy's power says it is from: regular power is 2 + act, boss power 3 + act. */
export const enemyTier = (power: number, boss: boolean): number => Math.min(2, Math.max(0, Math.round(power) - (boss ? 3 : 2)));

const NO_EXTRAS = { contact: true, hitstunMs: 0, stunTakenMs: 0, keepAway: 0, shotSpeed: 0 } as const;

/** The original regular enemy at tier `t` (0..2): the slime. */
export function slimeParams(t: number): EnemyParams {
  return {
    behaviour: "lunger", radius: 18, speed: 105 + 15 * t, aggroRange: 300, idleMaxMs: 1200,
    lungeRange: 120, windupMs: 480 - 40 * t, lungeMs: 240, lungeSpeed: 540, recoverMs: 600 - 100 * t, attackCdMs: 1100 - 100 * t,
    knockTaken: 170,
    burstEveryMs: 0, burstWindupMs: 0, burstCount: 0, burstSpeed: 0,
    ...NO_EXTRAS,
  };
}

/** The original boss at tier `t` (0..2): lunges plus the radial burst. */
export function bossParams(t: number): EnemyParams {
  return {
    behaviour: "boss", radius: 34, speed: 95 + 10 * t, aggroRange: 9999, idleMaxMs: 900,
    lungeRange: 150, windupMs: 600 - 50 * t, lungeMs: 280, lungeSpeed: 560, recoverMs: 550 - 50 * t, attackCdMs: 1300 - 150 * t,
    knockTaken: 0, // bosses don't budge
    burstEveryMs: 4600 - 500 * t, burstWindupMs: 900, burstCount: 10 + 4 * t, burstSpeed: 210 + 25 * t,
    ...NO_EXTRAS,
  };
}

/** The arena fight's single enemy: a slime, or a boss, at the tier its power says. Unchanged from before the roster. */
export function enemyParams(e: { power: number; boss: boolean }): EnemyParams {
  const t = enemyTier(e.power, e.boss);
  return e.boss ? bossParams(t) : slimeParams(t);
}

export interface EnemyBrain {
  mode: EnemyMode;
  modeMs: number; // time spent in the current mode
  attackCdMs: number;
  burstCdMs: number;
}

export const newBrain = (p: EnemyParams): EnemyBrain => ({ mode: "idle", modeMs: 0, attackCdMs: 0, burstCdMs: p.burstEveryMs });

/**
 * The transition rule, given the brain after its timers were ticked and the gap (edge to edge) to the player.
 * idle -> chase -> windup (telegraph) -> lunge -> recover -> chase; archers skip the lunge (windup -> recover, the
 * shot is fired as the windup ends); bosses also chase -> burstWindup -> recover. Returns the same mode when nothing
 * changes.
 */
export function nextEnemyMode(b: EnemyBrain, gap: number, p: EnemyParams): EnemyMode {
  switch (b.mode) {
    case "idle": return gap <= p.aggroRange || b.modeMs >= p.idleMaxMs ? "chase" : "idle";
    case "chase":
      if (p.burstEveryMs > 0 && isReady(b.burstCdMs)) return "burstWindup";
      if (gap < p.keepAway) return "chase"; // archers: too close to draw, back off first
      return gap <= p.lungeRange && isReady(b.attackCdMs) ? "windup" : "chase";
    case "windup": return b.modeMs >= p.windupMs ? (p.behaviour === "archer" ? "recover" : "lunge") : "windup";
    case "lunge": return b.modeMs >= p.lungeMs ? "recover" : "lunge";
    case "burstWindup": return b.modeMs >= p.burstWindupMs ? "recover" : "burstWindup";
    case "recover": return b.modeMs >= p.recoverMs ? "chase" : "recover";
  }
}

export interface BrainStep { brain: EnemyBrain; entered: EnemyMode | null; left: EnemyMode | null }

/** Tick the brain's timers by `dtMs`, then apply at most one transition. Pure. */
export function tickBrain(b: EnemyBrain, dtMs: number, gap: number, p: EnemyParams): BrainStep {
  const t: EnemyBrain = {
    mode: b.mode,
    modeMs: b.modeMs + dtMs,
    attackCdMs: tick(b.attackCdMs, dtMs),
    // The burst clock only runs while the boss is not already charging one.
    burstCdMs: b.mode === "burstWindup" ? b.burstCdMs : tick(b.burstCdMs, dtMs),
  };
  const next = nextEnemyMode(t, gap, p);
  if (next === t.mode) return { brain: t, entered: null, left: null };
  const brain: EnemyBrain = { ...t, mode: next, modeMs: 0 };
  // The attack cooldown starts as the attack does: the lunge, or the arrow (an archer's windup ending).
  if (next === "lunge" || (t.mode === "windup" && p.behaviour === "archer")) brain.attackCdMs = p.attackCdMs;
  if (t.mode === "burstWindup") brain.burstCdMs = p.burstEveryMs;
  return { brain, entered: next, left: t.mode };
}

// ---------------------------------------------------------------------------------------------------------------
// The roster

export const ENEMY_IDS = ["orc", "slime", "demon", "skeleton_archer", "miniboss1", "miniboss2", "final_boss"] as const;
export type EnemyId = (typeof ENEMY_IDS)[number];
export const isEnemyId = (v: unknown): v is EnemyId => (ENEMY_IDS as readonly unknown[]).includes(v);

export interface EnemyDef {
  id: EnemyId;
  label: string;
  boss: boolean;
  /** Weight when the engine's enemy HP is split across a group (encounters.ts). */
  hpShare: number;
  /** Its power is the engine enemy's `power` times this (rounded, at least 1). */
  damage: number;
  /** Walking speed (units/s) before the progress curve. */
  speed: number;
  /** Body radius (units). */
  size: number;
  behaviour: Behaviour;
  /** Base attack cooldown, hitstun inflicted and stun taken (ms), before the progress curve (encounters.ts SCALING). */
  attackCdMs: number;
  hitstunMs: number;
  stunTakenMs: number;
  /** Forest mode: it wakes when the player comes this close (gap, units). */
  aggroRange: number;
  /** Bosses: which act's boss numbers (0..2) it uses. */
  tier: number;
  /** The rest of its params, on top of `slimeParams(0)` (or `bossParams(tier)` for a boss). */
  extra: Partial<EnemyParams>;
}

/** Tunable. Speeds and ranges are fight units (the arena is 720 across; the player has radius 16 and walks 230/s). */
export const ENEMIES: Readonly<Record<EnemyId, EnemyDef>> = {
  // The orc (Big Chungus, 4 Oct: "disable any enemies we don't have sprites for"): the slime's numbers and behaviour
  // under the Tiny RPG pack's Orc sprite. It is the only regular enemy in the encounter tables now.
  orc: {
    id: "orc", label: "Orc", boss: false, hpShare: 1, damage: 0.75, speed: 105, size: 18, behaviour: "lunger",
    attackCdMs: 1100, hitstunMs: 140, stunTakenMs: 260, aggroRange: 230, tier: 0, extra: {},
  },
  slime: {
    id: "slime", label: "Slime", boss: false, hpShare: 1, damage: 0.75, speed: 105, size: 18, behaviour: "lunger",
    attackCdMs: 1100, hitstunMs: 140, stunTakenMs: 260, aggroRange: 230, tier: 0, extra: {},
  },
  demon: {
    id: "demon", label: "Demon", boss: false, hpShare: 1.5, damage: 1, speed: 125, size: 18, behaviour: "lunger",
    attackCdMs: 1500, hitstunMs: 220, stunTakenMs: 200, aggroRange: 260, tier: 0,
    extra: { lungeRange: 200, windupMs: 560, lungeMs: 260, lungeSpeed: 880, recoverMs: 950, knockTaken: 120, contact: false },
  },
  skeleton_archer: {
    id: "skeleton_archer", label: "Skeleton archer", boss: false, hpShare: 0.8, damage: 0.8, speed: 110, size: 16, behaviour: "archer",
    attackCdMs: 1700, hitstunMs: 160, stunTakenMs: 300, aggroRange: 380, tier: 0,
    extra: { lungeRange: 340, keepAway: 170, windupMs: 620, lungeMs: 0, lungeSpeed: 0, recoverMs: 320, knockTaken: 190, contact: false, shotSpeed: 380 },
  },
  miniboss1: {
    id: "miniboss1", label: "Miniboss 1", boss: true, hpShare: 1, damage: 1, speed: 95, size: 34, behaviour: "boss",
    attackCdMs: 1300, hitstunMs: 200, stunTakenMs: 0, aggroRange: 300, tier: 0, extra: {},
  },
  miniboss2: {
    id: "miniboss2", label: "Miniboss 2", boss: true, hpShare: 1, damage: 1, speed: 95, size: 34, behaviour: "boss",
    attackCdMs: 1300, hitstunMs: 220, stunTakenMs: 0, aggroRange: 300, tier: 1, extra: {},
  },
  final_boss: {
    id: "final_boss", label: "Final boss", boss: true, hpShare: 1, damage: 1, speed: 95, size: 34, behaviour: "boss",
    attackCdMs: 1300, hitstunMs: 240, stunTakenMs: 0, aggroRange: 300, tier: 2, extra: {},
  },
};

/**
 * An enemy's params before the progress curve: the original slime (tier 0) or boss (its own tier, so the boss
 * pattern keeps that act's burst), overridden by the def. Speed, attack cooldown and the stuns are the def's base
 * values; `encounters.ts` multiplies them by the progress curve (not on top of a tier: no double scaling).
 */
export function baseParams(id: EnemyId): EnemyParams {
  const d = ENEMIES[id];
  const base = d.boss ? bossParams(d.tier) : slimeParams(0);
  return {
    ...base, ...d.extra, behaviour: d.behaviour, radius: d.size, speed: d.speed, attackCdMs: d.attackCdMs,
    hitstunMs: d.hitstunMs, stunTakenMs: d.stunTakenMs, aggroRange: d.aggroRange, idleMaxMs: Number.POSITIVE_INFINITY,
  };
}

/** Its power from the engine enemy's: `power × damage`, rounded, at least 1. */
export const enemyPower = (id: EnemyId, enginePower: number): number => Math.max(1, Math.round(Math.max(0, enginePower) * ENEMIES[id].damage));

/** One arrow: the archer's power, at least 1. */
export const arrowDamage = (power: number): number => Math.max(1, power);
