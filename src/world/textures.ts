/**
 * Placeholder art for the world: black-and-white labelled textures (see ../render/placeholder.ts), standing in
 * until the team's own textures exist. A 16×16 tileset in tile-id order and a 16×16 hero with four facings and
 * three columns (stand / step A / step B). Real art in public/assets/private/ replaces these (see assets.ts).
 */
import type Phaser from "phaser";
import { placeholderSheet } from "../render/placeholder";
import { T, TILE_COUNT, TILE_SIZE } from "./tiles";
import type { Facing } from "./logic";

export const PLACEHOLDER_TILES = "world-tiles";
export const PLACEHOLDER_HERO = "world-hero";
/** Hero sheet: rows in `HERO_ROWS` order, columns stand / step A / step B. */
export const HERO_ROWS: readonly Facing[] = ["down", "left", "right", "up"];
export const HERO_COLS = 3;
export const HERO_SIZE = 16;

/** Tile labels by tile id: 1-3 letters, so they fit at 16 px. */
export const TILE_LABELS: Readonly<Record<number, string>> = {
  [T.VOID]: "VD", [T.FLOOR]: "FLR", [T.GRASS]: "GRS", [T.PATH]: "PTH", [T.WALL]: "WAL",
  [T.WATER]: "WTR", [T.DOOR]: "DR", [T.TREE]: "TRE", [T.ROCK]: "RK",
};
/** Tiles drawn black-on-white inverted: the ones you can't walk through and the void, so they read at a glance. */
const DARK_TILES: ReadonlySet<number> = new Set([T.VOID, T.WALL, T.WATER]);
const FACING_MARK: Readonly<Record<Facing, string>> = { down: "↓", left: "←", right: "→", up: "↑" };

export function ensurePlaceholderTextures(scene: Phaser.Scene): void {
  const tiles = Array.from({ length: TILE_COUNT }, (_, id) => TILE_LABELS[id] ?? "?");
  placeholderSheet(scene, PLACEHOLDER_TILES, TILE_SIZE, TILE_SIZE, TILE_COUNT, tiles, (id) => ({ invert: DARK_TILES.has(id) }));
  // The player is inverted so it stands out from the (mostly white) ground. Every column of a facing shares its label.
  const hero = HERO_ROWS.flatMap((f) => Array.from({ length: HERO_COLS }, () => `P${FACING_MARK[f]}`));
  placeholderSheet(scene, PLACEHOLDER_HERO, HERO_SIZE, HERO_SIZE, HERO_COLS, hero, () => ({ invert: true }));
}
