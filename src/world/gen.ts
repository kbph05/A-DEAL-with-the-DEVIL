/**
 * Small seeded field generator (a stand-in until real areas/Tiled maps exist). Deterministic: the same seed and
 * size give the same map, on any machine (mulberry32, like the act map and the fight).
 *
 * Layout: grass inside a wall border; the spawn near the bottom edge; an exit door in the top wall and usually a
 * second one in a side wall; winding dirt paths from the spawn to every door; a few ponds; a ruined stone room
 * (walls, floor, gaps); trees and rocks scattered. Paths and the spawn are never covered, so every door is
 * reachable from the spawn (tested over many seeds).
 */
import { hashSeed, mulberry32, type Rng } from "../map/rng";
import { T, type TilePos, type WorldMap } from "./tiles";

export interface GenOptions { width?: number; height?: number }

export const GEN_DEFAULTS = { width: 40, height: 30 };
const MIN_W = 16;
const MIN_H = 12;

export function generateWorld(seed: string, opts: GenOptions = {}): WorldMap {
  const W = Math.max(MIN_W, Math.min(256, Math.round(opts.width ?? GEN_DEFAULTS.width)));
  const H = Math.max(MIN_H, Math.min(256, Math.round(opts.height ?? GEN_DEFAULTS.height)));
  const rng = mulberry32(hashSeed(`world:${seed}`));
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1)); // inclusive
  const tiles = new Array<number>(W * H).fill(T.GRASS);
  const at = (x: number, y: number) => y * W + x;
  const set = (x: number, y: number, id: number) => { tiles[at(x, y)] = id; };
  const reserved = new Set<number>(); // paths, doors, the spawn and its surroundings: nothing gets placed here

  // Border.
  for (let x = 0; x < W; x++) { set(x, 0, T.WALL); set(x, H - 1, T.WALL); }
  for (let y = 0; y < H; y++) { set(0, y, T.WALL); set(W - 1, y, T.WALL); }

  // Spawn near the bottom, exits in the top wall and (most of the time) in a side wall.
  const spawn: TilePos = { x: int(3, W - 4), y: H - 3 };
  const doors: TilePos[] = [{ x: int(3, W - 4), y: 0 }];
  if (rng() < 0.75) doors.push({ x: rng() < 0.5 ? 0 : W - 1, y: int(3, H - 6) });
  for (const d of doors) { set(d.x, d.y, T.DOOR); reserved.add(at(d.x, d.y)); }
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) reserved.add(at(spawn.x + dx, spawn.y + dy));

  // Paths: spawn to the top door, then a branch off it to the side door.
  const main = walk(rng, spawn, inside(doors[0], W, H), W, H);
  for (const p of main) { set(p.x, p.y, T.PATH); reserved.add(at(p.x, p.y)); }
  if (doors[1]) {
    const from = main[int(Math.floor(main.length / 4), Math.floor((main.length * 3) / 4))];
    for (const p of walk(rng, from, inside(doors[1], W, H), W, H)) { set(p.x, p.y, T.PATH); reserved.add(at(p.x, p.y)); }
  }
  const free = (x: number, y: number) => x > 0 && y > 0 && x < W - 1 && y < H - 1 && !reserved.has(at(x, y));

  // A ruined stone room: wall ring, floor inside, a gap or two; paths running through it keep their tiles.
  const rw = int(6, Math.min(10, W - 6));
  const rh = int(5, Math.min(7, H - 6));
  const rx = int(2, W - rw - 2);
  const ry = int(2, H - rh - 4);
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      if (!free(x, y)) continue;
      const edge = x === rx || y === ry || x === rx + rw - 1 || y === ry + rh - 1;
      set(x, y, edge && rng() > 0.12 ? T.WALL : T.FLOOR); // ~1 in 8 wall tiles has crumbled
    }
  }
  // A guaranteed doorway in the middle of the bottom wall (plus the floor tile behind it).
  const gx = rx + Math.floor(rw / 2);
  for (const y of [ry + rh - 1, ry + rh - 2]) if (free(gx, y)) set(gx, y, T.FLOOR);
  for (const y of [ry + rh - 1, ry + rh - 2, ry + rh]) reserved.add(at(gx, y));
  for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) reserved.add(at(x, y));

  // Ponds: noisy discs of water.
  const ponds = int(2, 3 + Math.floor((W * H) / 900));
  for (let i = 0; i < ponds; i++) {
    const cx = int(3, W - 4);
    const cy = int(3, H - 4);
    const r = 1.4 + rng() * 2.2;
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        if (free(x, y) && Math.hypot(x - cx, (y - cy) * 1.2) <= r + (rng() - 0.5) * 0.9) set(x, y, T.WATER);
      }
    }
  }

  // Trees and rocks on the remaining grass.
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!free(x, y) || tiles[at(x, y)] !== T.GRASS) continue;
      const r = rng();
      if (r < 0.07) set(x, y, T.TREE);
      else if (r < 0.09) set(x, y, T.ROCK);
    }
  }

  return { width: W, height: H, tiles, spawn, doors, seed };
}

/** The interior tile next to a door in the border. */
function inside(d: TilePos, W: number, H: number): TilePos {
  if (d.y === 0) return { x: d.x, y: 1 };
  if (d.y === H - 1) return { x: d.x, y: H - 2 };
  if (d.x === 0) return { x: 1, y: d.y };
  return { x: W - 2, y: d.y };
}

/**
 * A winding 4-connected walk from `a` to `b` inside the border: mostly steps toward `b` along the axis with more
 * distance left, sometimes the other axis, sometimes a sideways wiggle. Capped, then finished in a straight line.
 */
function walk(rng: Rng, a: TilePos, b: TilePos, W: number, H: number): TilePos[] {
  const out: TilePos[] = [{ ...a }];
  let { x, y } = a;
  const push = () => out.push({ x, y });
  const sgn = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);
  for (let i = 0; i < (W + H) * 4 && (x !== b.x || y !== b.y); i++) {
    const dx = b.x - x;
    const dy = b.y - y;
    const r = rng();
    const xMain = Math.abs(dx) >= Math.abs(dy);
    if (r < 0.15) {
      // Wiggle across the main axis, staying inside the border.
      const s = rng() < 0.5 ? -1 : 1;
      if (xMain) y = Math.max(1, Math.min(H - 2, y + s)); else x = Math.max(1, Math.min(W - 2, x + s));
    } else if (r < 0.35 && (xMain ? dy : dx) !== 0) {
      if (xMain) y += sgn(dy); else x += sgn(dx);
    } else if (xMain) x += sgn(dx);
    else y += sgn(dy);
    push();
  }
  while (x !== b.x) { x += sgn(b.x - x); push(); }
  while (y !== b.y) { y += sgn(b.y - y); push(); }
  return out;
}
