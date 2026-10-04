/**
 * Pure fight rules: damage, timers, the enemy state machine, geometry and screen layout. No Phaser, no DOM, no
 * clock: everything takes explicit numbers (times in ms), so `npm test` covers it in node. `sim.ts` builds the
 * world step on top of this; `FightScene.ts` only reads input and draws.
 */
import type { Rng } from "../map/rng";
import { norm, type Vec } from "../input/dir";

// Movement input moved to src/input/dir.ts (shared with the world scene); re-exported so existing imports keep working.
export { ZERO, clampStick, moveDir, norm, stickDir, type Vec } from "../input/dir";

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
export { arrowDamage } from "./enemies";

// ---------------------------------------------------------------------------------------------------------------
// Timers: every cooldown / i-frame window is "ms left", ticked down and never below 0 (timers.ts).

export { isReady, tick } from "./timers";
/** The player can be hurt only outside both the post-hit i-frames and the dash i-frames. */
export const canBeHit = (p: { iframesMs: number; dashInvulnMs: number }): boolean => p.iframesMs <= 0 && p.dashInvulnMs <= 0;

// ---------------------------------------------------------------------------------------------------------------
// Enemy stats and the state machine moved to enemies.ts (the roster: slime, demon, skeleton archer, bosses);
// re-exported so existing imports keep working.
export {
  enemyParams, enemyTier, newBrain, nextEnemyMode, tickBrain,
  type BrainStep, type EnemyBrain, type EnemyMode, type EnemyParams,
} from "./enemies";

// ---------------------------------------------------------------------------------------------------------------
// Vectors and geometry

export const len = (v: Vec): number => Math.hypot(v.x, v.y);
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

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

/**
 * Keep a circle inside a rectangle (the forest path's bounds; the arena is the rect 0, 0, ARENA, ARENA, where this
 * equals `clampToArena`). A rect narrower than the circle puts it on the rect's centre line on that axis.
 */
export function clampToRect(p: Vec, r: number, b: Rect): Vec {
  const axis = (v: number, lo: number, size: number) => (2 * r >= size ? lo + size / 2 : Math.min(lo + size - r, Math.max(lo + r, v)));
  return { x: axis(p.x, b.x, b.w), y: axis(p.y, b.y, b.h) };
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

/**
 * The layout for a parent box that changed size (a phone turned, a window resized), or null when the current one still
 * fits (same orientation, logical size within 2%: Scale.FIT absorbs that), so the caller only rebuilds when something
 * moved.
 */
export function relayout(current: FightLayout, parentW: number, parentH: number): FightLayout | null {
  if (!(parentW > 0 && parentH > 0)) return null; // hidden or collapsed: keep what we have
  const next = fightLayout(parentW, parentH);
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.02 * b;
  return next.portrait === current.portrait && near(next.width, current.width) && near(next.height, current.height) ? null : next;
}
