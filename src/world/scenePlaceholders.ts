/**
 * Placeholder art for scenes, in the generated pixel-art style (no image files, no generative models):
 * - the background: the seeded tile generator (gen.ts) laid over the scene, rendered with the placeholder tileset
 *   (textures.ts) into one large texture. Inside `bounds` everything is walkable-looking ground; outside is trees,
 *   walls and water; exits are dirt, triggers stone floor. Big trees get their trunks here.
 * - the overlay: transparent except tree canopies (a row along the bottom edge and the big trees), drawn above
 *   actors, so the player walks under them.
 * - actors: a 16×24 pixel figure, coloured by id; or, by id prefix, a market stall ("stall-…", 40×36) or a
 *   cottage ("house-…", 64×56).
 * The tile grid and canopy layout are pure (tested); only the drawing needs a canvas. Real art in
 * public/assets/private/scenes/<id>/ replaces these (docs/world.md).
 */
import type Phaser from "phaser";
import { hashSeed, mulberry32 } from "../map/rng";
import { generateWorld } from "./gen";
import { pointIn, type SceneDef } from "./scene";
import { PLACEHOLDER_TILES, ensurePlaceholderTextures } from "./textures";
import { T, TILE_SIZE, isBlockingId, tileAt } from "./tiles";

const S = TILE_SIZE;

/** The placeholder tile grid for a scene: `width × height` tiles covering `size`, row-major. Pure, seeded by id. */
export function sceneTiles(def: SceneDef): { width: number; height: number; tiles: number[] } {
  const width = Math.ceil(def.size.w / S);
  const height = Math.ceil(def.size.h / S);
  const base = generateWorld(def.id, { width, height });
  const tiles: number[] = [];
  // A scene with shops gets dirt paths: from the spawn along its row, then up or down to each shop and exit.
  const shops = (def.zones ?? []).some((z) => z.kind === "shop");
  const legs: Array<{ x: number; y: number; w: number; h: number }> = [];
  if (shops) {
    for (const z of def.zones ?? []) {
      if (z.kind !== "shop" && z.kind !== "exit") continue;
      const cx = z.x + z.w / 2, cy = z.y + z.h / 2, sx = def.spawn.x, sy = def.spawn.y;
      legs.push({ x: Math.min(sx, cx) - S, y: sy - S, w: Math.abs(cx - sx) + 2 * S, h: 2 * S });
      legs.push({ x: cx - S, y: Math.min(sy, cy) - S, w: 2 * S, h: Math.abs(cy - sy) + 2 * S });
    }
  }
  // Stalls and cottages whose feet are outside bounds: their footprint plus a margin.
  const clearings = (def.actors ?? [])
    .filter((a) => actorShape(a.id) !== "figure" && !pointIn(a, def.bounds))
    .map((a) => {
      const sz = actorShape(a.id) === "stall" ? STALL_SIZE : HOUSE_SIZE;
      return { x: a.x - sz.w / 2 - S, y: a.y - sz.h - S, w: sz.w + 2 * S, h: sz.h + S + 1 };
    });
  const onPath = (c: { x: number; y: number }) => pointIn(c, def.bounds) && legs.some((r) => pointIn(c, r));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = { x: x * S + S / 2, y: y * S + S / 2 };
      let id = tileAt(base, x, y);
      if (pointIn(c, def.bounds)) id = isBlockingId(id) || id === T.DOOR ? T.GRASS : id;
      else id = id === T.WALL || id === T.WATER ? id : T.TREE;
      if (onPath(c)) id = T.PATH;
      // A building outside the playable rect (a shopfront on the edge) stands in a small clearing, not in the forest.
      if (clearings.some((r) => pointIn(c, r))) id = T.GRASS;
      const zone = (def.zones ?? []).find((z) => pointIn(c, z));
      if (zone) id = zone.kind === "exit" ? T.PATH : T.FLOOR;
      tiles.push(id);
    }
  }
  return { width, height, tiles };
}

export interface Canopy { x: number; y: number; r: number; trunk: boolean }

/**
 * Tree canopies for the overlay: a row along the bottom edge of the playable rect (overlapping it, so walking down
 * goes under the leaves; gaps over exit zones), and one big tree inside the rect at about 3/4 of its width (its trunk is on the
 * background). Pure.
 */
export function overlayCanopies(def: SceneDef): Canopy[] {
  const b = def.bounds;
  const out: Canopy[] = [];
  const r = 26;
  const rowY = b.y + b.h + r - 18;
  // Leave gaps over exits, so the way out stays visible.
  const exits = (def.zones ?? []).filter((z) => z.kind === "exit");
  const overExit = (x: number) => exits.some((z) => x + r > z.x && x - r < z.x + z.w && rowY - r < z.y + z.h && rowY + r > z.y);
  for (let x = r / 2; x < def.size.w + r; x += 2 * r - 6) if (!overExit(x)) out.push({ x, y: rowY, r, trunk: false });
  out.push({ x: Math.round(b.x + b.w * 0.78), y: Math.round(b.y + b.h * 0.3), r: 40, trunk: true });
  return out;
}

const LEAF = { dark: "#1d4421", base: "#25562a", mid: "#2f6b32", light: "#3a7a3a" };

function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number): { tex: Phaser.Textures.CanvasTexture; ctx: CanvasRenderingContext2D } {
  const tex = scene.textures.createCanvas(key, w, h)!;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  return { tex, ctx };
}

/** The background placeholder for `def`, under `key` (made once). */
export function backgroundPlaceholder(scene: Phaser.Scene, key: string, def: SceneDef): void {
  if (scene.textures.exists(key)) return;
  ensurePlaceholderTextures(scene);
  const sheet = scene.textures.get(PLACEHOLDER_TILES).getSourceImage() as CanvasImageSource;
  const { tex, ctx } = canvasTexture(scene, key, def.size.w, def.size.h);
  const grid = sceneTiles(def);
  grid.tiles.forEach((id, i) => {
    const x = (i % grid.width) * S;
    const y = Math.floor(i / grid.width) * S;
    ctx.drawImage(sheet, id * S, 0, S, S, x, y, S, S);
  });
  // Trunks of the big trees (their canopies are on the overlay).
  for (const c of overlayCanopies(def)) {
    if (!c.trunk) continue;
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(c.x - 14, c.y + c.r - 4, 28, 6);
    ctx.fillStyle = "#5b3b22";
    ctx.fillRect(c.x - 5, c.y, 10, c.r);
    ctx.fillStyle = "#4a2f1a";
    ctx.fillRect(c.x + 2, c.y, 3, c.r);
  }
  tex.refresh();
}

/** One pixel-art canopy: a blob in 2-px cells, darker rim, seeded speckle. */
function drawCanopy(ctx: CanvasRenderingContext2D, c: Canopy, seed: number): void {
  const rng = mulberry32(seed);
  const cell = 2;
  for (let dy = -c.r; dy <= c.r; dy += cell) {
    for (let dx = -c.r; dx <= c.r; dx += cell) {
      const d = Math.hypot(dx, dy) / c.r;
      const wobble = 0.9 + 0.1 * Math.sin((Math.atan2(dy, dx) * 5) + seed);
      if (d > wobble) continue;
      const r = rng();
      ctx.fillStyle = d > wobble - 0.12 ? LEAF.dark : dy < -c.r * 0.3 && r < 0.35 ? LEAF.light : r < 0.25 ? LEAF.mid : LEAF.base;
      ctx.fillRect(Math.round(c.x + dx), Math.round(c.y + dy), cell, cell);
    }
  }
}

/** The overlay placeholder for `def`, under `key` (made once): transparent except the tree canopies. */
export function overlayPlaceholder(scene: Phaser.Scene, key: string, def: SceneDef): void {
  if (scene.textures.exists(key)) return;
  const { tex, ctx } = canvasTexture(scene, key, def.size.w, def.size.h);
  ctx.clearRect(0, 0, def.size.w, def.size.h);
  overlayCanopies(def).forEach((c, i) => drawCanopy(ctx, c, hashSeed(`${def.id}:canopy:${i}`)));
  tex.refresh();
}

/** Actor placeholder size, world pixels (feet at the bottom centre). */
export const ACTOR_SIZE = { w: 16, h: 24 };

const ROBES = ["#a83232", "#6b3fa0", "#8a6a3a", "#3f6f8a", "#5a7a3a", "#7a3a5a"];

/** Which placeholder an actor id gets: "stall-…" a market stall, "house-…" a cottage, anything else a figure. Pure. */
export function actorShape(id: string): "stall" | "house" | "figure" {
  return id.startsWith("stall-") ? "stall" : id.startsWith("house-") ? "house" : "figure";
}

export const STALL_SIZE = { w: 40, h: 36 };
export const HOUSE_SIZE = { w: 64, h: 56 };

const AWNINGS = ["#b83a3a", "#3a6fb8", "#c9a227", "#3a8a5a", "#8a3ab8"];

/** A market stall: striped awning on two posts, a seller behind a wooden counter. Colours seeded by `id`. */
function drawStall(ctx: CanvasRenderingContext2D, id: string): void {
  const p = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const awning = AWNINGS[hashSeed(id) % AWNINGS.length];
  const robe = ROBES[hashSeed(`${id}:seller`) % ROBES.length];
  p(2, 33, 36, 3, "rgba(0,0,0,0.3)"); // shadow
  p(4, 8, 3, 26, "#5b3b22"); // posts
  p(33, 8, 3, 26, "#5b3b22");
  // Seller behind the counter.
  p(15, 13, 10, 10, robe);
  p(16, 7, 8, 7, "#f1c27d");
  p(15, 6, 10, 3, "#2a1d14");
  p(18, 10, 1, 1, "#1a1010");
  p(21, 10, 1, 1, "#1a1010");
  // Counter with wares.
  p(3, 22, 34, 11, "#7a5230");
  p(3, 22, 34, 2, "#9a6a40");
  p(3, 31, 34, 2, "#4a2f1a");
  for (let i = 0; i < 4; i++) p(7 + i * 7, 19, 4, 3, i % 2 ? "#d8c070" : "#c05050");
  // Striped awning with a scalloped edge.
  for (let x = 0; x < 40; x += 4) p(x, 0, 4, 7, (x / 4) % 2 ? "#f3e8d8" : awning);
  for (let x = 0; x < 40; x += 4) p(x + 1, 7, 2, 2, (x / 4) % 2 ? "#f3e8d8" : awning);
  p(0, 0, 40, 1, "rgba(0,0,0,0.25)");
}

/** A small cottage: stone walls, a door and window, a dark pitched roof. */
function drawHouse(ctx: CanvasRenderingContext2D, id: string): void {
  const p = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const roof = ["#5a2a2a", "#3a3a4a", "#4a3a22"][hashSeed(id) % 3];
  p(4, 52, 56, 4, "rgba(0,0,0,0.3)");
  p(8, 26, 48, 27, "#8a8070"); // walls
  for (let y = 28; y < 52; y += 6) for (let x = 8 + ((y / 6) % 2) * 4; x < 56; x += 8) p(x, y, 7, 1, "#6f665a");
  p(26, 36, 12, 17, "#4a2f1a"); // door
  p(27, 37, 10, 16, "#5b3b22");
  p(35, 45, 1, 2, "#d8c070");
  p(13, 33, 9, 8, "#2a1d14"); // windows
  p(14, 34, 7, 6, "#e0b050");
  p(42, 33, 9, 8, "#2a1d14");
  p(43, 34, 7, 6, "#e0b050");
  // Roof: a stepped triangle.
  for (let i = 0; i < 14; i++) p(Math.round(28 - i * 2.4), 4 + i * 2, Math.round(8 + i * 4.8), 2, i % 3 === 0 ? "#2a1414" : roof);
  p(4, 30, 56, 2, "#2a1414");
  p(44, 6, 6, 12, "#6f665a"); // chimney
}

/** A 16×24 pixel figure in a robe, coloured by `id`, under `key` (made once); stalls and houses by id prefix. */
export function actorPlaceholder(scene: Phaser.Scene, key: string, id: string): void {
  if (scene.textures.exists(key)) return;
  const shape = actorShape(id);
  if (shape !== "figure") {
    const size = shape === "stall" ? STALL_SIZE : HOUSE_SIZE;
    const { tex, ctx } = canvasTexture(scene, key, size.w, size.h);
    (shape === "stall" ? drawStall : drawHouse)(ctx, id);
    tex.refresh();
    return;
  }
  const { tex, ctx } = canvasTexture(scene, key, ACTOR_SIZE.w, ACTOR_SIZE.h);
  const robe = ROBES[hashSeed(id) % ROBES.length];
  const p = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  p(3, 22, 10, 2, "rgba(0,0,0,0.3)"); // shadow
  p(4, 10, 8, 12, robe); // robe
  p(3, 16, 10, 6, robe);
  p(4, 10, 8, 1, "rgba(255,255,255,0.2)");
  p(7, 11, 2, 9, "rgba(0,0,0,0.2)"); // fold
  p(2, 12, 2, 5, "#f1c27d"); // hands
  p(12, 12, 2, 5, "#f1c27d");
  p(5, 3, 6, 6, "#f1c27d"); // head
  p(4, 1, 8, 3, "#2a1d14"); // hood
  p(4, 3, 1, 5, "#2a1d14");
  p(11, 3, 1, 5, "#2a1d14");
  p(6, 5, 1, 1, "#1a1010"); // eyes
  p(9, 5, 1, 1, "#1a1010");
  tex.refresh();
}
