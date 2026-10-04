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
import { PLAYER, aimAtPointer, hitBySwing, norm, swingArc, type FightInput, type Vec } from "./logic";
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
