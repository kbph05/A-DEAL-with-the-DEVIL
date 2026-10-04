import { test } from "node:test";
import assert from "node:assert/strict";
import { ENEMIES, ENEMY_IDS, type EnemyId } from "./enemies";
import { ENCOUNTER_BANDS, SCALING, bandAt, encounterFor, encounterSummary, encounterTitle, progressOf, scaleAt, scaledParams, splitHp, type ForestRequest } from "./encounters";
import { eventText } from "../ui/logic";
import { FOES } from "../game/gameState";

const SEEDS = Array.from({ length: 50 }, (_, i) => `seed-${i}`);

/** An engine request at act `act` (1..3), layer `layer` of `layers`, with the engine's own enemy numbers. */
function req(act: number, layer: number, opts: { seed?: string; boss?: boolean; hp?: number; maxHp?: number; layers?: number } = {}): ForestRequest {
  const a = act - 1;
  const boss = opts.boss === true;
  const hp = opts.hp ?? (boss ? 18 + 8 * a : 10 + 4 * a);
  return {
    player: { hp: 30, maxHp: 30, attack: 3 },
    enemy: { name: boss ? "the Gatekeeper" : "cave rat", hp, maxHp: opts.maxHp ?? hp, power: (boss ? 3 : 2) + a, boss },
    seed: opts.seed ?? "s",
    where: { act: act - 1, acts: 3, layer, layers: opts.layers ?? 7, kind: boss ? "boss" : "fight" }, // the engine's act is 0-based
  };
}
/** The request at a progress `p` (0..1), via act and a fine layer grid. */
function at(p: number, seed: string, hp = 40): ForestRequest {
  const act = Math.min(3, Math.floor(p * 3) + 1);
  const layers = 1000;
  return req(act, Math.round((p * 3 - (act - 1)) * layers), { seed, hp, layers });
}
const nonSlime = (ids: EnemyId[]) => ids.filter((id) => id !== "slime").length / ids.length;

test("progress is (act + layer / layers) / acts (0-based act, as the engine sends it), clamped; without `where` it comes from the enemy's power", () => {
  assert.equal(progressOf(req(1, 0)), 0);
  assert.ok(Math.abs(progressOf(req(2, 0)) - 1 / 3) < 1e-12, "act 2 starts a third of the way up");
  assert.ok(Math.abs(progressOf(req(3, 6)) - (2 + 6 / 7) / 3) < 1e-12);
  assert.equal(progressOf({ ...req(1, 0), where: { act: 9, acts: 3, layer: 9, layers: 7, kind: "fight" } }), 1);
  assert.ok(progressOf(req(2, 0)) > progressOf(req(1, 6)), "later acts start harder than the top of the act before");
  const legacy = (r: ForestRequest) => { const { where: _w, ...rest } = r; return rest; };
  assert.ok(Math.abs(progressOf(legacy(req(1, 0))) - 0.5 / 3) < 1e-12, "act 1 from power 2, mid-act");
  assert.ok(Math.abs(progressOf(legacy(req(3, 0))) - 2.5 / 3) < 1e-12, "act 3 from power 4");
  assert.ok(progressOf(legacy(req(2, 0, { boss: true }))) > progressOf(legacy(req(2, 0))), "a boss sits at the top of its act");
  assert.ok(encounterFor(legacy(req(2, 0))).enemies.length > 0, "an engine without `where` still gets an encounter");
});

test("the engine's numbers stay authoritative: HP adds up exactly, power scales from the engine's", () => {
  for (const seed of SEEDS.slice(0, 10)) for (const hp of [1, 2, 3, 5, 9, 10, 13, 26, 40, 61]) for (const p of [0, 0.2, 0.45, 0.65, 0.9, 1]) {
    const e = encounterFor(at(p, seed, hp));
    assert.equal(e.enemies.reduce((n, m) => n + m.hp, 0), hp, `sum at hp ${hp}, p ${p}`);
    assert.equal(e.totalHp, hp);
    assert.ok(e.enemies.every((m) => m.hp >= 1), "every enemy has at least 1 HP");
    assert.ok(e.enemies.length <= hp, "never more enemies than HP");
    assert.ok(e.enemies.every((m) => m.maxHp >= m.hp));
  }
  // After a revival the enemy is below its max: split what is left.
  const hurt = encounterFor(req(2, 3, { hp: 7, maxHp: 15, seed: "r" }));
  assert.equal(hurt.enemies.reduce((n, m) => n + m.hp, 0), 7);
  assert.ok(hurt.enemies.some((m) => m.hp < m.maxHp));
  // Power: the engine's times the enemy's damage factor.
  const r = req(3, 6, { seed: "p" });
  for (const m of encounterFor(r).enemies) assert.equal(m.power, Math.max(1, Math.round(r.enemy.power * ENEMIES[m.id].damage)), m.id);
  assert.deepEqual(splitHp(10, [1, 1, 1]), [4, 3, 3]);
  assert.deepEqual(splitHp(2, [1, 1, 1]), [1, 1, 0], "not enough to go round (the encounter caps the count first)");
  assert.equal(splitHp(37, [1.5, 0.8, 1, 1]).reduce((a, b) => a + b, 0), 37);
});

test("deterministic per seed", () => {
  for (const p of [0, 0.3, 0.6, 0.95]) {
    assert.deepEqual(encounterFor(at(p, "same")), encounterFor(at(p, "same")));
  }
  const mixes = new Set(SEEDS.map((s) => encounterFor(at(0.9, s)).enemies.map((m) => m.id).join(",")));
  assert.ok(mixes.size > 3, "different seeds, different groups");
});

test("difficulty rises with progress: count, composition and every per-enemy stat (Big Chungus)", () => {
  const grid = Array.from({ length: 21 }, (_, i) => i / 20);
  // Count never drops for a given seed; the share of tougher enemies, averaged over 50 seeds, never drops.
  for (const seed of SEEDS) {
    const counts = grid.map((p) => encounterFor(at(p, seed)).enemies.length);
    for (let i = 1; i < counts.length; i++) assert.ok(counts[i] >= counts[i - 1], `count at seed ${seed}: ${counts}`);
  }
  const mean = (f: (p: number, s: string) => number) => grid.map((p) => SEEDS.reduce((a, s) => a + f(p, s), 0) / SEEDS.length);
  const tough = mean((p, s) => nonSlime(encounterFor(at(p, s)).enemies.map((m) => m.id)));
  for (let i = 1; i < tough.length; i++) assert.ok(tough[i] >= tough[i - 1] - 1e-9, `composition: ${tough.map((v) => v.toFixed(2))}`);
  const count = mean((p, s) => encounterFor(at(p, s)).enemies.length);
  assert.ok(count[grid.length - 1] > count[0] + 2, "many more enemies at the top");

  // The kbph table: the bottom of act 1 is 1 to 2 slimes; the middle mixes in demons; near the top, 3 to 5 with archers.
  for (const s of SEEDS) {
    const bottom = encounterFor(req(1, 0, { seed: s })).enemies.map((m) => m.id);
    assert.ok(bottom.length >= 1 && bottom.length <= 2 && bottom.every((id) => id === "slime"), `bottom: ${bottom}`);
    const top = encounterFor(req(3, 6, { seed: s, hp: 18 })).enemies.map((m) => m.id);
    assert.ok(top.length >= 3 && top.length <= 5 && top.includes("skeleton_archer"), `top: ${top}`);
    assert.ok(encounterFor(at(0.5, s)).enemies.some((m) => m.id === "demon"), "demons in the middle");
  }

  // Per enemy: faster, shorter cooldowns, more hitstun dealt, less stun taken, as progress rises.
  for (const id of ["slime", "demon", "skeleton_archer"] as const) {
    const ps = grid.map((p) => scaledParams(id, p));
    for (let i = 1; i < ps.length; i++) {
      assert.ok(ps[i].speed >= ps[i - 1].speed, `${id} speed`);
      assert.ok(ps[i].attackCdMs <= ps[i - 1].attackCdMs, `${id} attack cooldown`);
      assert.ok(ps[i].hitstunMs >= ps[i - 1].hitstunMs, `${id} hitstun dealt`);
      assert.ok(ps[i].stunTakenMs <= ps[i - 1].stunTakenMs, `${id} stun taken`);
    }
    const [lo, hi] = [ps[0], ps[ps.length - 1]];
    assert.ok(hi.speed > lo.speed && hi.attackCdMs < lo.attackCdMs && hi.hitstunMs > lo.hitstunMs && hi.stunTakenMs < lo.stunTakenMs, `${id} moves on every stat`);
  }
  for (const k of Object.keys(SCALING) as (keyof typeof SCALING)[]) assert.notEqual(scaleAt(k, 0), scaleAt(k, 1), k);
  // The bands are in order and cover everything.
  for (let i = 1; i < ENCOUNTER_BANDS.length; i++) {
    assert.ok(ENCOUNTER_BANDS[i].upTo > ENCOUNTER_BANDS[i - 1].upTo);
    assert.ok(ENCOUNTER_BANDS[i].count[0] >= ENCOUNTER_BANDS[i - 1].count[0] && ENCOUNTER_BANDS[i].count[1] >= ENCOUNTER_BANDS[i - 1].count[1]);
  }
  assert.equal(bandAt(0), 0);
  assert.equal(bandAt(1), ENCOUNTER_BANDS.length - 1);
});

test("bosses: miniboss 1 in act 1, miniboss 2 in act 2, the final boss in the last act, with the engine's HP and name", () => {
  for (const [act, id] of [[1, "miniboss1"], [2, "miniboss2"], [3, "final_boss"]] as const) {
    const e = encounterFor(req(act, 6, { boss: true }));
    assert.equal(e.boss, true);
    assert.deepEqual(e.enemies.map((m) => m.id), [id]);
    assert.equal(e.enemies[0].hp, 18 + 8 * (act - 1));
    assert.equal(e.enemies[0].name, "the Gatekeeper", "the engine's boss name");
    assert.equal(e.enemies[0].power, 3 + act - 1);
  }
});

test("lab override: every enemy one kind, or a single boss", () => {
  for (const id of ENEMY_IDS) {
    const e = encounterFor(req(2, 3, { seed: "f", hp: 20 }), { force: id });
    assert.ok(e.enemies.every((m) => m.id === id), id);
    assert.equal(e.enemies.reduce((n, m) => n + m.hp, 0), 20);
    if (ENEMIES[id].boss) assert.equal(e.enemies.length, 1);
  }
});

test("names: the engine's enemy is the encounter (title, the lead's label, the end line), the pack keeps roster labels", () => {
  assert.equal(encounterTitle("cave rat", 1), "Cave rat");
  assert.equal(encounterTitle("cave rat", 4), "Cave rat and its pack");
  assert.equal(encounterTitle("the unlit", 3), "The unlit and its pack");
  assert.equal(encounterTitle("the Gatekeeper", 1, true), "The Gatekeeper");
  for (const foe of FOES.flat()) for (const seed of SEEDS.slice(0, 10)) for (const act of [1, 2, 3]) for (const layer of [0, 3, 6]) {
    const r = req(act, layer, { seed, hp: 30 });
    const e = encounterFor({ ...r, enemy: { ...r.enemy, name: foe } });
    assert.equal(e.foe, foe);
    assert.equal(e.title, encounterTitle(foe, e.enemies.length));
    const named = e.enemies.filter((m) => m.name === foe.charAt(0).toUpperCase() + foe.slice(1));
    assert.equal(named.length, 1, `exactly one mob carries the engine's name (${foe}, ${seed})`);
    assert.equal(named[0].id, ENCOUNTER_BANDS[e.band].lead, "the band's lead");
    for (const m of e.enemies) if (m !== named[0]) assert.equal(m.name, ENEMIES[m.id].label, "the rest keep their roster labels");
    // The fight's end line agrees with the engine's own event, as the play page's toast words it.
    assert.ok(eventText({ type: "enemy_slain", name: foe, gold: 5, boss: false }).startsWith(encounterSummary(e, true)), foe);
  }
  const boss = encounterFor(req(2, 6, { boss: true }));
  assert.equal(boss.title, "The Gatekeeper");
  assert.equal(encounterSummary(boss, false), "The Gatekeeper still stands.");
});
