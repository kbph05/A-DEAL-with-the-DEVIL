import { test } from "node:test";
import assert from "node:assert/strict";
import { worldLayout } from "./logic";
import {
  ZoneTracker, actorDepth, bandLayout, artSource, clampToBounds, footY, isUrl, overlayDepth, parseSceneDef, pointIn, sceneErrors,
  zoneChanges, zonesAt, type SceneDef,
} from "./scene";
import { actorShape, overlayCanopies, sceneTiles } from "./scenePlaceholders";
import { SCENES, sceneById } from "./scenes";
import { T, isBlockingId } from "./tiles";

const scene = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "t", size: { w: 400, h: 300 }, background: "bg", overlay: "ov",
  bounds: { x: 50, y: 100, w: 300, h: 150 }, spawn: { x: 200, y: 200 },
  zones: [{ id: "exit", x: 50, y: 100, w: 40, h: 20, kind: "exit" }],
  actors: [{ id: "npc", x: 120, y: 160 }],
  ...over,
});

test("SceneDef: the sample scenes are valid and findable", () => {
  assert.ok(SCENES.length === 2);
  assert.equal(SCENES[0].id, "village", "the village is the default scene (act 1 starts there)");
  for (const s of SCENES) assert.deepEqual(sceneErrors(s), [], s.id);
  assert.equal(sceneById("forest")?.size.w, 1280);
  assert.equal(sceneById("nope"), undefined);
});

test("SceneDef: bounds inside size, spawn inside bounds, finite numbers", () => {
  assert.deepEqual(sceneErrors(scene()), []);
  const has = (raw: unknown, re: RegExp) => assert.ok(sceneErrors(raw).some((e) => re.test(e)), `${JSON.stringify(sceneErrors(raw))} ~ ${re}`);
  has(scene({ bounds: { x: 50, y: 100, w: 400, h: 150 } }), /bounds must lie inside size/);
  has(scene({ bounds: { x: -1, y: 0, w: 10, h: 10 } }), /bounds must lie inside size/);
  has(scene({ spawn: { x: 10, y: 10 } }), /spawn .* inside bounds/);
  has(scene({ spawn: { x: 350, y: 200 } }), /spawn .* inside bounds/); // right edge is outside
  has(scene({ size: { w: Infinity, h: 300 } }), /size/);
  has(scene({ size: { w: 0, h: 300 } }), /size must be positive/);
  has(scene({ bounds: { x: 50, y: NaN, w: 300, h: 150 } }), /bounds\.y is not a finite number/);
  has(scene({ bounds: { x: 50, y: 100, w: 0, h: 150 } }), /no area/);
  has(scene({ spawn: { x: "1", y: 2 } }), /spawn must be/);
  has(scene({ id: "" }), /id must be/);
  has(scene({ background: 3 }), /background/);
  has(scene({ overlay: "" }), /overlay/);
  has(scene({ zones: [{ id: "a", x: 0, y: 0, w: 10, h: 10 }] }), /outside bounds/);
  has(scene({ zones: [{ id: "a", x: 60, y: 110, w: 10, h: 10, kind: "door" }] }), /kind/);
  // Shop zones (additive): kind "shop" needs an item, the engine item id.
  assert.deepEqual(sceneErrors(scene({ zones: [{ id: "a", x: 60, y: 110, w: 10, h: 10, kind: "shop", item: "heal" }] })), []);
  has(scene({ zones: [{ id: "a", x: 60, y: 110, w: 10, h: 10, kind: "shop" }] }), /is a shop, so it needs an item/);
  has(scene({ zones: [{ id: "a", x: 60, y: 110, w: 10, h: 10, kind: "trigger", item: 3 }] }), /item must be a string/);
  has(scene({ zones: [{ id: "a", x: 60, y: 110, w: 10, h: 10 }, { id: "a", x: 70, y: 110, w: 10, h: 10 }] }), /used twice/);
  has(scene({ actors: [{ id: "x", x: 500, y: 10 }] }), /outside size/);
  has(scene({ actors: [{ id: "x", x: 5 }] }), /finite x and y/);
  // Actors may stand outside bounds (shopfronts on the edge); zones and the spawn may not.
  assert.deepEqual(sceneErrors(scene({ actors: [{ id: "stall", x: 200, y: 98 }, { id: "far", x: 10, y: 10 }] })), []);
  has(scene({ zones: {} }), /zones must be an array/);
  assert.deepEqual(sceneErrors(null), ["the scene is not an object"]);
  assert.throws(() => parseSceneDef(scene({ spawn: { x: 0, y: 0 } })), /Bad scene "t": spawn/);
  assert.equal(parseSceneDef(scene()).id, "t");
  assert.deepEqual(sceneErrors(scene({ zones: undefined, actors: undefined, overlay: undefined })), [], "optional parts");
});

test("y-sort: foot y from the sprite's bottom, lower feet draw in front, overlay above everything", () => {
  assert.equal(footY(200, 40, 1), 200, "origin (0.5, 1): y is the feet");
  assert.equal(footY(200, 40, 0.5), 220);
  assert.equal(footY(200, 40, 0), 240);
  const behind = actorDepth(footY(300, 40, 1));
  const front = actorDepth(footY(301, 16, 1));
  assert.ok(front > behind, "one pixel lower is in front, whatever the height");
  assert.ok(actorDepth(0) > 0, "every actor is above the background (depth 0)");
  const h = 540;
  assert.ok(overlayDepth(h) > actorDepth(h + h / 2), "overlay above actors even with feet below the texture");
});

test("clampToBounds: keeps the point (and a box around it) in the playable rect", () => {
  const r = { x: 50, y: 100, w: 300, h: 150 };
  assert.deepEqual(clampToBounds({ x: 200, y: 200 }, r), { x: 200, y: 200 }, "inside: unchanged");
  assert.deepEqual(clampToBounds({ x: 0, y: 0 }, r), { x: 50, y: 100 });
  assert.deepEqual(clampToBounds({ x: 999, y: 999 }, r), { x: 350, y: 250 });
  assert.deepEqual(clampToBounds({ x: 0, y: 999 }, r, { x: 5, y: 3 }), { x: 55, y: 247 }, "with the feet box");
  assert.deepEqual(clampToBounds({ x: 0, y: 0 }, { x: 0, y: 0, w: 8, h: 100 }, { x: 5, y: 0 }), { x: 4, y: 0 }, "box wider than the rect: centred");
});

test("zones: point tests, enter and leave once each, no entry for the spawn zone", () => {
  const zones = [
    { id: "a", x: 0, y: 0, w: 10, h: 10 },
    { id: "b", x: 5, y: 0, w: 10, h: 10, kind: "exit" as const },
  ];
  assert.ok(pointIn({ x: 0, y: 0 }, zones[0]) && !pointIn({ x: 10, y: 5 }, zones[0]), "left/top in, right/bottom out");
  assert.deepEqual(zonesAt(zones, { x: 7, y: 5 }), ["a", "b"]);
  assert.deepEqual(zonesAt(undefined, { x: 7, y: 5 }), []);
  assert.deepEqual(zoneChanges(["a"], ["b"]), { entered: ["b"], left: ["a"] });
  assert.deepEqual(zoneChanges(["a"], ["a"]), { entered: [], left: [] });

  const t = new ZoneTracker(zones, { x: 2, y: 2 });
  assert.deepEqual(t.current, ["a"], "starts in the spawn zone without an event");
  const ids = (r: { entered: { id: string }[]; left: { id: string }[] }) => ({ entered: r.entered.map((z) => z.id), left: r.left.map((z) => z.id) });
  assert.deepEqual(ids(t.update({ x: 3, y: 2 })), { entered: [], left: [] }, "moving inside: nothing");
  assert.deepEqual(ids(t.update({ x: 7, y: 2 })), { entered: ["b"], left: [] });
  assert.deepEqual(ids(t.update({ x: 8, y: 2 })), { entered: [], left: [] }, "once per entry");
  assert.deepEqual(ids(t.update({ x: 12, y: 2 })), { entered: [], left: ["a"] });
  assert.deepEqual(ids(t.update({ x: 30, y: 30 })), { entered: [], left: ["b"] });
  const again = t.update({ x: 12, y: 2 });
  assert.equal(again.entered[0].kind, "exit", "re-entering fires again, with the zone itself");
});

test("art: private file beats the def's URL or key; extensions; URL detection", () => {
  const url = (f: string) => `/assets/private/${f}`;
  const files = ["player-idle.png", "scenes/village/background.png", "scenes/village/actors/devil.webp"];
  assert.deepEqual(artSource(files, "village", "background", "bg-key", url), { kind: "private", url: "/assets/private/scenes/village/background.png" });
  assert.deepEqual(artSource(files, "village", "actors/devil", undefined, url), { kind: "private", url: "/assets/private/scenes/village/actors/devil.webp" });
  assert.deepEqual(artSource(files, "village", "overlay", "art/over.png", url), { kind: "url", url: "art/over.png" });
  assert.deepEqual(artSource(files, "forest", "background", "bg-key", url), { kind: "key", key: "bg-key" });
  assert.equal(artSource(files, "forest", "overlay", undefined, url), null);
  assert.ok(isUrl("/x/y.png") && isUrl("https://a.b/c") && isUrl("bg.jpg") && !isUrl("scene-forest-bg"));
});

test("placeholder art: playable rect looks walkable, the rest blocked, exits are paths; canopies overlap the bottom edge", () => {
  const def = parseSceneDef(scene()) as SceneDef;
  const g = sceneTiles(def);
  assert.equal(g.width, 25);
  assert.equal(g.height, 19);
  assert.deepEqual(sceneTiles(def), g, "deterministic");
  const at = (px: number, py: number) => g.tiles[Math.floor(py / 16) * g.width + Math.floor(px / 16)];
  assert.ok(!isBlockingId(at(200, 200)), "inside bounds");
  assert.ok(isBlockingId(at(10, 10)), "outside bounds");
  assert.equal(at(60, 104), T.PATH, "exit zone");
  const c = overlayCanopies(def);
  const bottom = def.bounds.y + def.bounds.h;
  assert.ok(c.some((k) => !k.trunk && k.y - k.r < bottom && k.y > bottom - k.r), "a canopy row hangs over the bottom edge");
  assert.ok(c.some((k) => k.trunk && pointIn(k, def.bounds)), "a big tree inside the playable rect");
  const edge = parseSceneDef(scene({ actors: [{ id: "stall-x", x: 200, y: 98 }] })) as SceneDef;
  const eg = sceneTiles(edge);
  assert.ok(!isBlockingId(eg.tiles[Math.floor(80 / 16) * eg.width + Math.floor(200 / 16)]), "a stall outside bounds stands in a clearing");
  assert.ok(isBlockingId(eg.tiles[Math.floor(10 / 16) * eg.width + Math.floor(10 / 16)]), "forest elsewhere");
  for (const id of ["village", "forest"]) {
    const sc = sceneById(id)!;
    for (const door of sc.zones!.filter((z) => z.kind === "exit")) {
      const over = (k: { x: number; y: number; r: number }) => k.x + k.r > door.x && k.x - k.r < door.x + door.w && k.y + k.r > door.y && k.y - k.r < door.y + door.h;
      assert.ok(overlayCanopies(sc).every((k) => k.trunk || k.y < sc.bounds.y + sc.bounds.h || !over(k)), `no bottom-row canopy over the exit ${door.id} of ${id}`);
    }
  }
});

test("worldLayout: zoom is an integer >= 1, default 2", () => {
  assert.equal(worldLayout(1280, 800).zoom, 2);
  assert.equal(worldLayout(1280, 800, 3).zoom, 3);
  assert.equal(worldLayout(1280, 800, 0).zoom, 1);
});

test("placeholder art: actors named stall-… and house-… get a stall and a cottage", () => {
  assert.equal(actorShape("stall-smith"), "stall");
  assert.equal(actorShape("house-mill"), "house");
  assert.equal(actorShape("devil"), "figure");
  const village = sceneById("village")!;
  assert.equal((village.actors ?? []).filter((a) => actorShape(a.id) === "stall").length, 0, "the village's shopfronts are in the designer's picture, not drawn on top of it");
});

test("SceneDef: enemy spawns (fight scenes) are optional points inside bounds", () => {
  const has = (raw: unknown, re: RegExp) => assert.ok(sceneErrors(raw).some((e) => re.test(e)), `${JSON.stringify(sceneErrors(raw))} ~ ${re}`);
  assert.deepEqual(sceneErrors(scene({ spawns: [{ x: 100, y: 150 }, { x: 300, y: 240 }] })), []);
  has(scene({ spawns: {} }), /spawns must be an array/);
  has(scene({ spawns: [{ x: 100 }] }), /spawns\[0\] must be/);
  has(scene({ spawns: [{ x: 100, y: 150 }, { x: 10, y: 10 }] }), /spawns\[1\] .* inside bounds/);
  const forest = sceneById("forest")!;
  assert.ok(forest.spawns!.length > 0, "the forest path is a sample scene, in the world lab's picker too");
});

test("placeholder art: a fight scene is a dirt path through grass, forest all round, canopies on both edges", () => {
  const forest = sceneById("forest")!;
  const g = sceneTiles(forest);
  const at = (px: number, py: number) => g.tiles[Math.floor(py / 16) * g.width + Math.floor(px / 16)];
  assert.equal(at(600, forest.spawn.y), T.PATH, "a path from the spawn to the exit");
  const b = forest.bounds;
  const walk: number[] = [T.GRASS, T.PATH];
  for (let x = 8; x < forest.size.w; x += 16) for (let y = 8; y < forest.size.h; y += 16) {
    if (pointIn({ x, y }, b) && !forest.zones!.some((z) => pointIn({ x, y }, z))) assert.ok(walk.includes(at(x, y)), `grass or path at ${x},${y}`);
  }
  for (let x = 8; x < forest.size.w; x += 16) { assert.equal(at(x, 8), T.TREE); assert.equal(at(x, forest.size.h - 8), T.TREE); }
  const c = overlayCanopies(forest);
  assert.ok(c.some((k) => k.y + k.r > b.y && k.y < b.y), "a canopy row over the top edge");
  assert.ok(c.some((k) => k.y - k.r < b.y + b.h && k.y > b.y + b.h), "and over the bottom edge");
  assert.ok(c.every((k) => !k.trunk), "no big tree in the way of the fight");
});

test("bandLayout: a band fills the scene height and is repeated (mirrored every other copy) to cover the width", () => {
  assert.deepEqual(bandLayout({ w: 256, h: 256 }, { w: 1280, h: 560 }), { scale: 2.1875, copies: 3, width: 768 });
  assert.deepEqual(bandLayout({ w: 256, h: 256 }, { w: 512, h: 256 }), { scale: 1, copies: 2, width: 512 }, "an exact fit adds no copy");
  assert.deepEqual(bandLayout({ w: 256, h: 256 }, { w: 100, h: 512 }), { scale: 2, copies: 1, width: 256 });
});
