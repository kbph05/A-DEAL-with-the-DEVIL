/**
 * Pure fight rules: damage, timers, the enemy state machine, geometry and screen layout. No Phaser, no DOM, no
 * clock: everything takes explicit numbers (times in ms), so `npm test` covers it in node. `sim.ts` builds the
 * world step on top of this; `FightScene.ts` only reads input and draws.
 */
import type { Rng } from "../map/rng";

// ---------------------------------------------------------------------------------------------------------------
// Public shapes

export interface FightPlayerInput { hp: number; maxHp: number; attack: number }
/** The engine's enemy (`GameState.enemy`), including its hidden `power`. */
export interface FightEnemyInput { name: string; hp: number; maxHp: number; power: number; boss: boolean }
export interface FightInput { player: FightPlayerInput; enemy: FightEnemyInput; seed?: string }
export interface FightResult {
  won: boolean;
  /** Player HP at the end (0 when lost). */
  hpLeft: number;
  /** Simulated fight time (fixed 60 Hz steps), so it is the same on fast and slow devices. */
  timeMs: number;
  /** Times the player took damage. */
  hitsTaken: number;
  /** Enemy HP actually removed (overkill not counted). */
  damageDealt: number;
  /** Enemy HP at the end (0 when won). Additive extra: lets the engine resume a fight after a soul revival. */
  enemyHpLeft: number;
}

export interface Vec { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

// ---------------------------------------------------------------------------------------------------------------
// Tuning (first guesses, like the engine's)

/** Fixed simulation step. */
export const STEP_MS = 1000 / 60;
/** The arena is a square room of this many units; the scene draws it 1:1. */
export const ARENA = 720;

export const PLAYER = {
  radius: 16,
  speed: 230, // units/s
  swingSpeedFactor: 0.6, // slower while swinging
  attackCdMs: 420,
  swingMs: 120,
  swingRange: 46, // beyond the player's edge
  swingHalfAngle: Math.PI / 3, // 120 degree arc
  dashMs: 160,
  dashSpeed: 640,
  dashCdMs: 800,
  dashInvulnMs: 220, // the dash plus a little grace
  hurtIframesMs: 800,
  hurtKnockback: 420, // units/s impulse
} as const;

/** Knockback decays as exp(-KNOCK_DECAY * t). */
export const KNOCK_DECAY = 9;

// ---------------------------------------------------------------------------------------------------------------
// Dice and damage (the engine's per-round formulas, docs/FEATURES.md 5.1)

/** Uniform 0, 1 or 2, like the engine's `roll(3)`. */
export const d3 = (rng: Rng): number => Math.floor(rng() * 3);
/** One sword swing: the engine's `attack + d3`. */
export const playerHitDamage = (attack: number, roll: number): number => Math.max(1, attack) + roll;
/** A landed lunge: the engine's per-round `power + d3`. */
export const lungeDamage = (power: number, roll: number): number => Math.max(1, power + roll);
/** Bumping into an enemy that is just walking: half its power, rounded up. */
export const contactDamage = (power: number): number => Math.max(1, Math.ceil(power / 2));
/** One boss burst bullet. */
export const burstDamage = (power: number): number => Math.max(1, power - 1);

// ---------------------------------------------------------------------------------------------------------------
// Timers: every cooldown / i-frame window is "ms left", ticked down and never below 0.

export const tick = (msLeft: number, dtMs: number): number => Math.max(0, msLeft - dtMs);
export const isReady = (msLeft: number): boolean => msLeft <= 0;
/** The player can be hurt only outside both the post-hit i-frames and the dash i-frames. */
export const canBeHit = (p: { iframesMs: number; dashInvulnMs: number }): boolean => p.iframesMs <= 0 && p.dashInvulnMs <= 0;

// ---------------------------------------------------------------------------------------------------------------
// Enemy stats and state machine

export type EnemyMode = "idle" | "chase" | "windup" | "lunge" | "recover" | "burstWindup";

export interface EnemyParams {
  radius: number;
  speed: number;
  aggroRange: number; // idle -> chase when the gap is under this...
  idleMaxMs: number; // ...or after this long anyway
  lungeRange: number; // chase -> windup when the gap is under this and the attack is ready
  windupMs: number;
  lungeMs: number;
  lungeSpeed: number;
  recoverMs: number;
  attackCdMs: number; // from lunge start
  knockTaken: number; // knockback impulse a sword hit gives it
  burstEveryMs: number; // 0 = no burst (regular enemies)
  burstWindupMs: number;
  burstCount: number;
  burstSpeed: number;
}

/** Which act (0-based) the enemy's power says it is from: regular power is 2 + act, boss power 3 + act. */
export const enemyTier = (power: number, boss: boolean): number => Math.min(2, Math.max(0, Math.round(power) - (boss ? 3 : 2)));

export function enemyParams(e: Pick<FightEnemyInput, "power" | "boss">): EnemyParams {
  const t = enemyTier(e.power, e.boss);
  if (e.boss) return {
    radius: 34, speed: 95 + 10 * t, aggroRange: 9999, idleMaxMs: 900,
    lungeRange: 150, windupMs: 600 - 50 * t, lungeMs: 280, lungeSpeed: 560, recoverMs: 550 - 50 * t, attackCdMs: 1300 - 150 * t,
    knockTaken: 0, // bosses don't budge
    burstEveryMs: 4600 - 500 * t, burstWindupMs: 900, burstCount: 10 + 4 * t, burstSpeed: 210 + 25 * t,
  };
  return {
    radius: 18, speed: 105 + 15 * t, aggroRange: 300, idleMaxMs: 1200,
    lungeRange: 120, windupMs: 480 - 40 * t, lungeMs: 240, lungeSpeed: 540, recoverMs: 600 - 100 * t, attackCdMs: 1100 - 100 * t,
    knockTaken: 170,
    burstEveryMs: 0, burstWindupMs: 0, burstCount: 0, burstSpeed: 0,
  };
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
 * idle -> chase -> windup (telegraph) -> lunge -> recover -> chase; bosses also chase -> burstWindup -> recover.
 * Returns the same mode when nothing changes.
 */
export function nextEnemyMode(b: EnemyBrain, gap: number, p: EnemyParams): EnemyMode {
  switch (b.mode) {
    case "idle": return gap <= p.aggroRange || b.modeMs >= p.idleMaxMs ? "chase" : "idle";
    case "chase":
      if (p.burstEveryMs > 0 && isReady(b.burstCdMs)) return "burstWindup";
      return gap <= p.lungeRange && isReady(b.attackCdMs) ? "windup" : "chase";
    case "windup": return b.modeMs >= p.windupMs ? "lunge" : "windup";
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
  if (next === "lunge") brain.attackCdMs = p.attackCdMs;
  if (t.mode === "burstWindup") brain.burstCdMs = p.burstEveryMs;
  return { brain, entered: next, left: t.mode };
}

// ---------------------------------------------------------------------------------------------------------------
// Vectors and geometry

export const ZERO: Vec = { x: 0, y: 0 };
export const len = (v: Vec): number => Math.hypot(v.x, v.y);
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export function norm(v: Vec): Vec {
  const l = len(v);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 };
}

/** Keyboard to an 8-way unit vector (opposite keys cancel; diagonals are normalized, so not faster). */
export function moveDir(k: { up: boolean; down: boolean; left: boolean; right: boolean }): Vec {
  return norm({ x: (k.right ? 1 : 0) - (k.left ? 1 : 0), y: (k.down ? 1 : 0) - (k.up ? 1 : 0) });
}

/** Joystick knob offset to an 8-way unit vector: zero inside the dead zone, else snapped to the nearest 45 degrees. */
export function stickDir(dx: number, dy: number, radius: number, deadZone = 0.25): Vec {
  if (Math.hypot(dx, dy) < radius * deadZone) return { x: 0, y: 0 };
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const r = (n: number) => (Math.abs(n) < 1e-9 ? 0 : n);
  return { x: r(Math.cos(a)), y: r(Math.sin(a)) };
}

/** Clamp a knob offset to the stick radius. */
export function clampStick(dx: number, dy: number, radius: number): Vec {
  const l = Math.hypot(dx, dy);
  return l <= radius ? { x: dx, y: dy } : { x: (dx / l) * radius, y: (dy / l) * radius };
}

/** Does a swing from `origin` facing `facing` (unit) reach a circle at `target`? */
export function inSwingArc(origin: Vec, facing: Vec, reach: number, halfAngle: number, target: Vec, targetRadius: number): boolean {
  const d = sub(target, origin);
  const l = len(d);
  if (l - targetRadius > reach) return false;
  if (l <= targetRadius) return true; // overlapping: always hit
  const cos = (d.x * facing.x + d.y * facing.y) / l;
  // Widen the arc by the target's angular size so a big boss is easy to clip with the edge of the swing.
  const widen = Math.asin(Math.min(1, targetRadius / l));
  return Math.acos(Math.max(-1, Math.min(1, cos))) <= halfAngle + widen;
}

/** Knockback impulse pushing `to` away from `from`. Straight down if they coincide. */
export function knockback(from: Vec, to: Vec, strength: number): Vec {
  const d = norm(sub(to, from));
  const dir = d.x === 0 && d.y === 0 ? { x: 0, y: 1 } : d;
  return { x: dir.x * strength, y: dir.y * strength };
}

/** Keep a circle inside the arena square. */
export function clampToArena(p: Vec, r: number, size = ARENA): Vec {
  return { x: Math.min(size - r, Math.max(r, p.x)), y: Math.min(size - r, Math.max(r, p.y)) };
}

/** Push a circle out of a rectangle; returns the corrected centre (unchanged if they don't overlap). */
export function pushOutOfRect(p: Vec, r: number, rect: Rect): Vec {
  const cx = Math.min(rect.x + rect.w, Math.max(rect.x, p.x));
  const cy = Math.min(rect.y + rect.h, Math.max(rect.y, p.y));
  const dx = p.x - cx;
  const dy = p.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return p;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return { x: cx + (dx / d) * r, y: cy + (dy / d) * r };
  }
  // Centre inside the rect: leave by the nearest side.
  const left = p.x - rect.x, right = rect.x + rect.w - p.x, top = p.y - rect.y, bottom = rect.y + rect.h - p.y;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { x: rect.x - r, y: p.y };
  if (m === right) return { x: rect.x + rect.w + r, y: p.y };
  if (m === top) return { x: p.x, y: rect.y - r };
  return { x: p.x, y: rect.y + rect.h + r };
}

export const circleHitsRect = (p: Vec, r: number, rect: Rect): boolean => pushOutOfRect(p, r, rect) !== p;

// ---------------------------------------------------------------------------------------------------------------
// Input sanitising (the engine clamps, so should we: junk in, a legal fight out)

const num = (v: unknown, dflt: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : dflt);

export function sanitizeInput(input: FightInput): Required<FightInput> {
  const pMax = Math.max(1, num(input?.player?.maxHp, 30));
  const eMax = Math.max(1, num(input?.enemy?.maxHp, 10));
  return {
    player: { maxHp: pMax, hp: Math.min(pMax, Math.max(0, num(input?.player?.hp, pMax))), attack: Math.max(1, num(input?.player?.attack, 3)) },
    enemy: {
      name: typeof input?.enemy?.name === "string" && input.enemy.name ? input.enemy.name : "enemy",
      maxHp: eMax,
      hp: Math.min(eMax, Math.max(0, num(input?.enemy?.hp, eMax))),
      power: Math.max(0, num(input?.enemy?.power, 2)),
      boss: input?.enemy?.boss === true,
    },
    seed: typeof input?.seed === "string" && input.seed ? input.seed : String(Date.now()),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Screen layout ("camera fit"): the logical game size and where the arena and touch controls go.

export interface Circle { x: number; y: number; r: number }
export interface FightLayout {
  width: number;
  height: number;
  portrait: boolean;
  /** Top-left of the arena on screen; the arena is drawn 1:1 (Scale.FIT then fits the whole canvas). */
  arena: Vec;
  stick: Circle;
  attackBtn: Circle;
  dashBtn: Circle;
}

const HUD_H = 72;

/** Pick a logical size with the parent's aspect (within limits) so FIT wastes little space, and place the controls. */
export function fightLayout(parentW: number, parentH: number): FightLayout {
  const aspect = parentW > 0 && parentH > 0 ? parentW / parentH : 16 / 10;
  if (aspect >= 1) {
    const height = HUD_H + ARENA + 28;
    const width = Math.round(Math.min(1640, Math.max(1160, height * aspect)));
    const m = (width - ARENA) / 2; // side margin: the touch controls live here
    const cy = height - 190;
    return {
      width, height, portrait: false, arena: { x: m, y: HUD_H },
      stick: { x: m / 2, y: cy, r: Math.min(100, m / 2 - 30) },
      attackBtn: { x: width - m / 2 + 20, y: cy + 40, r: 74 },
      dashBtn: { x: width - m / 2 - 70, y: cy - 120, r: 52 },
    };
  }
  const width = ARENA + 40;
  const height = Math.round(Math.min(1700, Math.max(1120, width / aspect)));
  const top = HUD_H + ARENA; // the controls live below the arena
  const cy = top + (height - top) / 2;
  return {
    width, height, portrait: true, arena: { x: 20, y: HUD_H },
    stick: { x: 200, y: cy + 10, r: 115 },
    attackBtn: { x: width - 170, y: cy + 50, r: 88 },
    dashBtn: { x: width - 330, y: cy - 90, r: 58 },
  };
}
