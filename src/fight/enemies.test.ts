import { test } from "node:test";
import assert from "node:assert/strict";
import { ENEMIES, ENEMY_IDS, baseParams, enemyParams, slimeParams, bossParams, type EnemyId } from "./enemies";
import { scaledParams } from "./encounters";
import { PLAYER, STEP_MS, clampToArena, clampToRect, dist, type FightInput, type Vec } from "./logic";
import { FightSim, NO_CONTROLS, type SimWorld } from "./sim";

const INPUT: FightInput = { player: { hp: 30, maxHp: 30, attack: 3 }, enemy: { name: "x", hp: 10, maxHp: 10, power: 3, boss: false }, seed: "e1" };
const BOUNDS = { x: 0, y: 0, w: 3000, h: 400 };

/** A forest-style world: the player at (100, 200), these enemies (10 HP, power 3, params at `progress`). */
function world(foes: [EnemyId, Vec][], progress = 0.5, extra: Partial<SimWorld> = {}): SimWorld {
  return {
    bounds: BOUNDS, playerSpawn: { x: 100, y: 200 },
    enemies: foes.map(([kind, pos]) => ({ kind, name: kind, boss: ENEMIES[kind].boss, pos, hp: 10, maxHp: 10, power: 3, params: scaledParams(kind, progress) })),
    ...extra,
  };
}
const awake = (s: FightSim) => { for (const e of s.enemies) e.brain = { ...e.brain, mode: "chase", modeMs: 0 }; return s; };

test("roster: six enemies, each with id, label, HP share, damage, speed, size and a behaviour", () => {
  assert.deepEqual([...ENEMY_IDS], ["orc", "slime", "demon", "skeleton_archer", "miniboss1", "miniboss2", "final_boss"]);
  for (const id of ENEMY_IDS) {
    const d = ENEMIES[id];
    assert.equal(d.id, id);
    assert.ok(d.label && d.hpShare > 0 && d.damage > 0 && d.speed > 0 && d.size > 0, id);
    assert.ok(["lunger", "archer", "boss"].includes(d.behaviour), id);
    assert.equal(baseParams(id).idleMaxMs, Number.POSITIVE_INFINITY, "forest enemies only wake by range");
  }
  // The slime is the original enemy, moved here (not copied): the arena's regular enemy uses its numbers.
  assert.deepEqual(enemyParams({ power: 2, boss: false }), slimeParams(0));
  assert.deepEqual(enemyParams({ power: 5, boss: true }), bossParams(2));
  assert.equal(baseParams("slime").windupMs, slimeParams(0).windupMs);
  // Bosses use the original boss logic (lunges and the burst) at their act's numbers.
  for (const [id, t] of [["miniboss1", 0], ["miniboss2", 1], ["final_boss", 2]] as const) {
    const p = baseParams(id);
    assert.equal(p.behaviour, "boss");
    assert.equal(p.burstCount, bossParams(t).burstCount);
    assert.ok(p.burstEveryMs > 0);
  }
});

test("slime: chases the player", () => {
  const s = awake(new FightSim(INPUT, world([["slime", { x: 500, y: 200 }]])));
  const before = dist(s.player.pos, s.enemy.pos);
  for (let i = 0; i < 30; i++) s.step(NO_CONTROLS);
  const after = dist(s.player.pos, s.enemy.pos);
  assert.ok(before - after > s.enemy.params.speed * 0.45, `closed ${before - after} units in 0.5 s`);
  assert.equal(s.enemy.brain.mode, "chase");
});

test("demon: telegraphs (stands still in a wind-up) before a fast lunge, then a recovery window", () => {
  const s = awake(new FightSim(INPUT, world([["demon", { x: 300, y: 200 }]])));
  const p = s.enemy.params;
  let windupAt = -1, lungeAt = -1, recoverAt = -1;
  let posAtWindup: Vec | null = null;
  let maxSpeed = 0;
  for (let i = 0; i < 600 && recoverAt < 0; i++) {
    const was = { ...s.enemy.pos };
    s.step(NO_CONTROLS);
    if (s.fx.includes("windup")) { windupAt = s.timeMs; posAtWindup = { ...s.enemy.pos }; }
    if (s.fx.includes("lunge")) lungeAt = s.timeMs;
    if (windupAt >= 0 && lungeAt < 0) assert.deepEqual(s.enemy.pos, posAtWindup, "it holds still while winding up");
    if (lungeAt >= 0 && s.enemy.brain.mode === "lunge") maxSpeed = Math.max(maxSpeed, dist(was, s.enemy.pos) / (STEP_MS / 1000));
    if (lungeAt >= 0 && s.enemy.brain.mode === "recover") recoverAt = s.timeMs;
  }
  assert.ok(windupAt > 0 && lungeAt > windupAt, "a wind-up comes first");
  assert.ok(lungeAt - windupAt >= p.windupMs - STEP_MS, `the telegraph lasts ${lungeAt - windupAt} ms (≥ ${p.windupMs})`);
  assert.ok(maxSpeed > PLAYER.speed * 2, `the lunge is fast (${Math.round(maxSpeed)} units/s)`);
  assert.ok(p.recoverMs > slimeParams(0).recoverMs, "a longer recovery window than the slime's");
  assert.equal(p.contact, false, "walking into a demon doesn't hurt; only its lunge does");
});

test("skeleton archer: arrows fly straight, hit a player who stands still, miss one who steps aside", () => {
  // Stand still: hit.
  const a = awake(new FightSim(INPUT, world([["skeleton_archer", { x: 400, y: 200 }]])));
  let shotAt = -1;
  for (let i = 0; i < 600 && shotAt < 0; i++) { a.step(NO_CONTROLS); if (a.fx.includes("shoot")) shotAt = i; }
  assert.ok(shotAt >= 0, "it shoots");
  const arrow = a.bullets.find((b) => b.kind === "arrow")!;
  assert.ok(arrow, "the arrow is a sim object");
  const p0 = { ...arrow.pos };
  a.step(NO_CONTROLS);
  if (a.bullets.includes(arrow)) {
    const moved = dist(p0, arrow.pos);
    assert.ok(Math.abs(moved - a.enemy.params.shotSpeed * STEP_MS / 1000) < 1e-6, "it travels at the shot speed");
  }
  for (let i = 0; i < 120 && a.hitsTaken === 0; i++) a.step(NO_CONTROLS);
  assert.equal(a.hitsTaken, 1, "standing still, the arrow hits");
  assert.ok(a.player.hp < 30);

  // Step aside once the aim has locked: the arrow misses and leaves the bounds.
  const b = awake(new FightSim(INPUT, world([["skeleton_archer", { x: 400, y: 200 }]])));
  const locked = () => b.enemy.brain.mode === "windup" && b.enemy.brain.modeMs >= b.enemy.params.windupMs / 2;
  for (let i = 0; i < 600 && !locked(); i++) b.step(NO_CONTROLS);
  assert.ok(locked());
  let fired = false;
  for (let i = 0; i < 90; i++) { b.step({ ...NO_CONTROLS, move: { x: 0, y: 1 } }); if (b.fx.includes("shoot")) fired = true; }
  assert.ok(fired);
  for (let i = 0; i < 180 && b.bullets.length > 0; i++) b.step(NO_CONTROLS);
  assert.equal(b.hitsTaken, 0, "the arrow missed");
  assert.equal(b.bullets.length, 0, "and flew out of the bounds");
});

test("skeleton archer: keeps its distance", () => {
  const s = awake(new FightSim(INPUT, world([["skeleton_archer", { x: 260, y: 200 }]])));
  const x0 = s.enemy.pos.x;
  for (let i = 0; i < 20; i++) s.step(NO_CONTROLS);
  assert.ok(s.enemy.pos.x > x0, "too close: it backs off");
  assert.notEqual(s.enemy.brain.mode, "windup", "and doesn't draw that close");
  for (let i = 0; i < 120 && s.enemy.brain.mode !== "windup"; i++) s.step(NO_CONTROLS);
  const gap = dist(s.player.pos, s.enemy.pos) - s.player.radius - s.enemy.radius;
  assert.equal(s.enemy.brain.mode, "windup", "then draws from range");
  assert.ok(gap >= s.enemy.params.keepAway && gap <= s.enemy.params.lungeRange, `from a gap of ${Math.round(gap)}`);
});

test("stuns: a hit freezes an enemy for its stun time; its hits stun the player (forest only)", () => {
  const s = awake(new FightSim(INPUT, world([["slime", { x: 150, y: 200 }]])));
  s.step({ ...NO_CONTROLS, attack: true, aim: s.enemy.pos });
  assert.ok(s.fx.includes("hit"));
  assert.equal(s.enemy.stunMs, s.enemy.params.stunTakenMs);
  const ms = s.enemy.brain.modeMs;
  s.step(NO_CONTROLS);
  assert.equal(s.enemy.brain.modeMs, ms, "its brain is frozen while stunned");

  const h = awake(new FightSim(INPUT, world([["slime", { x: 135, y: 200 }]])));
  h.enemy.brain.attackCdMs = 9999; // walking, not lunging: contact damage
  h.step(NO_CONTROLS);
  assert.equal(h.hitsTaken, 1);
  assert.ok(h.player.stunMs > 0 && h.player.stunMs <= h.enemy.params.hitstunMs, "hitstun");
  assert.ok(h.player.stunMs < PLAYER.hurtIframesMs, "shorter than the i-frames: no stun-lock");
  const cd = h.player.attackCdMs;
  h.step({ ...NO_CONTROLS, attack: true, dash: true });
  assert.equal(h.player.attackCdMs, Math.max(0, cd - STEP_MS), "no swing while stunned");
  assert.equal(h.player.dashMs, 0, "no dash while stunned");

  // The arena has neither.
  const arena = new FightSim(INPUT);
  assert.equal(arena.enemy.params.stunTakenMs, 0);
  assert.equal(arena.enemy.params.hitstunMs, 0);
});

test("aggro: idle until the player comes within range; a waking enemy wakes its pack; the exit wakes the rest", () => {
  const far = new FightSim(INPUT, world([["slime", { x: 1000, y: 200 }]]));
  for (let i = 0; i < 600; i++) far.step(NO_CONTROLS);
  assert.equal(far.enemy.brain.mode, "idle", "10 s and still idle: no timeout in the forest");
  far.player.pos = { x: 1000 - baseParams("slime").aggroRange, y: 200 };
  far.step(NO_CONTROLS);
  assert.equal(far.enemy.brain.mode, "chase", "within aggro range");

  const pack = new FightSim(INPUT, world([["slime", { x: 400, y: 200 }], ["demon", { x: 600, y: 200 }], ["slime", { x: 2000, y: 200 }]]));
  pack.player.pos = { x: 400 - 150, y: 200 };
  pack.step(NO_CONTROLS);
  assert.deepEqual(pack.enemies.map((e) => e.brain.mode), ["chase", "chase", "idle"], "the near pair wake together; the far one sleeps");

  const alarm = new FightSim(INPUT, world([["slime", { x: 1000, y: 200 }], ["skeleton_archer", { x: 2000, y: 100 }]], 0.5, { alarm: { x: 2900, y: 0, w: 100, h: 400 } }));
  alarm.player.pos = { x: 2950, y: 380 };
  alarm.step(NO_CONTROLS);
  assert.ok(alarm.enemies.every((e) => e.brain.mode !== "idle"), "reaching the exit wakes everyone left");
});

test("bounds: everyone stays inside the rect, in the arena and on the path", () => {
  assert.deepEqual(clampToRect({ x: -50, y: 900 }, 10, { x: 100, y: 200, w: 300, h: 100 }), { x: 110, y: 290 });
  assert.deepEqual(clampToRect({ x: 50, y: 50 }, 10, { x: 0, y: 0, w: 15, h: 100 }), { x: 7.5, y: 50 }, "narrower than the body: centred");
  const arena = { x: 0, y: 0, w: 720, h: 720 };
  for (const p of [{ x: -5, y: 3 }, { x: 800, y: 400 }, { x: 360, y: 900 }]) assert.deepEqual(clampToRect(p, 16, arena), clampToArena(p, 16));

  const bounds = { x: 96, y: 552, w: 3648, h: 336 };
  const s = new FightSim(INPUT, {
    bounds, playerSpawn: { x: 0, y: 0 }, // outside: put back in
    enemies: (["slime", "demon", "skeleton_archer", "slime"] as const).map((kind, i) => ({ kind, name: kind, boss: false, pos: { x: 400 + 200 * i, y: i % 2 ? 9999 : -50 }, hp: 50, maxHp: 50, power: 2, params: scaledParams(kind, 1) })),
  });
  const inside = (p: Vec, r: number) => p.x - r >= bounds.x - 1e-9 && p.y - r >= bounds.y - 1e-9 && p.x + r <= bounds.x + bounds.w + 1e-9 && p.y + r <= bounds.y + bounds.h + 1e-9;
  awake(s);
  for (let i = 0; i < 1200 && !s.over; i++) {
    // Run around in circles, swinging and dashing, to push everyone against the edges.
    const a = i / 40;
    s.step({ move: { x: Math.cos(a), y: Math.sin(a) }, attack: i % 3 === 0, dash: i % 50 === 0, aim: null });
    assert.ok(inside(s.player.pos, s.player.radius), `player inside at step ${i}`);
    for (const e of s.alive) assert.ok(inside(e.pos, e.radius), `${e.kind} inside at step ${i}`);
  }
});
