/**
 * The sword swing follows the player's facing (kbph, 4 Oct: "when player switches direction, the blade swings the other
 * way"): the hitbox (`swingArc`, which both scenes also draw) for each of the 8 facings, and real sims in the arena and
 * the forest hitting an enemy on the left only when facing left.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sceneById } from "../world/scenes";
import { encounterFor, type ForestRequest } from "./encounters";
import { forestWorld } from "./forest";
import { PLAYER, aimAtPointer, attackDir, hitBySwing, norm, swingArc, swingDrawOrigin, type FightInput, type Vec } from "./logic";
import { UNITS_PER_PX, playerFeetPx } from "./forest";
import { FightSim, NO_CONTROLS } from "./sim";

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test("swingArc: the hitbox sits on the facing side, for all 8 facings", () => {
  const o = { x: 100, y: 200 }, r = 12, reach = r + PLAYER.swingRange, s = Math.SQRT1_2;
  const facings: Array<[string, Vec, Vec]> = [
    ["right", { x: 1, y: 0 }, { x: 1, y: 0 }], ["left", { x: -1, y: 0 }, { x: -1, y: 0 }],
    ["up", { x: 0, y: -1 }, { x: 0, y: -1 }], ["down", { x: 0, y: 1 }, { x: 0, y: 1 }],
    ["up-right", { x: 1, y: -1 }, { x: s, y: -s }], ["up-left", { x: -1, y: -1 }, { x: -s, y: -s }],
    ["down-right", { x: 1, y: 1 }, { x: s, y: s }], ["down-left", { x: -1, y: 1 }, { x: -s, y: s }],
  ];
  for (const [name, dir, unit] of facings) {
    const a = swingArc(o, dir, r);
    assert.equal(a.reach, reach, name);
    assert.ok(near(a.tip.x, o.x + unit.x * reach) && near(a.tip.y, o.y + unit.y * reach), `${name}: tip ${JSON.stringify(a.tip)}`);
    assert.ok(near(a.to - a.from, 2 * PLAYER.swingHalfAngle), name);
    assert.ok(near(Math.cos(a.angle), unit.x) && near(Math.sin(a.angle), unit.y), name);
    // a small target just inside the tip is hit; the same target mirrored behind the player is not
    const front = { x: o.x + unit.x * (reach - 5), y: o.y + unit.y * (reach - 5) }, back = { x: o.x - unit.x * (reach - 5), y: o.y - unit.y * (reach - 5) };
    assert.equal(hitBySwing(a, front, 2), true, `${name}: in front`);
    assert.equal(hitBySwing(a, back, 2), false, `${name}: behind`);
  }
  assert.deepEqual(swingArc(o, { x: 0, y: 0 }, r).dir, { x: 1, y: 0 }, "no direction faces right");
});

test("aimAtPointer: only a mouse click aims; Space and the touch Attack button swing where the player faces", () => {
  assert.equal(aimAtPointer(true, false), true);
  assert.equal(aimAtPointer(false, false), false, "Space with the mouse resting somewhere");
  assert.equal(aimAtPointer(true, true), false, "touch: the Attack button uses the facing");
});

const ARENA_IN: FightInput = { player: { hp: 30, maxHp: 30, attack: 3 }, enemy: { name: "cave rat", hp: 10, maxHp: 10, power: 2, boss: false }, seed: "swing" };
const forestReq: ForestRequest = {
  player: { hp: 30, maxHp: 30, attack: 3 }, enemy: { name: "cave rat", hp: 10, maxHp: 10, power: 2, boss: false },
  seed: "swing", where: { act: 0, acts: 3, layer: 1, layers: 7, kind: "fight" },
};
const makers: Array<[string, () => FightSim]> = [
  ["arena", () => new FightSim(ARENA_IN)],
  ["forest", () => new FightSim(forestReq, forestWorld(sceneById("forest")!, encounterFor(forestReq)))],
];

/** A sim with every enemy but one out of the way, that one 30 units to the player's left, everyone frozen. */
function leftFoe(make: () => FightSim): { s: FightSim; hp: () => number } {
  const s = make(), [e, ...rest] = s.enemies;
  for (const o of rest) o.hp = 0;
  e.pos = { x: s.player.pos.x - (s.player.radius + e.radius + 10), y: s.player.pos.y };
  e.stunMs = 10_000; // stays put while we turn
  return { s, hp: () => e.hp };
}

for (const [mode, make] of makers) {
  test(`${mode}: an enemy on the left is hit when facing left, missed when facing right`, () => {
    // facing left: one step of walking left (keys or stick), then Attack with no movement
    const L = leftFoe(make), before = L.hp();
    L.s.step({ ...NO_CONTROLS, move: { x: -1, y: 0 } });
    assert.deepEqual(norm(L.s.player.facing), { x: -1, y: 0 });
    L.s.step({ ...NO_CONTROLS, attack: true });
    assert.ok(L.s.fx.includes("swing") && L.s.fx.includes("hit"), `${mode}: swung left and hit`);
    assert.ok(L.hp() < before);
    assert.ok(L.s.player.swingDir.x < 0, "the swing (and its drawing) points left");
    // facing right: the same enemy is behind the blade
    const R = leftFoe(make), hp0 = R.hp();
    R.s.step({ ...NO_CONTROLS, move: { x: 1, y: 0 } });
    R.s.step({ ...NO_CONTROLS, attack: true });
    assert.ok(R.s.fx.includes("swing") && !R.s.fx.includes("hit"), `${mode}: swung right and missed`);
    assert.equal(R.hp(), hp0);
  });
}

test("attackDir: moving, every input follows the movement; still, a click aims and Space/touch keep the facing (kbph)", () => {
  const left = { x: -1, y: 0 }, up = { x: 0, y: -1 }, s2 = Math.SQRT1_2;
  const from = { x: 100, y: 100 }, cursorRight = { x: 300, y: 100 };
  assert.deepEqual(attackDir({ moving: true, moveVec: left, lastFacing: up, clickTarget: cursorRight, from }), left, "a click on the right while walking left swings left");
  assert.deepEqual(attackDir({ moving: true, moveVec: left, lastFacing: up }), left, "Space while walking left");
  const diag = attackDir({ moving: true, moveVec: { x: 1, y: -1 }, lastFacing: left });
  assert.ok(Math.abs(diag.x - s2) < 1e-12 && Math.abs(diag.y + s2) < 1e-12, "8-way: diagonals are unit");
  assert.deepEqual(attackDir({ moving: false, moveVec: { x: 0, y: 0 }, lastFacing: up, clickTarget: cursorRight, from }), { x: 1, y: 0 }, "standing still, a click aims at the cursor");
  assert.deepEqual(attackDir({ moving: false, moveVec: { x: 0, y: 0 }, lastFacing: up }), up, "standing still, Space keeps the facing");
  assert.deepEqual(attackDir({ moving: false, moveVec: { x: 0, y: 0 }, lastFacing: up, clickTarget: from, from }), up, "a click on the player itself keeps the facing");
  assert.deepEqual(attackDir({ moving: true, moveVec: { x: 0, y: 0 }, lastFacing: { x: 0, y: 0 } }), { x: 1, y: 0 }, "nothing at all faces right");
});

test("the drawn arc is the hitbox: drawn from the sim's player centre in both scenes' pixels", () => {
  const pos = { x: 333, y: 912 };
  assert.deepEqual(swingDrawOrigin(pos, (v) => ({ x: v.x / UNITS_PER_PX, y: v.y / UNITS_PER_PX })), { x: 111, y: 304 }, "forest: no vertical nudge");
  assert.deepEqual(swingDrawOrigin(pos, (v) => ({ x: 10 + v.x, y: 20 + v.y })), { x: 343, y: 932 }, "arena: just the room's offset");
  assert.deepEqual(swingArc(pos, { x: 1, y: 0 }, 16).origin, pos, "the hitbox's origin is the player's centre");
  // Forest: the player's figure (16 px tall) stands with its middle on that centre, so the arc sits on the figure.
  for (const h of [16, 19.2]) assert.equal(playerFeetPx(pos, h) - h / 2, pos.y / UNITS_PER_PX, `figure ${h} px`);
});

const EIGHT: Array<[string, Vec]> = [
  ["right", { x: 1, y: 0 }], ["left", { x: -1, y: 0 }], ["up", { x: 0, y: -1 }], ["down", { x: 0, y: 1 }],
  ["up-right", { x: 1, y: -1 }], ["up-left", { x: -1, y: -1 }], ["down-right", { x: 1, y: 1 }], ["down-left", { x: -1, y: 1 }],
];

for (const [mode, make] of makers) {
  test(`${mode}: for each of the 8 facings, an enemy at reach - 1 that way is hit, one opposite is not, even with a click the other way`, () => {
    for (const [name, dir] of EIGHT) for (const where of ["front", "behind"] as const) {
      const s = make(), [e, ...rest] = s.enemies;
      for (const o of rest) o.hp = 0;
      const u = norm(dir), reach = s.player.radius + PLAYER.swingRange - 1, sign = where === "front" ? 1 : -1;
      // Walk one step that way first (sets the facing), then put the enemy at reach - 1 (edge to edge: its centre at
      // reach - 1 + its radius would miss; a small enemy right at the arc's rim), frozen.
      s.step({ ...NO_CONTROLS, move: dir });
      e.radius = 1;
      e.pos = { x: s.player.pos.x + sign * u.x * reach, y: s.player.pos.y + sign * u.y * reach };
      e.stunMs = 10_000;
      const hp = e.hp;
      // Keep walking that way and click on the opposite side: the swing follows the movement.
      const click = { x: s.player.pos.x - u.x * 200, y: s.player.pos.y - u.y * 200 };
      s.step({ move: dir, attack: true, dash: false, aim: click });
      assert.ok(s.fx.includes("swing"), `${mode} ${name}: swung`);
      assert.ok(Math.abs(s.player.swingDir.x - u.x) < 1e-9 && Math.abs(s.player.swingDir.y - u.y) < 1e-9, `${mode} ${name}: swing follows the movement`);
      if (where === "front") assert.ok(e.hp < hp, `${mode} ${name}: the enemy in front is hit`);
      else assert.equal(e.hp, hp, `${mode} ${name}: the enemy behind is not`);
    }
  });

  test(`${mode}: standing still, a click aims at the cursor; Space swings the last facing`, () => {
    const s = make();
    s.step({ ...NO_CONTROLS, move: { x: 0, y: -1 } }); // face up
    s.step({ ...NO_CONTROLS, attack: true, aim: { x: s.player.pos.x - 100, y: s.player.pos.y } });
    assert.ok(s.player.swingDir.x < -0.99, `${mode}: click on the left, swing left`);
    const t = make();
    t.step({ ...NO_CONTROLS, move: { x: 0, y: -1 } });
    t.step({ ...NO_CONTROLS, attack: true });
    assert.ok(t.player.swingDir.y < -0.99, `${mode}: Space, swing up`);
  });
}
