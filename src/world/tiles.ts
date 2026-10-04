/**
 * Tile ids, the map shape and tile lookups. Pure (no Phaser), tested in node. A map is a row-major grid of tile ids;
 * the same ids index the tileset image (id = frame index), so a Tiled map drawn on our tileset loads as it is.
 */
export const TILE_SIZE = 16;

export const T = {
  VOID: 0,
  FLOOR: 1,
  GRASS: 2,
  PATH: 3,
  WALL: 4,
  WATER: 5,
  DOOR: 6,
  TREE: 7,
  ROCK: 8,
} as const;
export type TileId = (typeof T)[keyof typeof T];

export interface TileDef { id: TileId; name: string; blocks: boolean }

/** Index = tile id. `blocks`: the player can't walk onto it (the collision layer). */
export const TILES: readonly TileDef[] = [
  { id: T.VOID, name: "void", blocks: true },
  { id: T.FLOOR, name: "floor", blocks: false },
  { id: T.GRASS, name: "grass", blocks: false },
  { id: T.PATH, name: "path", blocks: false },
  { id: T.WALL, name: "wall", blocks: true },
  { id: T.WATER, name: "water", blocks: true },
  { id: T.DOOR, name: "door", blocks: false },
  { id: T.TREE, name: "tree", blocks: true },
  { id: T.ROCK, name: "rock", blocks: true },
];
export const TILE_COUNT = TILES.length;
export const BLOCKING_IDS: number[] = TILES.filter((t) => t.blocks).map((t) => t.id);

const BY_NAME = new Map(TILES.map((t) => [t.name, t.id]));
export const tileIdByName = (name: string): TileId | undefined => BY_NAME.get(name.trim().toLowerCase());
export const tileName = (id: number): string => TILES[id]?.name ?? "void";

export interface TilePos { x: number; y: number }

/** A world map: our own JSON format (docs/world.md), also what the Tiled loader and the generator produce. */
export interface WorldMap {
  width: number;
  height: number;
  /** Row-major tile ids, `width * height` long: tile (x, y) is `tiles[y * width + x]`. */
  tiles: number[];
  /** Spawn tile. */
  spawn: TilePos;
  /** Exit tiles (DOOR), in a stable order; later linked to nodes of the act DAG. */
  doors: TilePos[];
  /** The seed it was generated from, if any. */
  seed?: string;
}

export const inBounds = (m: Pick<WorldMap, "width" | "height">, x: number, y: number): boolean =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < m.width && y < m.height;

/** Tile id at (x, y); outside the map it is VOID. */
export const tileAt = (m: WorldMap, x: number, y: number): number => (inBounds(m, x, y) ? m.tiles[y * m.width + x] : T.VOID);

export const isBlockingId = (id: number): boolean => TILES[id]?.blocks ?? true;

/** Can the player stand on tile (x, y)? Outside the map: no. Unknown ids block. */
export const isBlocked = (m: WorldMap, x: number, y: number): boolean => isBlockingId(tileAt(m, x, y));

/** World pixel to tile coordinate. */
export const toTile = (px: number, size = TILE_SIZE): number => Math.floor(px / size);
/** Tile coordinate to the world pixel of its centre. */
export const tileCenter = (t: number, size = TILE_SIZE): number => t * size + size / 2;

/** Map as rows of ids (Phaser's `make.tilemap({ data })` shape). */
export function toRows(m: WorldMap): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < m.height; y++) rows.push(m.tiles.slice(y * m.width, (y + 1) * m.width));
  return rows;
}

/** Tiles reachable from `from` on foot (4-neighbour flood fill), as a set of `y * width + x` indexes. */
export function reachable(m: WorldMap, from: TilePos): Set<number> {
  const seen = new Set<number>();
  if (isBlocked(m, from.x, from.y)) return seen;
  const queue = [from];
  seen.add(from.y * m.width + from.x);
  while (queue.length) {
    const p = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = p.x + dx;
      const y = p.y + dy;
      const k = y * m.width + x;
      if (!seen.has(k) && !isBlocked(m, x, y)) { seen.add(k); queue.push({ x, y }); }
    }
  }
  return seen;
}

/**
 * Check and normalise a map from JSON (our own format). Throws a readable Error on anything malformed; unknown tile
 * ids become VOID; a blocked or missing spawn falls back to the first walkable tile; doors are recomputed from the grid.
 */
export function parseWorldMap(json: unknown): WorldMap {
  const o = json as Partial<WorldMap> | null;
  if (!o || typeof o !== "object") throw new Error("world map: not an object");
  const { width, height, tiles } = o;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width! < 1 || height! < 1 || width! * height! > 1 << 20) throw new Error("world map: width and height must be positive integers");
  if (!Array.isArray(tiles) || tiles.length !== width! * height!) throw new Error(`world map: tiles must be an array of width * height (${width! * height!}) ids`);
  const clean = tiles.map((t) => (Number.isInteger(t) && t >= 0 && t < TILE_COUNT ? t : T.VOID));
  const m: WorldMap = { width: width!, height: height!, tiles: clean, spawn: { x: 0, y: 0 }, doors: [] };
  if (typeof o.seed === "string") m.seed = o.seed;
  m.doors = findTiles(m, T.DOOR);
  const s = o.spawn;
  m.spawn = s && inBounds(m, s.x, s.y) && !isBlocked(m, s.x, s.y) ? { x: s.x, y: s.y } : firstWalkable(m);
  return m;
}

export function findTiles(m: WorldMap, id: number): TilePos[] {
  const out: TilePos[] = [];
  for (let i = 0; i < m.tiles.length; i++) if (m.tiles[i] === id) out.push({ x: i % m.width, y: Math.floor(i / m.width) });
  return out;
}

export function firstWalkable(m: WorldMap): TilePos {
  const i = m.tiles.findIndex((t) => !isBlockingId(t));
  if (i < 0) throw new Error("world map: no walkable tile");
  return { x: i % m.width, y: Math.floor(i / m.width) };
}
