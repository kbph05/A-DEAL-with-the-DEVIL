/**
 * Placeholder art, drawn in code onto canvas textures (no image files, no generative models): a 16×16 tileset in
 * tile-id order and a 16×16 hero with four facings and a two-step walk.
 */
import type Phaser from "phaser";
import { mulberry32 } from "../map/rng";
import { T, TILE_COUNT, TILE_SIZE } from "./tiles";
import type { Facing } from "./logic";

export const PLACEHOLDER_TILES = "world-tiles";
export const PLACEHOLDER_HERO = "world-hero";
/** Hero sheet: rows in `HERO_ROWS` order, columns stand / step A / step B. */
export const HERO_ROWS: readonly Facing[] = ["down", "left", "right", "up"];
export const HERO_COLS = 3;
export const HERO_SIZE = 16;

type Ctx = CanvasRenderingContext2D;
const S = TILE_SIZE;

export function ensurePlaceholderTextures(scene: Phaser.Scene): void {
  const tm = scene.textures;
  if (!tm.exists(PLACEHOLDER_TILES)) {
    const tex = tm.createCanvas(PLACEHOLDER_TILES, S * TILE_COUNT, S)!;
    const ctx = tex.getContext();
    for (let id = 0; id < TILE_COUNT; id++) drawTile(ctx, id, id * S);
    tex.refresh();
  }
  if (!tm.exists(PLACEHOLDER_HERO)) {
    const tex = tm.createCanvas(PLACEHOLDER_HERO, HERO_SIZE * HERO_COLS, HERO_SIZE * HERO_ROWS.length)!;
    const ctx = tex.getContext();
    HERO_ROWS.forEach((f, row) => { for (let col = 0; col < HERO_COLS; col++) drawHero(ctx, f, col, col * HERO_SIZE, row * HERO_SIZE); });
    tex.refresh();
    for (let i = 0; i < HERO_COLS * HERO_ROWS.length; i++) tex.add(i, 0, (i % HERO_COLS) * HERO_SIZE, Math.floor(i / HERO_COLS) * HERO_SIZE, HERO_SIZE, HERO_SIZE);
  }
}

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Speckle a tile with a few shades (seeded by tile id, so it looks the same every time). */
function speckle(ctx: Ctx, ox: number, seed: number, colors: string[], count: number): void {
  const r = mulberry32(seed);
  for (let i = 0; i < count; i++) rect(ctx, ox + Math.floor(r() * S), Math.floor(r() * S), 1, 1, colors[Math.floor(r() * colors.length)]);
}

function grass(ctx: Ctx, ox: number, seed = 7): void {
  rect(ctx, ox, 0, S, S, "#3f7a3a");
  speckle(ctx, ox, seed, ["#4f8f45", "#356b31", "#5a9c4c"], 26);
}

function drawTile(ctx: Ctx, id: number, ox: number): void {
  switch (id) {
    case T.VOID:
      rect(ctx, ox, 0, S, S, "#0b0707");
      break;
    case T.FLOOR:
      rect(ctx, ox, 0, S, S, "#6d6672");
      for (const y of [0, 8]) rect(ctx, ox, y, S, 1, "#4f4954");
      rect(ctx, ox + 4, 1, 1, 7, "#4f4954");
      rect(ctx, ox + 12, 9, 1, 7, "#4f4954");
      speckle(ctx, ox, 11, ["#7a737f", "#625b66"], 12);
      break;
    case T.GRASS:
      grass(ctx, ox);
      for (const [x, y] of [[3, 4], [11, 9], [6, 13]]) { rect(ctx, ox + x, y, 1, 2, "#6aab55"); rect(ctx, ox + x + 1, y - 1, 1, 2, "#6aab55"); }
      break;
    case T.PATH:
      rect(ctx, ox, 0, S, S, "#9b7c52");
      speckle(ctx, ox, 13, ["#8a6c45", "#ad8e62", "#7d6140"], 30);
      break;
    case T.WALL:
      rect(ctx, ox, 0, S, S, "#3a2a24");
      for (let row = 0; row < 4; row++) {
        const shift = row % 2 ? 4 : 0;
        for (let x = -shift; x < S; x += 8) {
          const x0 = Math.max(0, x);
          const x1 = Math.min(S, x + 7);
          rect(ctx, ox + x0, row * 4, x1 - x0, 3, row === 0 ? "#8a5d48" : "#74503f");
          rect(ctx, ox + x0, row * 4, x1 - x0, 1, "#946a54");
        }
      }
      break;
    case T.WATER:
      rect(ctx, ox, 0, S, S, "#2c5c98");
      for (const [x, y] of [[2, 3], [9, 7], [4, 12]]) rect(ctx, ox + x, y, 4, 1, "#5b8fd0");
      speckle(ctx, ox, 17, ["#28538a", "#3468a8"], 14);
      break;
    case T.DOOR:
      rect(ctx, ox, 0, S, S, "#3a2a24");
      rect(ctx, ox + 2, 1, 12, 15, "#1a100b"); // frame opening
      rect(ctx, ox + 3, 2, 10, 14, "#7a4a22");
      for (const x of [6, 9]) rect(ctx, ox + x, 2, 1, 14, "#5d3718");
      rect(ctx, ox + 3, 2, 10, 1, "#9a6532");
      rect(ctx, ox + 11, 9, 1, 1, "#f2d36b"); // knob
      break;
    case T.TREE:
      grass(ctx, ox, 21);
      rect(ctx, ox + 3, 13, 10, 2, "rgba(0,0,0,0.3)"); // shadow
      rect(ctx, ox + 7, 10, 2, 4, "#5b3b22"); // trunk
      rect(ctx, ox + 3, 2, 10, 9, "#25562a");
      rect(ctx, ox + 2, 4, 12, 5, "#25562a");
      rect(ctx, ox + 5, 1, 6, 1, "#25562a");
      rect(ctx, ox + 4, 3, 4, 2, "#3a7a3a");
      rect(ctx, ox + 9, 5, 3, 2, "#2f6b32");
      break;
    case T.ROCK:
      grass(ctx, ox, 23);
      rect(ctx, ox + 3, 12, 11, 2, "rgba(0,0,0,0.3)");
      rect(ctx, ox + 3, 6, 10, 7, "#7d7a80");
      rect(ctx, ox + 4, 4, 8, 2, "#7d7a80");
      rect(ctx, ox + 5, 5, 4, 2, "#a19ea5");
      rect(ctx, ox + 3, 11, 10, 2, "#5e5b62");
      break;
    default:
      rect(ctx, ox, 0, S, S, "#ff00ff");
  }
}

const HERO = { skin: "#f1c27d", hair: "#5a3825", tunic: "#3a6fd8", tunicDark: "#2a52a6", belt: "#3b2a1a", legs: "#3b3346", eye: "#1a1010", shadow: "rgba(0,0,0,0.3)" };

/** One 16×16 hero frame. `col` 0 = stand, 1 and 2 = the two steps (legs apart, body up a pixel: the bob). */
function drawHero(ctx: Ctx, f: Facing, col: number, ox: number, oy: number): void {
  const p = (x: number, y: number, w: number, h: number, c: string) => rect(ctx, ox + x, oy + y, w, h, c);
  const lift = col === 0 ? 0 : -1;
  p(4, 14, 8, 2, HERO.shadow);
  // Legs: side-on they scissor, front/back one leg lifts.
  if (f === "left" || f === "right") {
    const a = col === 1 ? -1 : col === 2 ? 1 : 0;
    p(7 + a, 11, 2, 3, HERO.legs);
    p(7 - a, 11, 2, 3, HERO.legs);
  } else {
    p(5, 11 + (col === 1 ? -1 : 0), 2, 3, HERO.legs);
    p(9, 11 + (col === 2 ? -1 : 0), 2, 3, HERO.legs);
  }
  const y = lift;
  // Body.
  p(5, 7 + y, 6, 5, HERO.tunic);
  p(5, 10 + y, 6, 1, HERO.belt);
  if (f === "up") p(5, 7 + y, 6, 1, HERO.tunicDark);
  // Arms swing opposite to the legs.
  const swing = col === 1 ? 1 : col === 2 ? -1 : 0;
  if (f === "left" || f === "right") p(f === "left" ? 7 + swing : 8 - swing, 8 + y, 1, 3, HERO.skin);
  else { p(4, 8 + y + swing, 1, 3, HERO.skin); p(11, 8 + y - swing, 1, 3, HERO.skin); }
  // Head.
  p(5, 2 + y, 6, 5, HERO.skin);
  p(5, 1 + y, 6, 2, HERO.hair);
  if (f === "up") p(5, 1 + y, 6, 5, HERO.hair);
  else if (f === "down") { p(4, 2 + y, 1, 3, HERO.hair); p(11, 2 + y, 1, 3, HERO.hair); p(6, 4 + y, 1, 1, HERO.eye); p(9, 4 + y, 1, 1, HERO.eye); }
  else if (f === "left") { p(8, 1 + y, 4, 4, HERO.hair); p(6, 4 + y, 1, 1, HERO.eye); }
  else { p(4, 1 + y, 4, 4, HERO.hair); p(9, 4 + y, 1, 1, HERO.eye); }
}
