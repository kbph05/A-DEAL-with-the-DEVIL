/**
 * The fight world, stepped at a fixed rate: player, enemies, projectiles (boss bullets, arrows), collisions, damage
 * and the result. Pure TypeScript (no Phaser, DOM or clock): the same seed and the same control sequence give the
 * same fight, so tests can play whole fights in node.
 *
 * Two shapes of world, one set of rules:
 * - the arena (no `SimWorld`): the 720×720 room with one enemy and a pillar layout, as it always was;
 * - a `SimWorld` (the forest path, forest.ts): any bounds rect, several enemies placed along the path, idle until
 *   you come within their aggro range.
 * `FightScene` (arena) and `ForestScene` (forest) feed it controls and draw its state.
 */
import { hashSeed, mulberry32, type Rng } from "../map/rng";
import {
  ARENA, KNOCK_DECAY, PLAYER, STEP_MS, burstDamage, canBeHit, clampToRect, contactDamage, d3, dist,
  inSwingArc, isReady, knockback, lungeDamage, norm, playerHitDamage, pushOutOfRect, sanitizeInput, sub,
  tick, circleHitsRect,
  type FightInput, type FightResult, type Rect, type Vec,
} from "./logic";
import { arrowDamage, enemyParams, enemyTier, newBrain, tickBrain, type EnemyBrain, type EnemyId, type EnemyParams } from "./enemies";

/** What the player wants this step. `aim` (sim coordinates) turns the swing toward a point (mouse click). */
export interface FightControls { move: Vec; attack: boolean; dash: boolean; aim: Vec | null }
export const NO_CONTROLS: FightControls = { move: { x: 0, y: 0 }, attack: false, dash: false, aim: null };

export interface PlayerBody {
  pos: Vec; knock: Vec; facing: Vec; radius: number;
  hp: number; maxHp: number; attack: number;
  attackCdMs: number; swingMs: number; swingDir: Vec;
  dashMs: number; dashCdMs: number; dashDir: Vec; dashInvulnMs: number;
  iframesMs: number;
  /** Hitstun left: no moving, swinging or dashing (forest enemies inflict it; 0 in the arena). */
  stunMs: number;
}
export interface EnemyBody {
  kind: EnemyId;
  name: string; boss: boolean; power: number;
  pos: Vec; knock: Vec; radius: number;
  hp: number; maxHp: number;
  brain: EnemyBrain; params: EnemyParams;
  aim: Vec; // locked lunge / shot direction
  lungeLanded: boolean;
  hurtMs: number; // flash after being hit
  /** Stunned by a sword hit: brain and feet frozen (0 in the arena). */
  stunMs: number;
  /** Chase steering: which way it is sliding around an obstacle (0: straight). */
  detour: number;
  /** Sim time it dropped at, or null while it stands. */
  diedAtMs: number | null;
}
export interface Bullet { pos: Vec; vel: Vec; radius: number; damage: number; kind: "burst" | "arrow"; stunMs: number }
/** One-step notifications for the renderer (sounds, flashes). */
export type FightFx = "swing" | "hit" | "kill" | "hurt" | "dash" | "windup" | "lunge" | "shoot" | "burstWindup" | "burst" | "won" | "lost";

/** One enemy of a `SimWorld`, already placed and scaled (encounters.ts and forest.ts make these). */
export interface SimEnemySpawn { kind: EnemyId; name: string; boss: boolean; pos: Vec; hp: number; maxHp: number; power: number; params: EnemyParams }

/** A fight world other than the arena: the forest path. Sim units (forest.ts converts from scene pixels). */
export interface SimWorld {
  bounds: Rect;
  obstacles?: Rect[];
  playerSpawn: Vec;
  enemies: SimEnemySpawn[];
  /** The player's feet in this rect wake every enemy still idle (the exit: you can't slip past them). */
  alarm?: Rect;
  /** An enemy that wakes also wakes the idle ones within this range of it, units. Default PACK_RANGE. */
  packRange?: number;
}

/** Forest mode: an enemy that wakes wakes its idle neighbours within this many units (centre to centre). */
export const PACK_RANGE = 240;

const LAYOUTS: Rect[][] = [
  [],
  [{ x: 170, y: 330, w: 56, h: 56 }, { x: 494, y: 330, w: 56, h: 56 }],
  [{ x: 150, y: 200, w: 48, h: 48 }, { x: 522, y: 200, w: 48, h: 48 }, { x: 150, y: 472, w: 48, h: 48 }, { x: 522, y: 472, w: 48, h: 48 }],
  [{ x: 300, y: 344, w: 120, h: 32 }],
];
const PLAYER_SPAWN: Vec = { x: ARENA / 2, y: ARENA - 110 };
const ENEMY_SPAWN: Vec = { x: ARENA / 2, y: 130 };
/** The arena boss's roster id by act (cosmetic: the arena keeps its own numbers). */
const BOSS_KINDS: readonly EnemyId[] = ["miniboss1", "miniboss2", "final_boss"];

export class FightSim {
  readonly seed: string;
  readonly obstacles: Rect[];
  /** The rect everyone is kept inside: the arena's room, or the forest path's bounds (sim units). */
  readonly bounds: Rect;
  /** True for a `SimWorld` (forest) fight: aggro by range, waking on hit, the alarm and pack waking. */
  readonly forest: boolean;
  readonly alarm: Rect | null;
  readonly player: PlayerBody;
  readonly enemies: EnemyBody[];
  bullets: Bullet[] = [];
  timeMs = 0;
  steps = 0;
  hitsTaken = 0;
  damageDealt = 0;
  /** Fx raised by the last `step`. */
  fx: FightFx[] = [];
  private rng: Rng;
  private ended: FightResult | null = null;
  private packRange: number;

  constructor(input: FightInput, world?: SimWorld) {
    const inp = sanitizeInput(input);
    this.seed = inp.seed;
    this.rng = mulberry32(hashSeed(`fight:${inp.seed}`));
    this.forest = world !== undefined;
    this.packRange = world?.packRange ?? PACK_RANGE;
    let spawns: SimEnemySpawn[];
    let start: Vec;
    if (world) {
      this.bounds = { ...world.bounds };
      this.obstacles = (world.obstacles ?? []).map((r) => ({ ...r }));
      this.alarm = world.alarm ? { ...world.alarm } : null;
      start = world.playerSpawn;
      spawns = world.enemies;
    } else {
      const params = enemyParams(inp.enemy);
      // Bosses get an open room or the four pillars; regulars any layout.
      const pool = inp.enemy.boss ? [LAYOUTS[0], LAYOUTS[2]] : LAYOUTS;
      this.obstacles = pool[Math.floor(this.rng() * pool.length)].map((r) => ({ ...r }));
      this.bounds = { x: 0, y: 0, w: ARENA, h: ARENA };
      this.alarm = null;
      start = PLAYER_SPAWN;
      const kind: EnemyId = inp.enemy.boss ? BOSS_KINDS[enemyTier(inp.enemy.power, true)] : "slime";
      spawns = [{ kind, name: inp.enemy.name, boss: inp.enemy.boss, pos: ENEMY_SPAWN, hp: inp.enemy.hp, maxHp: inp.enemy.maxHp, power: inp.enemy.power, params }];
    }
    this.player = {
      pos: this.collide({ ...start }, PLAYER.radius), knock: { x: 0, y: 0 }, facing: { x: 0, y: -1 }, radius: PLAYER.radius,
      hp: inp.player.hp, maxHp: inp.player.maxHp, attack: inp.player.attack,
      attackCdMs: 0, swingMs: 0, swingDir: { x: 0, y: -1 },
      dashMs: 0, dashCdMs: 0, dashDir: { x: 0, y: -1 }, dashInvulnMs: 0, iframesMs: 0, stunMs: 0,
    };
    if (world) this.player.facing = this.player.swingDir = this.player.dashDir = { x: 1, y: 0 };
    this.enemies = spawns.map((s) => {
      const hp = Math.max(0, Math.round(s.hp));
      return {
        kind: s.kind, name: s.name, boss: s.boss, power: s.power,
        pos: this.collide({ ...s.pos }, s.params.radius), knock: { x: 0, y: 0 }, radius: s.params.radius,
        hp, maxHp: Math.max(hp, Math.round(s.maxHp), 1),
        brain: newBrain(s.params), params: s.params, aim: { x: 0, y: 1 }, lungeLanded: false, hurtMs: 0, stunMs: 0, detour: 0,
        diedAtMs: hp <= 0 ? 0 : null,
      };
    });
    if (this.player.hp <= 0) this.finish(false);
    else if (this.allDown) this.finish(true);
  }

  get result(): FightResult | null { return this.ended; }
  get over(): boolean { return this.ended !== null; }
  /** The first enemy: the arena's only one (kept for the arena scene, the lab and the tests). */
  get enemy(): EnemyBody { return this.enemies[0]; }
  /** Enemies still standing. */
  get alive(): EnemyBody[] { return this.enemies.filter((e) => e.hp > 0); }
  /** HP left across every enemy (the FightResult's `enemyHpLeft`). */
  get enemyHpLeft(): number { return this.enemies.reduce((n, e) => n + e.hp, 0); }
  private get allDown(): boolean { return this.enemies.every((e) => e.hp <= 0); }

  /** Advance one fixed step. */
  step(c: FightControls, dtMs: number = STEP_MS): void {
    this.fx = [];
    if (this.ended) return;
    this.steps++;
    this.timeMs += dtMs;
    const dt = dtMs / 1000;
    const p = this.player;

    // Timers.
    p.attackCdMs = tick(p.attackCdMs, dtMs);
    p.swingMs = tick(p.swingMs, dtMs);
    p.dashMs = tick(p.dashMs, dtMs);
    p.dashCdMs = tick(p.dashCdMs, dtMs);
    p.dashInvulnMs = tick(p.dashInvulnMs, dtMs);
    p.iframesMs = tick(p.iframesMs, dtMs);
    p.stunMs = tick(p.stunMs, dtMs);
    for (const e of this.enemies) { e.hurtMs = tick(e.hurtMs, dtMs); e.stunMs = tick(e.stunMs, dtMs); }

    // Hitstun: the controls do nothing (knockback still carries the player).
    const stunned = p.stunMs > 0;
    const move = stunned ? { x: 0, y: 0 } : norm(c.move);
    if (move.x !== 0 || move.y !== 0) p.facing = move;

    // Dash.
    if (!stunned && c.dash && isReady(p.dashCdMs) && p.dashMs <= 0) {
      p.dashDir = move.x !== 0 || move.y !== 0 ? move : p.facing;
      p.dashMs = PLAYER.dashMs;
      p.dashCdMs = PLAYER.dashCdMs;
      p.dashInvulnMs = PLAYER.dashInvulnMs;
      this.fx.push("dash");
    }

    // Attack (held = swing again as soon as the cooldown allows). Not mid-dash. One swing hits every enemy in the
    // arc, each with its own roll, in the enemies' order.
    if (!stunned && c.attack && isReady(p.attackCdMs) && p.dashMs <= 0) {
      if (c.aim) {
        const a = norm(sub(c.aim, p.pos));
        if (a.x !== 0 || a.y !== 0) p.facing = a;
      }
      p.swingDir = p.facing;
      p.swingMs = PLAYER.swingMs;
      p.attackCdMs = PLAYER.attackCdMs;
      this.fx.push("swing");
      for (const e of this.enemies) {
        if (e.hp <= 0 || !inSwingArc(p.pos, p.swingDir, p.radius + PLAYER.swingRange, PLAYER.swingHalfAngle, e.pos, e.radius)) continue;
        const dmg = Math.min(e.hp, playerHitDamage(p.attack, d3(this.rng)));
        e.hp -= dmg;
        this.damageDealt += dmg;
        e.hurtMs = 140;
        e.stunMs = Math.max(e.stunMs, e.params.stunTakenMs);
        const k = knockback(p.pos, e.pos, e.params.knockTaken);
        e.knock = { x: e.knock.x + k.x, y: e.knock.y + k.y };
        this.fx.push("hit");
        if (this.forest && e.brain.mode === "idle") this.wake(e);
        if (e.hp <= 0) { e.diedAtMs = this.timeMs; this.fx.push("kill"); }
      }
      if (this.allDown) { this.finish(true); return; }
    }

    // Player movement.
    const speed = p.dashMs > 0 ? PLAYER.dashSpeed : PLAYER.speed * (p.swingMs > 0 ? PLAYER.swingSpeedFactor : 1);
    const dir = p.dashMs > 0 ? p.dashDir : move;
    p.pos = this.collide({ x: p.pos.x + (dir.x * speed + p.knock.x) * dt, y: p.pos.y + (dir.y * speed + p.knock.y) * dt }, p.radius);
    p.knock = decay(p.knock, dt);

    // Enemy brains and movement.
    const woke: EnemyBody[] = [];
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (e.stunMs > 0) {
        // Stunned: frozen in place, except for the knockback.
        e.pos = this.collide({ x: e.pos.x + e.knock.x * dt, y: e.pos.y + e.knock.y * dt }, e.radius);
        e.knock = decay(e.knock, dt);
        continue;
      }
      const gap = dist(p.pos, e.pos) - p.radius - e.radius;
      const s = tickBrain(e.brain, dtMs, gap, e.params);
      e.brain = s.brain;
      if (s.left === "idle") woke.push(e);
      if (s.entered === "windup") { e.aim = norm(sub(p.pos, e.pos)); this.fx.push("windup"); }
      if (s.entered === "lunge") { e.lungeLanded = false; this.fx.push("lunge"); }
      if (s.entered === "burstWindup") this.fx.push("burstWindup");
      if (s.left === "burstWindup") this.fireBurst(e);
      if (s.left === "windup" && e.params.behaviour === "archer") this.shoot(e);
      // The lunge (or shot) direction tracks the player for the first half of the wind-up, then locks: the late
      // flash is the cue.
      if (e.brain.mode === "windup" && e.brain.modeMs < e.params.windupMs / 2) e.aim = norm(sub(p.pos, e.pos));

      let v: Vec = { x: 0, y: 0 };
      if (e.brain.mode === "chase") v = this.chaseVelocity(e, gap, dt);
      else if (e.brain.mode === "lunge") v = { x: e.aim.x * e.params.lungeSpeed, y: e.aim.y * e.params.lungeSpeed };
      e.pos = this.collide({ x: e.pos.x + (v.x + e.knock.x) * dt, y: e.pos.y + (v.y + e.knock.y) * dt }, e.radius);
      e.knock = decay(e.knock, dt);
    }

    // Forest: the alarm (the exit) wakes everyone left; a waking enemy wakes its pack.
    if (this.forest) {
      if (this.alarm && pointInRect(p.pos, this.alarm)) for (const e of this.enemies) if (e.hp > 0 && e.brain.mode === "idle") this.wake(e);
      while (woke.length > 0) {
        const w = woke.pop()!;
        for (const e of this.enemies) {
          if (e.hp > 0 && e.brain.mode === "idle" && dist(w.pos, e.pos) <= this.packRange) { this.wake(e); woke.push(e); }
        }
      }
      this.separate();
    }

    // Bodies don't overlap (the player gives way), except that a dash passes through. Then their hits.
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const touching = dist(p.pos, e.pos) < p.radius + e.radius + 1;
      if (touching && p.dashMs <= 0) {
        const away = norm(sub(p.pos, e.pos));
        const d = away.x === 0 && away.y === 0 ? { x: 0, y: 1 } : away;
        p.pos = this.collide({ x: e.pos.x + d.x * (p.radius + e.radius + 1), y: e.pos.y + d.y * (p.radius + e.radius + 1) }, p.radius);
      }
      if (touching && canBeHit(p) && e.stunMs <= 0) {
        if (e.brain.mode === "lunge" && !e.lungeLanded) {
          e.lungeLanded = true;
          this.hurt(lungeDamage(e.power, d3(this.rng)), e.pos, e.params.hitstunMs);
        } else if (e.brain.mode === "chase" && e.params.contact) this.hurt(contactDamage(e.power), e.pos, e.params.hitstunMs);
      }
      if (this.ended) return;
    }

    // Projectiles.
    const B = this.bounds;
    const keep: Bullet[] = [];
    for (const b of this.bullets) {
      b.pos = { x: b.pos.x + b.vel.x * dt, y: b.pos.y + b.vel.y * dt };
      const out = b.pos.x < B.x - b.radius || b.pos.y < B.y - b.radius || b.pos.x > B.x + B.w + b.radius || b.pos.y > B.y + B.h + b.radius;
      if (out || this.obstacles.some((r) => circleHitsRect(b.pos, b.radius, r))) continue;
      if (dist(b.pos, p.pos) < b.radius + p.radius && canBeHit(p)) {
        this.hurt(b.damage, sub(b.pos, b.vel), b.stunMs); // knocked along the bullet's path
        if (this.ended) return;
        continue;
      }
      keep.push(b);
    }
    this.bullets = keep;
  }

  /** Walking: lungers and bosses close in; archers hold their range, backing off when you get close. */
  private chaseVelocity(e: EnemyBody, gap: number, dt: number): Vec {
    const to = norm(sub(this.player.pos, e.pos));
    if (e.params.behaviour !== "archer") return this.steer(e, to, e.params.speed, dt);
    if (gap < e.params.keepAway) return this.steer(e, { x: -to.x, y: -to.y }, e.params.speed, dt);
    if (gap > e.params.lungeRange * 0.85) return this.steer(e, to, e.params.speed, dt);
    return { x: 0, y: 0 };
  }

  /**
   * Chase steering: walk straight at the target unless a pillar (or the edge of the bounds) blocks the way, then try
   * 45 and 90 degrees off, sticking to one side (`detour`) until the way is clear so the enemy slides around
   * instead of jittering.
   */
  private steer(e: EnemyBody, want: Vec, speed: number, dt: number): Vec {
    const step = speed * dt;
    const progress = (d: Vec) => {
      const q = this.collide({ x: e.pos.x + d.x * step, y: e.pos.y + d.y * step }, e.radius);
      return ((q.x - e.pos.x) * d.x + (q.y - e.pos.y) * d.y) / step;
    };
    if (progress(want) > 0.9) { e.detour = 0; return { x: want.x * speed, y: want.y * speed }; }
    const sides = e.detour !== 0 ? [e.detour, -e.detour] : [1, -1];
    for (const side of sides) for (const turn of [Math.PI / 4, Math.PI / 2]) {
      const c = Math.cos(turn * side), s = Math.sin(turn * side);
      const d = { x: want.x * c - want.y * s, y: want.x * s + want.y * c };
      if (progress(d) > 0.6) { e.detour = side; return { x: d.x * speed, y: d.y * speed }; }
    }
    return { x: want.x * speed, y: want.y * speed };
  }

  private wake(e: EnemyBody): void {
    e.brain = { ...e.brain, mode: "chase", modeMs: 0 };
  }

  /** Enemies don't stack: overlapping pairs are pushed apart evenly. */
  private separate(): void {
    const live = this.alive;
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      const min = a.radius + b.radius;
      const d = dist(a.pos, b.pos);
      if (d >= min) continue;
      const n = d > 1e-6 ? norm(sub(b.pos, a.pos)) : { x: 1, y: 0 };
      const push = (min - d) / 2;
      a.pos = this.collide({ x: a.pos.x - n.x * push, y: a.pos.y - n.y * push }, a.radius);
      b.pos = this.collide({ x: b.pos.x + n.x * push, y: b.pos.y + n.y * push }, b.radius);
    }
  }

  private shoot(e: EnemyBody): void {
    const d = e.aim;
    this.bullets.push({
      pos: { x: e.pos.x + d.x * (e.radius + 4), y: e.pos.y + d.y * (e.radius + 4) },
      vel: { x: d.x * e.params.shotSpeed, y: d.y * e.params.shotSpeed },
      radius: 5, damage: arrowDamage(e.power), kind: "arrow", stunMs: e.params.hitstunMs,
    });
    this.fx.push("shoot");
  }

  private fireBurst(e: EnemyBody): void {
    const n = e.params.burstCount;
    const offset = this.rng() * ((Math.PI * 2) / n);
    for (let i = 0; i < n; i++) {
      const a = offset + (i * Math.PI * 2) / n;
      const d = { x: Math.cos(a), y: Math.sin(a) };
      this.bullets.push({
        pos: { x: e.pos.x + d.x * e.radius, y: e.pos.y + d.y * e.radius },
        vel: { x: d.x * e.params.burstSpeed, y: d.y * e.params.burstSpeed },
        radius: 8, damage: burstDamage(e.power), kind: "burst", stunMs: e.params.hitstunMs,
      });
    }
    this.fx.push("burst");
  }

  private hurt(amount: number, from: Vec, stunMs = 0): void {
    const p = this.player;
    p.hp = Math.max(0, p.hp - amount);
    this.hitsTaken++;
    p.iframesMs = PLAYER.hurtIframesMs;
    // Hitstun stays well under the i-frames, so a crowd can't stun-lock you.
    p.stunMs = Math.max(p.stunMs, Math.min(stunMs, PLAYER.hurtIframesMs / 2));
    const k = knockback(from, p.pos, PLAYER.hurtKnockback);
    p.knock = { x: p.knock.x + k.x, y: p.knock.y + k.y };
    this.fx.push("hurt");
    if (p.hp <= 0) this.finish(false);
  }

  private collide(pos: Vec, r: number): Vec {
    let q = pos;
    for (const rect of this.obstacles) q = pushOutOfRect(q, r, rect);
    return clampToRect(q, r, this.bounds);
  }

  private finish(won: boolean): void {
    this.bullets = [];
    this.ended = {
      won, hpLeft: this.player.hp, timeMs: Math.round(this.timeMs), hitsTaken: this.hitsTaken,
      damageDealt: this.damageDealt, enemyHpLeft: this.enemyHpLeft,
    };
    this.fx.push(won ? "won" : "lost");
  }
}

const pointInRect = (p: Vec, r: Rect): boolean => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;

function decay(v: Vec, dt: number): Vec {
  const f = Math.exp(-KNOCK_DECAY * dt);
  const out = { x: v.x * f, y: v.y * f };
  return Math.hypot(out.x, out.y) < 1 ? { x: 0, y: 0 } : out;
}
