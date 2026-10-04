/**
 * Tiled (mapeditor.org) JSON loader: an orthogonal, finite map exported as JSON (.tmj) becomes a `WorldMap`.
 *
 * - Tile layers are merged top-down: in each cell the topmost non-empty tile wins.
 * - A gid maps to our tile id through the tileset that owns it (the one with the largest `firstgid` <= gid): a
 *   tile property `kind` (e.g. "wall", "water") names the id; without one, the tile's index in the tileset is the
 *   id (draw maps on our tileset image, whose frames are in id order). Flip/rotation bits are ignored.
 * - Layer data may be a plain array or uncompressed base64. Compressed (zlib/gzip/zstd) and infinite maps are refused
 *   with a clear error: re-export with "Tile Layer Format: CSV" or "Base64 (uncompressed)" and "Infinite" off.
 * - The spawn is an object named or typed "spawn" in any object layer (pixel position, converted to a tile).
 *   Doors are the DOOR tiles. Pure, no Phaser.
 */
import { T, TILE_COUNT, TILE_SIZE, parseWorldMap, tileIdByName, type WorldMap } from "./tiles";

interface TiledProperty { name: string; type?: string; value: unknown }
interface TiledTile { id: number; type?: string; class?: string; properties?: TiledProperty[] }
interface TiledTileset { firstgid: number; source?: string; tiles?: TiledTile[]; tilecount?: number }
interface TiledObject { name?: string; type?: string; class?: string; x: number; y: number; gid?: number; height?: number }
interface TiledLayer {
  type: string;
  name?: string;
  visible?: boolean;
  width?: number;
  height?: number;
  data?: number[] | string;
  encoding?: string;
  compression?: string;
  objects?: TiledObject[];
  layers?: TiledLayer[];
}
export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  orientation?: string;
  infinite?: boolean;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
}

const FLIP_MASK = 0x1fffffff; // clears the horizontal/vertical/diagonal (and hex 120) flip bits

export function fromTiled(json: unknown): WorldMap {
  const m = json as TiledMap;
  if (!m || typeof m !== "object" || !Array.isArray(m.layers)) throw new Error("Tiled map: not a Tiled JSON map (no layers)");
  if (m.infinite) throw new Error("Tiled map: infinite maps are not supported; untick Map > Map Properties > Infinite");
  if (m.orientation && m.orientation !== "orthogonal") throw new Error(`Tiled map: ${m.orientation} maps are not supported; use orthogonal`);
  const W = m.width;
  const H = m.height;
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 1 || H < 1) throw new Error("Tiled map: bad width/height");

  const tilesets = [...(m.tilesets ?? [])].sort((a, b) => b.firstgid - a.firstgid); // largest firstgid first
  const kindCache = new Map<number, number>();
  const idOf = (rawGid: number): number => {
    const gid = (rawGid >>> 0) & FLIP_MASK;
    if (gid === 0) return -1;
    const hit = kindCache.get(gid);
    if (hit !== undefined) return hit;
    const ts = tilesets.find((t) => t.firstgid <= gid);
    let id: number = T.VOID;
    if (ts) {
      const index = gid - ts.firstgid;
      const tile = ts.tiles?.find((t) => t.id === index);
      const kind = tile?.properties?.find((p) => p.name === "kind")?.value ?? tile?.type ?? tile?.class;
      const named = typeof kind === "string" ? tileIdByName(kind) : undefined;
      id = named ?? (index < TILE_COUNT ? index : T.VOID);
    }
    kindCache.set(gid, id);
    return id;
  };

  const tiles = new Array<number>(W * H).fill(-1);
  const objects: TiledObject[] = [];
  const visit = (layers: TiledLayer[]) => {
    for (const layer of layers) {
      if (layer.visible === false) continue;
      if (layer.type === "group") visit(layer.layers ?? []);
      else if (layer.type === "objectgroup") objects.push(...(layer.objects ?? []));
      else if (layer.type === "tilelayer") {
        const data = layerData(layer, W * H);
        for (let i = 0; i < W * H; i++) {
          const id = idOf(data[i] ?? 0);
          if (id >= 0) tiles[i] = id; // later (higher) layers overwrite
        }
      }
    }
  };
  visit(m.layers);

  const tw = m.tilewidth || TILE_SIZE;
  const th = m.tileheight || TILE_SIZE;
  const spawnObj = objects.find((o) => [o.name, o.type, o.class].some((s) => typeof s === "string" && s.toLowerCase() === "spawn"));
  // Tile objects (with a gid) are anchored at their bottom-left corner; points and rectangles at the top-left.
  const spawn = spawnObj
    ? { x: Math.floor(spawnObj.x / tw), y: Math.floor((spawnObj.gid ? spawnObj.y - 1 : spawnObj.y) / th) }
    : undefined;
  return parseWorldMap({ width: W, height: H, tiles: tiles.map((t) => (t < 0 ? T.VOID : t)), spawn });
}

function layerData(layer: TiledLayer, n: number): ArrayLike<number> {
  if (Array.isArray(layer.data)) return layer.data;
  if (typeof layer.data === "string") {
    if (layer.compression) throw new Error(`Tiled map: layer "${layer.name ?? "?"}" is ${layer.compression}-compressed; export as CSV or uncompressed base64`);
    if (layer.encoding !== "base64") throw new Error(`Tiled map: layer "${layer.name ?? "?"}" has unknown encoding ${layer.encoding ?? "(none)"}`);
    const bytes = base64Bytes(layer.data);
    if (bytes.length < n * 4) throw new Error(`Tiled map: layer "${layer.name ?? "?"}" is too short`);
    const out = new Array<number>(n);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < n; i++) out[i] = view.getUint32(i * 4, true);
    return out;
  }
  throw new Error(`Tiled map: tile layer "${layer.name ?? "?"}" has no data (infinite maps use chunks; not supported)`);
}

function base64Bytes(s: string): Uint8Array {
  const bin = atob(s.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Either format: our own map JSON (`tiles` array) or a Tiled export (`layers`). */
export function loadMapJson(json: unknown): WorldMap {
  return json && typeof json === "object" && "layers" in json ? fromTiled(json) : parseWorldMap(json);
}
