import { test } from "node:test";
import assert from "node:assert/strict";
import { HOP_MS, IDLE_PERIOD, IDLE_UP, NPC_KINDS, NPC_SCALE, NPC_SIZE, counterRows, isNpcKind, npcOffset, npcRects } from "./npc";
import { actorDepth, parseSceneDef, pointIn, sceneErrors } from "./scene";
import { sceneById } from "./scenes";

const base = (actor: Record<string, unknown>): Record<string, unknown> => ({
  id: "t", size: { w: 400, h: 300 }, background: "bg",
  bounds: { x: 50, y: 100, w: 300, h: 150 }, spawn: { x: 200, y: 200 },
  zones: [{ id: "shop", x: 100, y: 100, w: 40, h: 20, kind: "shop", item: "heal" }],
  actors: [{ id: "v", x: 120, y: 60, ...actor }],
});
const has = (raw: unknown, re: RegExp) => assert.ok(sceneErrors(raw).some((e) => re.test(e)), `${JSON.stringify(sceneErrors(raw))} ~ ${re}`);

test("SceneDef: an actor's npc, counterY and zone are validated (additive: plain actors still pass)", () => {
  assert.deepEqual(sceneErrors(base({})), []);
  assert.deepEqual(sceneErrors(base({ npc: "healer", counterY: 55, zone: "shop" })), []);
  assert.equal(parseSceneDef(base({ npc: "smith" })).actors![0].npc, "smith");
  has(base({ npc: "baker" }), /npc must be one of "healer", "smith"/);
  has(base({ npc: 3 }), /npc must be one of/);
  has(base({ npc: "smith", counterY: "x" }), /counterY must be a finite number/);
  has(base({ npc: "smith", counterY: 70 }), /counterY \(70\) must not lie below the feet/);
  has(base({ npc: "smith", zone: "nowhere" }), /zone "nowhere" is not a zone/);
  has(base({ counterY: 50 }), /counterY and zone are for npc actors/);
});

test("vendor art: every kind is a 16x24 figure inside its box; the healer has a red cross, the smith an apron and a hammer", () => {
  assert.deepEqual(NPC_SIZE, { w: 16, h: 24 });
  for (const k of NPC_KINDS) {
    const rects = npcRects(k);
    assert.ok(rects.length > 10, k);
    for (const r of rects) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= NPC_SIZE.w && r.y + r.h <= NPC_SIZE.h && r.w > 0 && r.h > 0, `${k} rect inside the box: ${JSON.stringify(r)}`);
  }
  const colours = (k: "healer" | "smith") => new Set(npcRects(k).map((r) => r.c));
  assert.ok(colours("healer").has("#c0302f"), "red cross");
  assert.ok(colours("healer").has("#efe6cf"), "cream robe");
  assert.ok(colours("smith").has("#7a5230"), "brown leather apron");
  assert.ok(colours("smith").has("#8e949c"), "iron hammer head");
  assert.ok(isNpcKind("smith") && !isNpcKind("devil") && !isNpcKind(undefined));
});

test("counterRows: the part of the figure above the counter's top edge", () => {
  assert.equal(counterRows(150, 142, 24), 20, "feet 8 px below the counter: 4 source rows hidden");
  assert.equal(counterRows(150, 150, 24), 24, "counter at the feet: whole figure");
  assert.equal(counterRows(150, 90, 24), 0, "counter above the head: nothing");
  assert.equal(counterRows(150, 200, 24), 24, "never more than the figure");
  assert.equal(counterRows(148, 142, 24, 2), 21, "feet 6 px below the counter: 3 rows hidden");
});

test("npcOffset: a one-pixel bob a little each cycle, a hop on a zone entry, nothing under reduced motion", () => {
  const ups = (phase: number) => { let n = 0; for (let t = 0; t < IDLE_PERIOD; t += 100) if (npcOffset(t, phase, null, false) !== 0) n++; return n; };
  assert.ok(ups(0) > 0 && ups(0) < IDLE_PERIOD / 100, "mostly still, sometimes up");
  assert.equal(npcOffset(0, 0, null, false), -NPC_SCALE, "up by one source pixel (whole pixels only)");
  assert.equal(npcOffset(IDLE_UP, 0, null, false), 0);
  assert.notEqual(npcOffset(0, 0, null, false), npcOffset(0, 1100, null, false), "the two vendors are out of step");
  const hop = Array.from({ length: 10 }, (_, i) => npcOffset(1000 + (i * HOP_MS) / 10, 0, 1000, false));
  assert.ok(Math.min(...hop) <= -4 && Math.min(...hop) >= -8, "hops a few pixels");
  assert.ok(hop.every((v) => v % NPC_SCALE === 0), "in whole source pixels");
  assert.ok(Math.abs(npcOffset(1000 + HOP_MS + 1, 0, 1000, false)) <= NPC_SCALE, "back to idle after the hop");
  for (let t = 0; t < 5000; t += 50) assert.equal(npcOffset(t, 0, 1000, true), 0, "reduced motion: still, no hop");
});

test("village: a Healer and a Smith stand behind their shop windows: outside bounds, behind the player, over their own zone", () => {
  const v = sceneById("village")!;
  const npcs = v.actors!.filter((a) => a.npc);
  assert.deepEqual(npcs.map((a) => a.npc).sort(), ["healer", "smith"]);
  for (const a of npcs) {
    const zone = v.zones!.find((z) => z.id === a.zone)!;
    assert.ok(zone, `${a.id} has a zone`);
    assert.ok(!pointIn(a, v.bounds), `${a.id} stands outside the walkable bounds`);
    assert.ok(a.x >= zone.x && a.x <= zone.x + zone.w, `${a.id} is above its own shop zone`);
    assert.ok(a.counterY! < a.y && a.y - a.counterY! <= 12, `${a.id}'s feet are just below the counter's top edge, so it is hidden from there down`);
    assert.ok(a.y - NPC_SIZE.h * NPC_SCALE >= 80, `${a.id}'s head stays inside the shopfront's window, not above the building`);
    assert.ok(actorDepth(a.y) < actorDepth(v.bounds.y), `${a.id} is sorted behind the player, whose feet are at or below bounds.y`);
  }
  assert.equal(v.zones!.find((z) => z.id === npcs.find((a) => a.npc === "smith")!.zone)!.item, "blade");
  assert.equal(v.zones!.find((z) => z.id === npcs.find((a) => a.npc === "healer")!.zone)!.item, "heal");
});
