import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ENCOUNTER_BANDS } from "../fight/encounters";
import { ENEMY_IDS } from "../fight/enemies";
import {
  CHARACTERS, FRAME_OVERRIDES, PACKS, ROLES, attributionFile, characterFiles, characterListed, detectFrames, enemyAnim, feetOrigin,
  fitScale, listedPacks, opaqueBBox, playerAnim, privateAssetUrl, roleArt, roleScale, unionBox, type AnimName, type CharacterId,
} from "./sprites";

const manifest = JSON.parse(readFileSync(new URL("../../assets/encrypted/manifest.json", import.meta.url), "utf8")) as { files: Record<string, unknown> };
const shipped = Object.keys(manifest.files);

test("frame detection: Tiny RPG strips of square frames, from the image size alone", () => {
  assert.deepEqual(detectFrames(600, 100), { frameWidth: 100, frameHeight: 100, frames: 6, how: "square", odd: null });
  assert.deepEqual(detectFrames(800, 100), { frameWidth: 100, frameHeight: 100, frames: 8, how: "square", odd: null });
  assert.deepEqual(detectFrames(100, 100), { frameWidth: 100, frameHeight: 100, frames: 1, how: "square", odd: null });
  assert.equal(detectFrames(32, 32).frames, 1, "the arrow: one 32×32 frame");
  assert.ok(detectFrames(4000, 100).odd, "40 square frames gets a warning");
});

test("frame detection: non-square sheets fall back to a common frame width that divides the width", () => {
  // A 69×44-frame strip (6 and 10 frames): 414 % 44 and 690 % 44 are not 0.
  const six = detectFrames(414, 44);
  assert.equal(six.how, "candidate");
  assert.deepEqual([six.frameWidth, six.frameHeight, six.frames], [69, 44, 6]);
  assert.ok(six.odd, "a guess is always logged");
  assert.deepEqual([detectFrames(690, 44).frameWidth, detectFrames(690, 44).frames], [69, 10]);
  // Several candidates divide: the one nearest the height wins (frames tend to be near square).
  const wide = detectFrames(960, 90);
  assert.equal(wide.frameWidth, 96, "96 is nearest 90 among 64, 80, 96 (all divide 960)");
  assert.equal(wide.frames, 10);
  assert.match(wide.odd!, /also divide/);
  assert.deepEqual([detectFrames(640, 70).frameWidth, detectFrames(640, 70).frames], [64, 10]);
  // Nothing fits: one frame, with a warning.
  const none = detectFrames(301, 47);
  assert.deepEqual([none.frameWidth, none.frameHeight, none.frames, none.how], [301, 47, 1, "single"]);
  assert.ok(none.odd);
  assert.equal(detectFrames(0, 0).frames, 1, "an empty image doesn't throw");
});

test("frame detection: an override wins (by frame width or by count)", () => {
  assert.deepEqual(detectFrames(414, 44, { frameWidth: 69 }), { frameWidth: 69, frameHeight: 44, frames: 6, how: "override", odd: null });
  assert.deepEqual(detectFrames(600, 100, { frames: 4 }).frameWidth, 150);
  assert.ok(detectFrames(600, 100, { frameWidth: 70 }).odd, "an override that doesn't divide is flagged");
  for (const [file, o] of Object.entries(FRAME_OVERRIDES)) assert.ok(shipped.includes(file) && (o.frameWidth || o.frames), file);
});

test("the visible figure: opaque bounding box, union, feet origin (mirrored), scale", () => {
  // A 10×6 image with two 5×6 frames; frame 1 has a 2×3 figure at (1, 2).
  const W = 10, H = 6, rgba = new Uint8ClampedArray(W * H * 4);
  const dot = (x: number, y: number) => { rgba[(y * W + x) * 4 + 3] = 255; };
  dot(6, 2); dot(7, 2); dot(6, 4); dot(7, 4);
  rgba[(0 * W + 0) * 4 + 3] = 5; // faint: below the threshold
  assert.equal(opaqueBBox(rgba, W, 0, 0, 5, 6), null, "frame 0 is empty");
  assert.deepEqual(opaqueBBox(rgba, W, 5, 0, 5, 6), { x: 1, y: 2, w: 2, h: 3 });
  assert.deepEqual(unionBox([null, { x: 1, y: 2, w: 2, h: 3 }, { x: 0, y: 3, w: 1, h: 3 }]), { x: 0, y: 2, w: 3, h: 4 });
  assert.equal(unionBox([null]), null);
  // A 20 px figure, centred at x 50 in a 100×100 frame, feet at y 57.
  const fig = { x: 42, y: 37, w: 16, h: 20 };
  assert.deepEqual(feetOrigin(fig, 100, 100, false), { x: 0.5, y: 0.57 });
  const off = { x: 30, y: 40, w: 10, h: 10 };
  assert.deepEqual(feetOrigin(off, 100, 100, false), { x: 0.35, y: 0.5 });
  assert.deepEqual(feetOrigin(off, 100, 100, true), { x: 0.65, y: 0.5 }, "mirrored: the figure is on the other side of the frame");
  assert.equal(fitScale(20, 16), 0.8);
  assert.equal(fitScale(0, 16), 1);
  assert.equal(fitScale(2, 100), 4, "clamped");
});

test("role → sheet: Soldier the player, Orc every regular enemy, Demon_A the minibosses, the warrior the final boss", () => {
  assert.equal(roleArt("player")?.character, "soldier");
  assert.equal(roleArt("orc")?.character, "orc");
  assert.equal(roleArt("miniboss1")?.character, "demon_a");
  assert.equal(roleArt("miniboss2")?.character, "demon_a");
  assert.equal(roleArt("final_boss")?.character, "warrior");
  assert.equal(roleArt("slime"), null, "no sprite: generated art");
  assert.equal(roleArt("skeleton_archer"), null, "no sprite: generated art");
  // The orc is not scaled up ("the orc is small"); the minibosses are slightly larger than the pack's scale.
  assert.equal(ROLES.orc!.mult, 1);
  assert.ok(ROLES.miniboss1!.mult! > 1 && ROLES.miniboss1!.mult! <= 1.5);
  // Every enemy the encounter tables can produce, and every boss, has a sprite.
  for (const b of ENCOUNTER_BANDS) for (const id of [b.lead, ...Object.keys(b.mix)] as (typeof ENEMY_IDS[number])[]) assert.ok(roleArt(id), id);
  // The Soldier's attack cycles 01 to 03; the warrior has a heavy hit and the run.
  assert.deepEqual(CHARACTERS.soldier.anims.attack!.map((r) => r.file.split("/")[1]), ["Soldier_Attack01.png", "Soldier_Attack02.png", "Soldier_Attack03.png"]);
  assert.ok(CHARACTERS.warrior.anims.heavy);
  assert.ok(characterFiles("warrior").includes("WarriorChAnimation/WarriorChHRun.png"));
});

test("every sheet the registry asks for is in the encrypted manifest (same paths, spaces and all)", () => {
  for (const id of Object.keys(CHARACTERS) as CharacterId[]) for (const f of characterFiles(id)) assert.ok(shipped.includes(f), f);
  for (const p of PACKS) assert.ok(shipped.includes(attributionFile(p)), p);
  // Listed only with the key: without it nothing is listed, so nothing is requested.
  assert.equal(characterListed("soldier", []), false);
  assert.equal(characterListed("soldier", shipped), true);
  assert.deepEqual(listedPacks([]), []);
  assert.deepEqual(listedPacks(shipped.filter((f) => f.endsWith(".png"))), [...PACKS]);
});

test("private URLs are percent-encoded per segment (spaces, parentheses), and decode back", () => {
  const f = "Tiny RPG Character Asset Pack 01/Arrow01(32x32).png";
  const url = privateAssetUrl(f);
  assert.equal(url, "/assets/private/Tiny%20RPG%20Character%20Asset%20Pack%2001/Arrow01(32x32).png");
  assert.equal(decodeURIComponent(url.slice("/assets/private/".length)), f, "what the Vite plugin decodes");
  assert.equal(privateAssetUrl("a b/c.png", "/game"), "/game/assets/private/a%20b/c.png");
  assert.ok(!/ /.test(privateAssetUrl(f)));
});

test("roles scale with the Soldier, so the pack keeps the artist's relative sizes; else to their own height", () => {
  const heights: Partial<Record<CharacterId, number>> = { soldier: 20, orc: 18, demon_a: 24, warrior: 44 };
  const fig = (c: CharacterId) => heights[c] ?? null;
  const player = roleScale(ROLES.player!, fig);
  assert.equal(player, 16 / 20);
  assert.equal(roleScale(ROLES.orc!, fig), player, "the orc at the Soldier's scale");
  assert.equal(roleScale(ROLES.miniboss1!, fig), player * ROLES.miniboss1!.mult!);
  assert.equal(roleScale(ROLES.final_boss!, fig), 36 / 44);
  // The Soldier failed to load: fit the orc to its own height.
  assert.equal(roleScale(ROLES.orc!, (c) => (c === "soldier" ? null : fig(c))), 16 / 18);
});

test("animation state: death > hurt > heavy/attack > walk > idle, with fallbacks for missing sheets", () => {
  const all = () => true;
  const warrior = (a: AnimName) => a !== "hurt" && a !== "death";
  const base = { dead: false, hurt: false, mode: "chase" as const, moving: true };
  assert.equal(enemyAnim(base, all), "walk");
  assert.equal(enemyAnim({ ...base, moving: false }, all), "idle");
  assert.equal(enemyAnim({ ...base, mode: "windup" }, all), "attack", "the telegraph");
  assert.equal(enemyAnim({ ...base, mode: "lunge" }, all), "attack");
  assert.equal(enemyAnim({ ...base, mode: "recover", moving: false }, all), "idle");
  assert.equal(enemyAnim({ ...base, mode: "burstWindup" }, warrior), "heavy", "the warrior's telegraphed big hit");
  assert.equal(enemyAnim({ ...base, mode: "burstWindup" }, (a) => a !== "heavy"), "attack", "Demon_A has no heavy: its attack");
  assert.equal(enemyAnim({ ...base, hurt: true }, all), "hurt");
  assert.equal(enemyAnim({ ...base, hurt: true }, warrior), "walk", "no hurt sheet: it flashes white over its walk");
  assert.equal(enemyAnim({ ...base, dead: true, hurt: true }, all), "death");
  assert.equal(enemyAnim({ ...base, dead: true }, warrior), "idle", "no death sheet: it fades");
  const p = { dead: false, hurt: false, swinging: false, moving: false };
  assert.equal(playerAnim(p, all), "idle");
  assert.equal(playerAnim({ ...p, moving: true }, all), "walk");
  assert.equal(playerAnim({ ...p, moving: true, swinging: true }, all), "attack");
  assert.equal(playerAnim({ ...p, swinging: true, hurt: true }, all), "hurt");
  assert.equal(playerAnim({ ...p, dead: true, hurt: true }, all), "death");
});
