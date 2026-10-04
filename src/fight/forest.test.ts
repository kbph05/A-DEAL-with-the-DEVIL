import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeFightResult, type FightRequest } from "../game/fightResult";
import { sceneById } from "../world/scenes";
import { pointIn } from "../world/scene";
import { encounterFor, type ForestRequest } from "./encounters";
import { UNITS_PER_PX, VIEW_SHORT, VIEW_SHORT_PORTRAIT, footPx, forestLayout, forestWorld, orderedSpawns, packSizes, spawnSlots } from "./forest";
import { dist, norm, sub, type Vec } from "./logic";
import { FightSim, NO_CONTROLS, PACK_RANGE, type FightControls } from "./sim";

const forest = sceneById("forest")!;

function req(act: number, layer: number, seed: string, boss = false): ForestRequest & FightRequest {
  const a = act - 1;
  const hp = boss ? 18 + 8 * a : 10 + 4 * a;
  return {
    player: { hp: 30 + 3 * a, maxHp: 30 + 3 * a, attack: 3 + a },
    enemy: { name: boss ? "the Gatekeeper" : "cave rat", hp, maxHp: hp, power: (boss ? 3 : 2) + a, boss },
    seed, where: { act, acts: 3, layer, layers: 7, kind: boss ? "boss" : "fight" },
  };
}
const sim = (r: ForestRequest) => new FightSim(r, forestWorld(forest, encounterFor(r)));

/** A decent player: walk to the nearest enemy, swing at it, dash sideways out of a telegraph or an incoming shot. */
function bot(s: FightSim): FightControls {
  const p = s.player;
  const live = s.alive;
  if (live.length === 0) return NO_CONTROLS;
  const e = live.reduce((a, b) => (dist(a.pos, p.pos) <= dist(b.pos, p.pos) ? a : b));
  const to = norm(sub(e.pos, p.pos));
  const gap = dist(p.pos, e.pos) - p.radius - e.radius;
  const threat = live.some((x) => x.brain.mode === "windup" && dist(x.pos, p.pos) - x.radius - p.radius < 220) || s.bullets.some((b) => dist(b.pos, p.pos) < 70);
  if (threat) return { move: { x: -to.y || 1, y: to.x }, attack: false, dash: true, aim: null };
  return { move: gap > 30 ? to : { x: 0, y: 0 }, attack: gap < 46, dash: false, aim: e.pos };
}
function play(s: FightSim, policy: (s: FightSim) => FightControls, maxMs = 180_000): FightSim {
  while (!s.over && s.timeMs < maxMs) s.step(policy(s));
  return s;
}

test("the forest scene: a path with a canopy, an exit at the far end, enemy spawns along it", () => {
  assert.ok(forest.overlay, "a canopy overlay");
  const exit = forest.zones!.find((z) => z.kind === "exit")!;
  assert.ok(exit.x > forest.spawn.x + forest.bounds.w * 0.8, "the exit is at the far end");
  assert.ok(forest.spawns!.length >= 5);
  for (const sp of forest.spawns!) assert.ok(pointIn(sp, forest.bounds));
  assert.ok(forest.bounds.h <= 128, "the bounds keep you on or near the path");
});

test("forestWorld: scene pixels to fight units, enemies on the spawns nearest first, the exit as the alarm", () => {
  const K = UNITS_PER_PX;
  const enc = encounterFor(req(3, 6, "w"));
  const w = forestWorld(forest, enc);
  assert.deepEqual(w.bounds, { x: forest.bounds.x * K, y: forest.bounds.y * K, w: forest.bounds.w * K, h: forest.bounds.h * K });
  assert.deepEqual(w.playerSpawn, { x: forest.spawn.x * K, y: forest.spawn.y * K });
  assert.equal(w.enemies.length, enc.enemies.length);
  w.enemies.forEach((e, i) => {
    assert.equal(e.hp, enc.enemies[i].hp);
    assert.equal(e.kind, enc.enemies[i].id);
    assert.ok(pointIn(e.pos, w.bounds), "inside the path's bounds");
  });
  // Packs: the first member of each on a spawn point, the rest around it, within waking range of each other.
  const spawns = orderedSpawns(forest).map((p) => ({ x: p.x * K, y: p.y * K }));
  const sizes = packSizes(enc.enemies.length);
  assert.ok(enc.enemies.length >= 3 && sizes.length === 2, "a big group comes as two packs");
  let i = 0;
  for (const size of sizes) {
    const lead = w.enemies[i];
    assert.ok(spawns.some((sp) => sp.x === lead.pos.x && sp.y === lead.pos.y), "a pack stands on a spawn point");
    for (let k = 1; k < size; k++) assert.ok(dist(lead.pos, w.enemies[i + k].pos) <= PACK_RANGE, "packed close: they wake together");
    i += size;
  }
  assert.ok(w.enemies[sizes[0]].pos.x > w.enemies[0].pos.x, "the second pack is further along the path");
  assert.deepEqual(packSizes(1), [1]);
  assert.deepEqual(packSizes(2), [1, 1]);
  assert.deepEqual(packSizes(5), [3, 2]);
  const exit = forest.zones!.find((z) => z.kind === "exit")!;
  assert.deepEqual(w.alarm, { x: exit.x * K, y: exit.y * K, w: exit.w * K, h: exit.h * K });
  assert.deepEqual(spawnSlots(1, 6), [0]);
  assert.deepEqual(spawnSlots(3, 6), [0, 2, 4]);
  assert.deepEqual(spawnSlots(7, 6), [0, 1, 2, 3, 4, 5, 0]);
  assert.equal(footPx({ x: 30, y: 300 }, 18), 103);
});

test("layout: zoom fits the short side; touch controls on screen and clear of each other, landscape and portrait", () => {
  for (const [w, h] of [[1366, 768], [1366, 630], [390, 844], [390, 700], [844, 390], [320, 480], [1920, 1080], [800, 800]] as const) {
    const L = forestLayout(w, h);
    assert.equal(L.portrait, h > w);
    assert.ok(L.zoom >= 1 && L.zoom <= 4);
    const view = L.portrait ? VIEW_SHORT_PORTRAIT : VIEW_SHORT;
    assert.ok(L.zoom === 4 || L.zoom === 1 || Math.abs(Math.min(L.width, L.height) / L.zoom - view) < 1e-9, `${view} world px across the short side at ${w}x${h}`);
    const cs = [L.stick, L.attackBtn, L.dashBtn];
    for (const c of cs) assert.ok(c.x - c.r >= 0 && c.x + c.r <= L.width && c.y - c.r >= 0 && c.y + c.r <= L.height, `control on screen at ${w}x${h}`);
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) assert.ok(dist(cs[i], cs[j]) > cs[i].r + cs[j].r, `controls apart at ${w}x${h}`);
  }
});

test("forest fights end with a FightResult the engine accepts as is (sanitizeFightResult in range)", () => {
  let won = 0, lost = 0;
  const cases: [number, number, boolean][] = [[1, 0, false], [1, 5, false], [2, 3, false], [3, 0, false], [3, 6, false], [1, 6, true], [3, 6, true]];
  for (const [act, layer, boss] of cases) for (const seed of ["a", "b", "c", "d"]) {
    const r = req(act, layer, seed, boss);
    const s = play(sim(r), bot);
    const res = s.result!;
    assert.ok(res, `act ${act} layer ${layer} ${boss ? "boss" : ""} seed ${seed} ends`);
    assert.deepEqual(play(sim(r), bot).result, res, "deterministic");
    assert.equal(res.won, s.alive.length === 0, "won = all dead");
    assert.equal(res.enemyHpLeft, s.enemies.reduce((n, e) => n + e.hp, 0), "enemyHpLeft = the sum left");
    assert.equal(res.damageDealt, r.enemy.hp - res.enemyHpLeft);
    const out = sanitizeFightResult(res, r);
    assert.equal(out.outcome, res.won ? "won" : "lost");
    assert.equal(out.hpLeft, res.hpLeft, "nothing clamped");
    assert.equal(out.enemyHpLeft, res.enemyHpLeft);
    assert.equal(out.damageDealt, res.damageDealt);
    assert.equal(out.hitsTaken, res.hitsTaken);
    assert.equal(out.timeMs, res.timeMs);
    if (res.won) won++; else lost++;
  }
  assert.ok(won > 0, `the bot wins some (${won} won, ${lost} lost)`);

  // Walking the path without fighting back loses, and that result is in range too.
  const r = req(2, 3, "walk");
  const s = play(sim(r), () => ({ ...NO_CONTROLS, move: { x: 1, y: 0 } }));
  assert.equal(s.result?.won, false);
  assert.equal(s.result?.hpLeft, 0);
  assert.equal(sanitizeFightResult(s.result, r).outcome, "lost");
});

/** A careless player: walks at the nearest enemy swinging, never dodges. */
function masher(s: FightSim): FightControls {
  const live = s.alive;
  if (live.length === 0) return NO_CONTROLS;
  const e = live.reduce((a, b) => (dist(a.pos, s.player.pos) <= dist(b.pos, s.player.pos) ? a : b));
  return { move: norm(sub(e.pos, s.player.pos)), attack: true, dash: false, aim: e.pos };
}

test("forest difficulty: a careless player loses more HP higher up the run", () => {
  const lostAt = (act: number, layer: number) => {
    let total = 0;
    for (const seed of "abcdefghijklmnopqrst") {
      // Same player for every fight, so only the encounter differs.
      const r = { ...req(act, layer, seed), player: { hp: 40, maxHp: 40, attack: 4 } };
      total += 40 - play(sim(r), masher).player.hp;
    }
    return total / 20;
  };
  const [bottom, middle, top] = [lostAt(1, 0), lostAt(2, 3), lostAt(3, 6)];
  assert.ok(bottom < middle && middle < top, `HP lost: ${bottom} at the bottom, ${middle} in the middle, ${top} at the top`);
});

test("arrows and bullets stop at the path's bounds", () => {
  const r = req(3, 6, "arrows");
  const s = sim(r);
  for (const e of s.enemies) e.brain = { ...e.brain, mode: "chase" };
  const B = s.bounds;
  for (let i = 0; i < 1500 && !s.over; i++) {
    s.step(bot(s));
    for (const b of s.bullets) assert.ok(b.pos.x >= B.x - b.radius && b.pos.x <= B.x + B.w + b.radius && b.pos.y >= B.y - b.radius && b.pos.y <= B.y + B.h + b.radius);
  }
  const p: Vec = s.player.pos;
  assert.ok(pointIn(p, B));
});
