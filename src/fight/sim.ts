/**
 * The fight world, stepped at a fixed rate: player, enemy, boss bullets, collisions, damage and the result.
 * Pure TypeScript (no Phaser, DOM or clock): the same seed and the same control sequence give the same fight,
 * so tests can play whole fights in node. `FightScene` feeds it controls and draws its state.
 */
import { hashSeed, mulberry32, type Rng } from "../map/rng";
import {
  ARENA, KNOCK_DECAY, PLAYER, STEP_MS, burstDamage, canBeHit, clampToArena, contactDamage, d3, dist, enemyParams,
  inSwingArc, isReady, knockback, lungeDamage, newBrain, norm, playerHitDamage, pushOutOfRect, sanitizeInput, sub,
  tick, tickBrain, circleHitsRect,
  type EnemyBrain, type EnemyParams, type FightInput, type FightResult, type Rect, type Vec,
} from "./logic";

/** What the player wants this step. `aim` (arena coordinates) turns the swing toward a point (mouse click). */
export interface FightControls { move: Vec; attack: boolean; dash: boolean; aim: Vec | null }
export const NO_CONTROLS: FightControls = { move: { x: 0, y: 0 }, attack: false, dash: false, aim: null };

export interface PlayerBody {
  pos: Vec; knock: Vec; facing: Vec; radius: number;
  hp: number; maxHp: number; attack: number;
  attackCdMs: number; swingMs: number; swingDir: Vec;
  dashMs: number; dashCdMs: number; dashDir: Vec; dashInvulnMs: number;
  iframesMs: number;
}
export interface EnemyBody {
  name: string; boss: boolean; power: number;
  pos: Vec; knock: Vec; radius: number;
  hp: number; maxHp: number;
  brain: EnemyBrain; params: EnemyParams;
  aim: Vec; // locked lunge direction
  lungeLanded: boolean;
  hurtMs: number; // flash after being hit
}
export interface Bullet { pos: Vec; vel: Vec; radius: number; damage: number }
/** One-step notifications for the renderer (sounds, flashes). */
export type FightFx = "swing" | "hit" | "hurt" | "dash" | "windup" | "lunge" | "burstWindup" | "burst" | "won" | "lost";

const LAYOUTS: Rect[][] = [
  [],
  [{ x: 170, y: 330, w: 56, h: 56 }, { x: 494, y: 330, w: 56, h: 56 }],
  [{ x: 150, y: 200, w: 48, h: 48 }, { x: 522, y: 200, w: 48, h: 48 }, { x: 150, y: 472, w: 48, h: 48 }, { x: 522, y: 472, w: 48, h: 48 }],
  [{ x: 300, y: 344, w: 120, h: 32 }],
];
const PLAYER_SPAWN: Vec = { x: ARENA / 2, y: ARENA - 110 };
const ENEMY_SPAWN: Vec = { x: ARENA / 2, y: 130 };

export class FightSim {
  readonly seed: string;
  readonly obstacles: Rect[];
  readonly player: PlayerBody;
  readonly enemy: EnemyBody;
  bullets: Bullet[] = [];
  timeMs = 0;
  steps = 0;
  hitsTaken = 0;
  damageDealt = 0;
  /** Fx raised by the last `step`. */
  fx: FightFx[] = [];
  private rng: Rng;
  private ended: FightResult | null = null;
  private detour = 0;

  constructor(input: FightInput) {
    const inp = sanitizeInput(input);
    this.seed = inp.seed;
    this.rng = mulberry32(hashSeed(`fight:${inp.seed}`));
    const params = enemyParams(inp.enemy);
    // Bosses get an open room or the four pillars; regulars any layout.
    const pool = inp.enemy.boss ? [LAYOUTS[0], LAYOUTS[2]] : LAYOUTS;
    this.obstacles = pool[Math.floor(this.rng() * pool.length)].map((r) => ({ ...r }));
    this.player = {
      pos: { ...PLAYER_SPAWN }, knock: { x: 0, y: 0 }, facing: { x: 0, y: -1 }, radius: PLAYER.radius,
      hp: inp.player.hp, maxHp: inp.player.maxHp, attack: inp.player.attack,
      attackCdMs: 0, swingMs: 0, swingDir: { x: 0, y: -1 },
      dashMs: 0, dashCdMs: 0, dashDir: { x: 0, y: -1 }, dashInvulnMs: 0, iframesMs: 0,
    };
    this.enemy = {
      name: inp.enemy.name, boss: inp.enemy.boss, power: inp.enemy.power,
      pos: { ...ENEMY_SPAWN }, knock: { x: 0, y: 0 }, radius: params.radius,
      hp: inp.enemy.hp, maxHp: inp.enemy.maxHp,
      brain: newBrain(params), params, aim: { x: 0, y: 1 }, lungeLanded: false, hurtMs: 0,
    };
    if (this.player.hp <= 0) this.finish(false);
    else if (this.enemy.hp <= 0) this.finish(true);
  }

  get result(): FightResult | null { return this.ended; }
  get over(): boolean { return this.ended !== null; }

  /** Advance one fixed step. */
  step(c: FightControls, dtMs: number = STEP_MS): void {
    this.fx = [];
    if (this.ended) return;
    this.steps++;
    this.timeMs += dtMs;
    const dt = dtMs / 1000;
    const p = this.player;
    const e = this.enemy;

    // Player timers.
    p.attackCdMs = tick(p.attackCdMs, dtMs);
    p.swingMs = tick(p.swingMs, dtMs);
    p.dashMs = tick(p.dashMs, dtMs);
    p.dashCdMs = tick(p.dashCdMs, dtMs);
    p.dashInvulnMs = tick(p.dashInvulnMs, dtMs);
    p.iframesMs = tick(p.iframesMs, dtMs);
    e.hurtMs = tick(e.hurtMs, dtMs);

    const move = norm(c.move);
    if (move.x !== 0 || move.y !== 0) p.facing = move;

    // Dash.
    if (c.dash && isReady(p.dashCdMs) && p.dashMs <= 0) {
      p.dashDir = move.x !== 0 || move.y !== 0 ? move : p.facing;
      p.dashMs = PLAYER.dashMs;
      p.dashCdMs = PLAYER.dashCdMs;
      p.dashInvulnMs = PLAYER.dashInvulnMs;
      this.fx.push("dash");
    }

    // Attack (held = swing again as soon as the cooldown allows). Not mid-dash.
    if (c.attack && isReady(p.attackCdMs) && p.dashMs <= 0) {
      if (c.aim) {
        const a = norm(sub(c.aim, p.pos));
        if (a.x !== 0 || a.y !== 0) p.facing = a;
      }
      p.swingDir = p.facing;
      p.swingMs = PLAYER.swingMs;
      p.attackCdMs = PLAYER.attackCdMs;
      this.fx.push("swing");
      if (inSwingArc(p.pos, p.swingDir, p.radius + PLAYER.swingRange, PLAYER.swingHalfAngle, e.pos, e.radius)) {
        const dmg = Math.min(e.hp, playerHitDamage(p.attack, d3(this.rng)));
        e.hp -= dmg;
        this.damageDealt += dmg;
        e.hurtMs = 140;
        const k = knockback(p.pos, e.pos, e.params.knockTaken);
        e.knock = { x: e.knock.x + k.x, y: e.knock.y + k.y };
        this.fx.push("hit");
        if (e.hp <= 0) { this.finish(true); return; }
      }
    }

    // Player movement.
    const speed = p.dashMs > 0 ? PLAYER.dashSpeed : PLAYER.speed * (p.swingMs > 0 ? PLAYER.swingSpeedFactor : 1);
    const dir = p.dashMs > 0 ? p.dashDir : move;
    p.pos = this.collide({ x: p.pos.x + (dir.x * speed + p.knock.x) * dt, y: p.pos.y + (dir.y * speed + p.knock.y) * dt }, p.radius);
    p.knock = decay(p.knock, dt);

    // Enemy brain.
    const gap = dist(p.pos, e.pos) - p.radius - e.radius;
    const s = tickBrain(e.brain, dtMs, gap, e.params);
    e.brain = s.brain;
    if (s.entered === "windup") { e.aim = norm(sub(p.pos, e.pos)); this.fx.push("windup"); }
    if (s.entered === "lunge") { e.lungeLanded = false; this.fx.push("lunge"); }
    if (s.entered === "burstWindup") this.fx.push("burstWindup");
    if (s.left === "burstWindup") this.fireBurst();
    // The lunge direction tracks the player for the first half of the wind-up, then locks: the late flash is the cue.
    if (e.brain.mode === "windup" && e.brain.modeMs < e.params.windupMs / 2) e.aim = norm(sub(p.pos, e.pos));

    // Enemy movement.
    let v: Vec = { x: 0, y: 0 };
    if (e.brain.mode === "chase") v = this.steer(norm(sub(p.pos, e.pos)), e.params.speed, dt);
    else if (e.brain.mode === "lunge") v = { x: e.aim.x * e.params.lungeSpeed, y: e.aim.y * e.params.lungeSpeed };
    e.pos = this.collide({ x: e.pos.x + (v.x + e.knock.x) * dt, y: e.pos.y + (v.y + e.knock.y) * dt }, e.radius);
    e.knock = decay(e.knock, dt);

    // Bodies don't overlap (the player gives way), except that a dash passes through.
    const touching = dist(p.pos, e.pos) < p.radius + e.radius + 1;
    if (touching && p.dashMs <= 0) {
      const away = norm(sub(p.pos, e.pos));
      const d = away.x === 0 && away.y === 0 ? { x: 0, y: 1 } : away;
      p.pos = this.collide({ x: e.pos.x + d.x * (p.radius + e.radius + 1), y: e.pos.y + d.y * (p.radius + e.radius + 1) }, p.radius);
    }

    // Damage to the player.
    if (touching && canBeHit(p)) {
      if (e.brain.mode === "lunge" && !e.lungeLanded) {
        e.lungeLanded = true;
        this.hurt(lungeDamage(e.power, d3(this.rng)), e.pos);
      } else if (e.brain.mode === "chase") this.hurt(contactDamage(e.power), e.pos);
    }
    if (this.ended) return;

    // Bullets.
    const keep: Bullet[] = [];
    for (const b of this.bullets) {
      b.pos = { x: b.pos.x + b.vel.x * dt, y: b.pos.y + b.vel.y * dt };
      const out = b.pos.x < -b.radius || b.pos.y < -b.radius || b.pos.x > ARENA + b.radius || b.pos.y > ARENA + b.radius;
      if (out || this.obstacles.some((r) => circleHitsRect(b.pos, b.radius, r))) continue;
      if (dist(b.pos, p.pos) < b.radius + p.radius && canBeHit(p)) {
        this.hurt(b.damage, sub(b.pos, b.vel)); // knocked along the bullet's path
        if (this.ended) return;
        continue;
      }
      keep.push(b);
    }
    this.bullets = keep;
  }

  /**
   * Chase steering: walk straight at the player unless a pillar blocks the way, then try 45 and 90 degrees off,
   * sticking to one side (`detour`) until the way is clear so the enemy slides around instead of jittering.
   */
  private steer(want: Vec, speed: number, dt: number): Vec {
    const e = this.enemy;
    const step = speed * dt;
    const progress = (d: Vec) => {
      const q = this.collide({ x: e.pos.x + d.x * step, y: e.pos.y + d.y * step }, e.radius);
      return ((q.x - e.pos.x) * d.x + (q.y - e.pos.y) * d.y) / step;
    };
    if (progress(want) > 0.9) { this.detour = 0; return { x: want.x * speed, y: want.y * speed }; }
    const sides = this.detour !== 0 ? [this.detour, -this.detour] : [1, -1];
    for (const side of sides) for (const turn of [Math.PI / 4, Math.PI / 2]) {
      const c = Math.cos(turn * side), s = Math.sin(turn * side);
      const d = { x: want.x * c - want.y * s, y: want.x * s + want.y * c };
      if (progress(d) > 0.6) { this.detour = side; return { x: d.x * speed, y: d.y * speed }; }
    }
    return { x: want.x * speed, y: want.y * speed };
  }

  private fireBurst(): void {
    const e = this.enemy;
    const n = e.params.burstCount;
    const offset = this.rng() * ((Math.PI * 2) / n);
    for (let i = 0; i < n; i++) {
      const a = offset + (i * Math.PI * 2) / n;
      const d = { x: Math.cos(a), y: Math.sin(a) };
      this.bullets.push({
        pos: { x: e.pos.x + d.x * e.radius, y: e.pos.y + d.y * e.radius },
        vel: { x: d.x * e.params.burstSpeed, y: d.y * e.params.burstSpeed },
        radius: 8, damage: burstDamage(e.power),
      });
    }
    this.fx.push("burst");
  }

  private hurt(amount: number, from: Vec): void {
    const p = this.player;
    p.hp = Math.max(0, p.hp - amount);
    this.hitsTaken++;
    p.iframesMs = PLAYER.hurtIframesMs;
    const k = knockback(from, p.pos, PLAYER.hurtKnockback);
    p.knock = { x: p.knock.x + k.x, y: p.knock.y + k.y };
    this.fx.push("hurt");
    if (p.hp <= 0) this.finish(false);
  }

  private collide(pos: Vec, r: number): Vec {
    let q = pos;
    for (const rect of this.obstacles) q = pushOutOfRect(q, r, rect);
    return clampToArena(q, r);
  }

  private finish(won: boolean): void {
    this.bullets = [];
    this.ended = {
      won, hpLeft: this.player.hp, timeMs: Math.round(this.timeMs), hitsTaken: this.hitsTaken,
      damageDealt: this.damageDealt, enemyHpLeft: this.enemy.hp,
    };
    this.fx.push(won ? "won" : "lost");
  }
}

function decay(v: Vec, dt: number): Vec {
  const f = Math.exp(-KNOCK_DECAY * dt);
  const out = { x: v.x * f, y: v.y * f };
  return Math.hypot(out.x, out.y) < 1 ? { x: 0, y: 0 } : out;
}
