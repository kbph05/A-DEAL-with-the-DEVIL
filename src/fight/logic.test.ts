import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32 } from "../map/rng";
import {
  ARENA, FIGHT_SPRINT_MULT, FIGHT_WALK_SPEED, PLAYER, STEP_MS, burstDamage, canBeHit, clampStick, clampToArena, contactDamage, d3, dist, enemyParams, enemyTier,
  fightLayout, relayout, inSwingArc, isReady, knockback, lungeDamage, moveDir, newBrain, nextEnemyMode, norm, playerHitDamage,
  pushOutOfRect, sanitizeInput, stickDir, sub, tick, tickBrain, type EnemyBrain, type FightInput,
} from "./logic";
import { ENEMY_IDS } from "./enemies";
import { scaledParams } from "./encounters";
import { FightSim, NO_CONTROLS, type FightControls } from "./sim";

const ACT1: FightInput = { player: { hp: 30, maxHp: 30, attack: 3 }, enemy: { name: "cave rat", hp: 10, maxHp: 10, power: 2, boss: false }, seed: "t1" };
const BOSS3: FightInput = { player: { hp: 33, maxHp: 33, attack: 5 }, enemy: { name: "the Devil's Left Hand", hp: 34, maxHp: 34, power: 5, boss: true }, seed: "t3" };

/** A decent player: walk in, swing at the enemy, dash sideways out of a telegraphed lunge or a bullet. */
function bot(s: FightSim): FightControls {
  const p = s.player, e = s.enemy;
  const to = norm(sub(e.pos, p.pos));
  const gap = dist(p.pos, e.pos) - p.radius - e.radius;
  if ((e.brain.mode === "windup" && gap < 200) || s.bullets.some((b) => dist(b.pos, p.pos) < 60)) return { move: { x: -to.y, y: to.x }, attack: false, dash: true, aim: null };
  return { move: gap > 40 ? to : { x: 0, y: 0 }, attack: gap < 46, dash: false, aim: e.pos };
}
function play(input: FightInput, policy: (s: FightSim) => FightControls, maxMs = 120_000): FightSim {
  const s = new FightSim(input);
  while (!s.over && s.timeMs < maxMs) s.step(policy(s));
  return s;
}

test("damage follows the engine's per-round formulas", () => {
  const rng = mulberry32(7);
  const rolls = new Set(Array.from({ length: 300 }, () => d3(rng)));
  assert.deepEqual([...rolls].sort(), [0, 1, 2]);
  assert.equal(playerHitDamage(3, 0), 3);
  assert.equal(playerHitDamage(3, 2), 5);
  assert.equal(playerHitDamage(0, 0), 1, "attack is at least 1");
  assert.equal(lungeDamage(2, 0), 2);
  assert.equal(lungeDamage(5, 2), 7);
  assert.equal(contactDamage(2), 1);
  assert.equal(contactDamage(5), 3);
  assert.equal(burstDamage(1), 1);
  assert.equal(burstDamage(5), 4);
});

test("timers tick down to zero and gate hits", () => {
  assert.equal(tick(100, 30), 70);
  assert.equal(tick(10, 30), 0);
  assert.equal(isReady(0), true);
  assert.equal(isReady(1), false);
  assert.equal(canBeHit({ iframesMs: 0, dashInvulnMs: 0 }), true);
  assert.equal(canBeHit({ iframesMs: 5, dashInvulnMs: 0 }), false);
  assert.equal(canBeHit({ iframesMs: 0, dashInvulnMs: 5 }), false);
});

test("movement is 8-way and diagonals are not faster", () => {
  assert.deepEqual(moveDir({ up: false, down: false, left: false, right: true }), { x: 1, y: 0 });
  assert.deepEqual(moveDir({ up: true, down: true, left: false, right: false }), { x: 0, y: 0 }, "opposites cancel");
  const diag = moveDir({ up: true, down: false, left: true, right: false });
  assert.ok(Math.abs(Math.hypot(diag.x, diag.y) - 1) < 1e-9);
  assert.ok(diag.x < 0 && diag.y < 0);
  assert.deepEqual(stickDir(5, 5, 100), { x: 0, y: 0 }, "dead zone");
  assert.deepEqual(stickDir(80, 10, 100), { x: 1, y: 0 }, "snaps to the nearest 45 degrees");
  const d = stickDir(-60, 55, 100);
  assert.ok(Math.abs(d.x + Math.SQRT1_2) < 1e-9 && Math.abs(d.y - Math.SQRT1_2) < 1e-9);
  assert.deepEqual(clampStick(300, 400, 100), { x: 60, y: 80 });
});

test("enemy state machine: idle, chase, telegraph, lunge, recover", () => {
  const p = enemyParams({ power: 2, boss: false });
  const b = (mode: EnemyBrain["mode"], modeMs = 0, attackCdMs = 0): EnemyBrain => ({ mode, modeMs, attackCdMs, burstCdMs: 0 });
  assert.equal(nextEnemyMode(b("idle"), 1000, p), "idle");
  assert.equal(nextEnemyMode(b("idle"), p.aggroRange, p), "chase", "aggro range");
  assert.equal(nextEnemyMode(b("idle", p.idleMaxMs), 1000, p), "chase", "idle times out");
  assert.equal(nextEnemyMode(b("chase"), p.lungeRange + 1, p), "chase");
  assert.equal(nextEnemyMode(b("chase"), p.lungeRange, p), "windup");
  assert.equal(nextEnemyMode(b("chase", 0, 100), 0, p), "chase", "attack on cooldown");
  assert.equal(nextEnemyMode(b("windup", p.windupMs - 1), 0, p), "windup");
  assert.equal(nextEnemyMode(b("windup", p.windupMs), 0, p), "lunge");
  assert.equal(nextEnemyMode(b("lunge", p.lungeMs), 0, p), "recover");
  assert.equal(nextEnemyMode(b("recover", p.recoverMs), 0, p), "chase");
  assert.equal(p.burstEveryMs, 0, "regular enemies never burst");

  const s = tickBrain({ ...b("windup", p.windupMs - 10), attackCdMs: 0 }, 20, 0, p);
  assert.equal(s.entered, "lunge");
  assert.equal(s.left, "windup");
  assert.equal(s.brain.modeMs, 0);
  assert.equal(s.brain.attackCdMs, p.attackCdMs, "the attack cooldown starts with the lunge");
});

test("bosses are bigger and add a burst on a timer", () => {
  const reg = enemyParams({ power: 2, boss: false });
  const boss = enemyParams({ power: 3, boss: true });
  assert.ok(boss.radius > reg.radius);
  assert.ok(boss.burstEveryMs > 0 && boss.burstCount >= 8);
  assert.equal(enemyTier(2, false), 0);
  assert.equal(enemyTier(6, false), 2, "clamped to act 3");
  assert.equal(enemyTier(4, true), 1);
  assert.ok(enemyParams({ power: 5, boss: true }).burstEveryMs < boss.burstEveryMs, "later bosses burst more often");

  let brain = newBrain(boss);
  brain = { ...brain, mode: "chase" };
  let burst = false;
  for (let t = 0; t < boss.burstEveryMs + boss.burstWindupMs + 100 && !burst; t += STEP_MS) {
    const s = tickBrain(brain, STEP_MS, 9999, boss);
    brain = s.brain;
    if (s.left === "burstWindup") burst = true;
  }
  assert.ok(burst, "a boss fires its burst after burstEveryMs + burstWindupMs");
  assert.equal(brain.burstCdMs, boss.burstEveryMs, "and the burst clock restarts");
});

test("geometry: swing arc, knockback, walls and pillars", () => {
  const o = { x: 100, y: 100 };
  const up = { x: 0, y: -1 };
  assert.equal(inSwingArc(o, up, 60, Math.PI / 3, { x: 100, y: 50 }, 10), true, "in front");
  assert.equal(inSwingArc(o, up, 60, Math.PI / 3, { x: 100, y: 150 }, 10), false, "behind");
  assert.equal(inSwingArc(o, up, 60, Math.PI / 3, { x: 100, y: 20 }, 10), false, "out of reach");
  assert.equal(inSwingArc(o, up, 60, Math.PI / 3, { x: 150, y: 95 }, 10), false, "outside the arc");
  assert.equal(inSwingArc(o, up, 60, Math.PI / 3, { x: 150, y: 95 }, 40), true, "a big target is clipped by the arc's edge");
  const k = knockback({ x: 0, y: 0 }, { x: 3, y: 4 }, 100);
  assert.ok(Math.abs(k.x - 60) < 1e-9 && Math.abs(k.y - 80) < 1e-9);
  assert.deepEqual(clampToArena({ x: -50, y: ARENA + 50 }, 10), { x: 10, y: ARENA - 10 });
  const rect = { x: 0, y: 0, w: 100, h: 100 };
  assert.deepEqual(pushOutOfRect({ x: 50, y: 105 }, 10, rect), { x: 50, y: 110 });
  assert.deepEqual(pushOutOfRect({ x: 50, y: 95 }, 10, rect), { x: 50, y: 110 }, "centre inside: out by the nearest side");
  const far = { x: 200, y: 200 };
  assert.equal(pushOutOfRect(far, 10, rect), far);
});

test("input is sanitised: junk in, a legal fight out", () => {
  const s = sanitizeInput({ player: { hp: 99, maxHp: 30, attack: -4 }, enemy: { name: "", hp: Number.NaN, maxHp: 12, power: -1, boss: "yes" as unknown as boolean } });
  assert.deepEqual(s.player, { hp: 30, maxHp: 30, attack: 1 });
  assert.deepEqual(s.enemy, { name: "enemy", hp: 12, maxHp: 12, power: 0, boss: false });
  assert.ok(s.seed.length > 0);
  assert.deepEqual(new FightSim({ ...ACT1, player: { hp: 0, maxHp: 30, attack: 3 } }).result?.won, false);
  assert.deepEqual(new FightSim({ ...ACT1, enemy: { ...ACT1.enemy, hp: 0 } }).result?.won, true);
});

test("layout fits landscape and portrait screens, controls clear of each other", () => {
  for (const [w, h] of [[1280, 720], [1920, 1080], [390, 700], [390, 844], [800, 800]] as const) {
    const L = fightLayout(w, h);
    assert.equal(L.portrait, w < h);
    assert.ok(L.arena.x >= 0 && L.arena.x + ARENA <= L.width && L.arena.y + ARENA <= L.height, `arena fits ${w}x${h}`);
    const cs = [L.stick, L.attackBtn, L.dashBtn];
    for (const c of cs) assert.ok(c.x - c.r >= 0 && c.x + c.r <= L.width && c.y + c.r <= L.height, `control on screen ${w}x${h}`);
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) assert.ok(dist(cs[i], cs[j]) > cs[i].r + cs[j].r);
  }
});

test("relayout: a turned phone gets the other layout, a same-shaped box gets none", () => {
  const portrait = fightLayout(390, 700);
  assert.equal(relayout(portrait, 390, 700), null);
  assert.equal(relayout(portrait, 392, 704), null, "small jitter keeps the layout");
  const turned = relayout(portrait, 788, 320);
  assert.ok(turned && !turned.portrait, "portrait -> landscape");
  assert.deepEqual(turned, fightLayout(788, 320));
  const back = relayout(turned, 390, 700);
  assert.ok(back && back.portrait && back.width === portrait.width && back.height === portrait.height, "and back again");
  assert.equal(relayout(portrait, 0, 0), null, "a collapsed box changes nothing");
  assert.equal(relayout(portrait, 390, 0), null);
});

test("sim: a swing hits for attack + d3 and knocks the enemy back", () => {
  const s = new FightSim(ACT1);
  s.enemy.pos = { x: s.player.pos.x, y: s.player.pos.y - 40 };
  const before = s.enemy.pos.y;
  s.step({ ...NO_CONTROLS, attack: true });
  assert.ok(s.fx.includes("swing") && s.fx.includes("hit"));
  assert.ok(s.damageDealt >= 3 && s.damageDealt <= 5);
  assert.equal(s.enemy.hp, 10 - s.damageDealt);
  s.step(NO_CONTROLS);
  assert.ok(s.enemy.pos.y < before, "knocked away from the player");
  const dealt = s.damageDealt;
  s.step({ ...NO_CONTROLS, attack: true });
  assert.equal(s.damageDealt, dealt, "the swing is on cooldown");
});

test("sim: i-frames after a hit, dash i-frames, and the player moves", () => {
  const s = new FightSim(ACT1);
  const start = { ...s.player.pos };
  for (let i = 0; i < 30; i++) s.step({ ...NO_CONTROLS, move: { x: 1, y: 0 } });
  assert.ok(Math.abs(s.player.pos.x - start.x - PLAYER.speed * 0.5) < 2, "half a second of walking right");

  const h = new FightSim(ACT1);
  h.enemy.brain = { ...h.enemy.brain, mode: "chase", attackCdMs: 5000 }; // walking, not lunging
  h.enemy.pos = { x: h.player.pos.x, y: h.player.pos.y - 35 };
  h.step(NO_CONTROLS);
  assert.equal(h.hitsTaken, 1, "touching a chasing enemy hurts");
  assert.ok(h.player.iframesMs > 0);
  const hp = h.player.hp;
  for (let i = 0; i < 20 && h.player.iframesMs > 0; i++) { h.enemy.pos = { x: h.player.pos.x, y: h.player.pos.y - 35 }; h.step(NO_CONTROLS); }
  assert.equal(h.player.hp, hp, "no damage during i-frames");

  const d = new FightSim(ACT1);
  d.enemy.brain = { ...d.enemy.brain, mode: "chase", attackCdMs: 5000 };
  d.step({ ...NO_CONTROLS, dash: true, move: { x: 0, y: -1 } });
  assert.ok(d.fx.includes("dash") && d.player.dashInvulnMs > 0);
  d.enemy.pos = { x: d.player.pos.x, y: d.player.pos.y - 35 };
  d.step(NO_CONTROLS);
  assert.equal(d.hitsTaken, 0, "dashing through is safe");
});

test("sim: whole fights are deterministic for a seed and end with a FightResult", () => {
  const a = play(ACT1, bot);
  const b = play(ACT1, bot);
  assert.deepEqual(a.result, b.result);
  assert.equal(a.result?.won, true);
  assert.equal(a.result?.damageDealt, 10);
  assert.equal(a.result?.enemyHpLeft, 0);
  assert.equal(a.result?.hpLeft, a.player.hp);

  const idle = play(ACT1, () => NO_CONTROLS);
  assert.equal(idle.result?.won, false, "standing still loses");
  assert.equal(idle.result?.hpLeft, 0);
  assert.ok((idle.result?.hitsTaken ?? 0) > 3);
  assert.equal(idle.result?.damageDealt, 0);

  const boss = play(BOSS3, bot);
  assert.ok(boss.result, "the act-3 boss fight ends");
  assert.deepEqual(play(BOSS3, bot).result, boss.result);
  let sawBurst = false;
  const s = new FightSim(BOSS3);
  while (!s.over && s.timeMs < 20_000) { s.step(NO_CONTROLS); if (s.fx.includes("burst")) sawBurst = true; }
  assert.ok(sawBurst, "the boss uses its second pattern");
});

test("fight speed: base walk is not slow, sprint = base x multiplier, constant from the first step", () => {
  assert.ok(FIGHT_WALK_SPEED >= 260, "walking is at least 260 units/s");
  assert.equal(PLAYER.speed, FIGHT_WALK_SPEED);
  assert.equal(PLAYER.dashSpeed, FIGHT_WALK_SPEED * FIGHT_SPRINT_MULT);
  assert.ok(FIGHT_SPRINT_MULT > 1);
  // Every enemy's chase speed, even at the top of the progress curve, stays under the player's walk: not outrun, not trivial.
  for (const id of ENEMY_IDS) assert.ok(scaledParams(id, 1).speed < FIGHT_WALK_SPEED * 0.65, `${id} chases well under the player's walk`);
  const s = new FightSim(ACT1);
  const x0 = s.player.pos.x;
  s.step({ ...NO_CONTROLS, move: { x: 1, y: 0 } });
  assert.ok(Math.abs(s.player.pos.x - x0 - FIGHT_WALK_SPEED * (STEP_MS / 1000)) < 1e-6, "full walking speed in the first step");
});
