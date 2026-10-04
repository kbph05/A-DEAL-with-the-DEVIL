import { test } from "node:test";
import assert from "node:assert/strict";
import { FloatingStick } from "../input/stick";
import { generateWorld } from "./gen";
import { WORLD_SPEED, facingOf, stepVelocity, worldLayout } from "./logic";
import { fromTiled, loadMapJson } from "./tiled";
import { T, TILES, isBlocked, parseWorldMap, reachable, tileAt, tileCenter, toTile, type WorldMap } from "./tiles";

const border = (m: WorldMap) => {
  const out: number[] = [];
  for (let x = 0; x < m.width; x++) out.push(tileAt(m, x, 0), tileAt(m, x, m.height - 1));
  for (let y = 0; y < m.height; y++) out.push(tileAt(m, 0, y), tileAt(m, m.width - 1, y));
  return out;
};

test("tile table: ids are indexes; walls, water, trees, rocks and void block", () => {
  TILES.forEach((t, i) => assert.equal(t.id, i));
  for (const id of [T.VOID, T.WALL, T.WATER, T.TREE, T.ROCK]) assert.equal(TILES[id].blocks, true);
  for (const id of [T.FLOOR, T.GRASS, T.PATH, T.DOOR]) assert.equal(TILES[id].blocks, false);
});

test("tile lookups: pixel to tile, outside the map is void and blocks", () => {
  const m = parseWorldMap({ width: 3, height: 2, tiles: [2, 4, 2, 5, 2, 6], spawn: { x: 0, y: 0 } });
  assert.equal(toTile(15.9), 0);
  assert.equal(toTile(16), 1);
  assert.equal(toTile(-0.1), -1);
  assert.equal(tileCenter(2), 40);
  assert.equal(isBlocked(m, 1, 0), true, "wall");
  assert.equal(isBlocked(m, 0, 1), true, "water");
  assert.equal(isBlocked(m, 2, 1), false, "door is walkable");
  assert.equal(isBlocked(m, -1, 0), true);
  assert.equal(isBlocked(m, 3, 0), true);
  assert.equal(tileAt(m, 9, 9), T.VOID);
  assert.deepEqual(m.doors, [{ x: 2, y: 1 }]);
});

test("parseWorldMap: junk ids become void, a blocked spawn moves, bad shapes throw", () => {
  const m = parseWorldMap({ width: 2, height: 2, tiles: [4, 99, -3, 2], spawn: { x: 0, y: 0 } });
  assert.deepEqual(m.tiles, [4, 0, 0, 2]);
  assert.deepEqual(m.spawn, { x: 1, y: 1 }, "spawn on a wall falls back to the first walkable tile");
  assert.throws(() => parseWorldMap({ width: 2, height: 2, tiles: [1] }), /width \* height/);
  assert.throws(() => parseWorldMap(null), /not an object/);
  assert.throws(() => parseWorldMap({ width: 1, height: 1, tiles: [4] }), /no walkable/);
});

test("generator: deterministic from the seed, different seeds differ", () => {
  assert.deepEqual(generateWorld("abc"), generateWorld("abc"));
  assert.notDeepEqual(generateWorld("abc").tiles, generateWorld("abd").tiles);
  const m = generateWorld("abc", { width: 24, height: 18 });
  assert.equal(m.width, 24);
  assert.equal(m.tiles.length, 24 * 18);
});

test("generator: walled in, walkable spawn, every door reachable (300 seeds, two sizes)", () => {
  for (let i = 0; i < 300; i++) {
    const m = generateWorld(`s${i}`, i % 2 ? {} : { width: 20, height: 14 });
    assert.ok(border(m).every((t) => t === T.WALL || t === T.DOOR), `seed s${i}: border`);
    assert.ok(m.doors.length >= 1, `seed s${i}: has a door`);
    for (const d of m.doors) assert.equal(tileAt(m, d.x, d.y), T.DOOR);
    assert.equal(isBlocked(m, m.spawn.x, m.spawn.y), false, `seed s${i}: spawn walkable`);
    const r = reachable(m, m.spawn);
    for (const d of m.doors) assert.ok(r.has(d.y * m.width + d.x), `seed s${i}: door ${d.x},${d.y} reachable`);
    // Something to bump into.
    assert.ok(m.tiles.some((t, k) => (t === T.WATER || t === T.TREE || t === T.ROCK || t === T.WALL) && k % m.width > 0 && k % m.width < m.width - 1 && k >= m.width && k < m.tiles.length - m.width), `seed s${i}: obstacles`);
    assert.ok(m.tiles.includes(T.PATH), `seed s${i}: a path`);
  }
});

test("stepVelocity: full speed from frame 1, constant while held, diagonals not faster, stops dead", () => {
  assert.equal(WORLD_SPEED, 80);
  let v = { x: 0, y: 0 };
  for (let i = 0; i < 120; i++) {
    v = stepVelocity(v, { x: 1, y: 0 }, i === 0 ? 1 / 60 : 1 / 30);
    assert.deepEqual(v, { x: WORLD_SPEED, y: 0 }, `frame ${i + 1}: already full speed`);
  }
  for (const dir of [{ x: 1, y: 1 }, { x: -1, y: 1 }, { x: 0, y: -1 }]) {
    assert.ok(Math.abs(Math.hypot(...Object.values(stepVelocity({ x: 0, y: 0 }, dir, 1 / 60))) - WORLD_SPEED) < 1e-9, "same speed any way");
  }
  assert.deepEqual(stepVelocity({ x: 80, y: 0 }, { x: 0, y: 0 }, 1 / 60), { x: 0, y: 0 }, "stops");
});

test("facingOf: 4-way, keeps facing when idle and on exact diagonals", () => {
  assert.equal(facingOf({ x: 0, y: 0 }, "left"), "left");
  assert.equal(facingOf({ x: 1, y: 0.2 }, "up"), "right");
  assert.equal(facingOf({ x: -0.1, y: -1 }, "down"), "up");
  const d = Math.SQRT1_2;
  assert.equal(facingOf({ x: d, y: d }, "down"), "down", "diagonal keeps a matching facing");
  assert.equal(facingOf({ x: d, y: d }, "right"), "right");
  assert.equal(facingOf({ x: d, y: d }, "up"), "right", "else horizontal");
});

test("worldLayout: landscape and portrait, integer zoom, stick on screen", () => {
  const land = worldLayout(1280, 800);
  const port = worldLayout(390, 760);
  assert.ok(!land.portrait && port.portrait);
  for (const L of [land, port, worldLayout(0, 0)]) {
    assert.ok(Number.isInteger(L.zoom) && L.zoom >= 1);
    assert.ok(L.stick.x - L.stick.r >= 0 && L.stick.y + L.stick.r <= L.height && L.stick.x + L.stick.r <= L.width);
  }
  assert.ok(Math.abs(port.width / port.height - 390 / 760) < 0.01, "portrait keeps the aspect");
});

test("FloatingStick: grabs where the thumb lands, follows its pointer only, springs back", () => {
  const s = new FloatingStick({ x: 100, y: 400, r: 80 }, { width: 540, height: 500 });
  assert.deepEqual(s.dir(), { x: 0, y: 0 });
  assert.ok(s.grab({ id: 1, x: 10, y: 490 }));
  assert.deepEqual(s.base, { x: 80, y: 420 }, "base kept on screen");
  assert.ok(!s.grab({ id: 2, x: 300, y: 300 }), "one pointer at a time");
  assert.ok(!s.move({ id: 2, x: 500, y: 420 }));
  s.move({ id: 1, x: 200, y: 420 });
  assert.deepEqual(s.knob, { x: 80, y: 0 }, "knob clamped to the radius");
  assert.deepEqual(s.dir(), { x: 1, y: 0 });
  s.release({ id: 1 });
  assert.equal(s.active, false);
  assert.deepEqual(s.base, { x: 100, y: 400 });
});

// A 4×3 Tiled map: two tilesets, flip bits, a base64 layer under an array layer, a spawn object.
const b64 = (gids: number[]) => Buffer.from(new Uint32Array(gids).buffer).toString("base64");
const tiledFixture = () => ({
  width: 4, height: 3, tilewidth: 16, tileheight: 16, orientation: "orthogonal", infinite: false,
  tilesets: [
    { firstgid: 1, name: "ours", tilecount: 9 }, // gid 1 + id: our tileset in id order
    { firstgid: 100, name: "other", tiles: [{ id: 0, properties: [{ name: "kind", type: "string", value: "water" }] }, { id: 1, type: "wall" }] },
  ],
  layers: [
    { type: "tilelayer", name: "ground", width: 4, height: 3, encoding: "base64", data: b64([3, 3, 3, 3, 3, 4, 4, 3, 3, 3, 3, 3]) }, // grass, path
    { type: "tilelayer", name: "things", width: 4, height: 3, data: [5, 0, 0, 0, 0, 0, 0, 100, 0, (101 | 0x80000000) >>> 0, 0, 7] }, // wall, water, flipped wall, door
    { type: "objectgroup", name: "objects", objects: [{ name: "spawn", x: 40, y: 20 }] },
  ],
});

test("fromTiled: merges layers top-down, maps gids by tileset and kind, masks flip bits, reads the spawn", () => {
  const m = fromTiled(tiledFixture());
  assert.deepEqual(m.tiles, [T.WALL, T.GRASS, T.GRASS, T.GRASS, T.GRASS, T.PATH, T.PATH, T.WATER, T.GRASS, T.WALL, T.GRASS, T.DOOR]);
  assert.deepEqual(m.spawn, { x: 2, y: 1 });
  assert.deepEqual(m.doors, [{ x: 3, y: 2 }]);
  assert.deepEqual(loadMapJson(tiledFixture()), m, "loadMapJson detects Tiled");
  assert.deepEqual(loadMapJson({ width: 1, height: 1, tiles: [2] }).tiles, [2], "and our own format");
});

test("fromTiled: refuses compressed layers and infinite maps with a clear message", () => {
  const z = tiledFixture();
  Object.assign(z.layers[0], { compression: "zlib" });
  assert.throws(() => fromTiled(z), /compressed/);
  assert.throws(() => fromTiled({ ...tiledFixture(), infinite: true }), /infinite/);
  assert.throws(() => fromTiled({ ...tiledFixture(), orientation: "isometric" }), /isometric/);
  assert.throws(() => fromTiled({}), /not a Tiled/);
});
