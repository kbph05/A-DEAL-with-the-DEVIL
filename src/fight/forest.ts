/**
 * Forest mode, the pure part: the forest path scene (a SceneDef, src/world/scenes/forest.json) plus an encounter
 * (encounters.ts) become a `SimWorld` for `FightSim`, and the screen layout for any container size. No Phaser;
 * tested in node (forest.test.ts). The Phaser side is ForestScene.ts; the public API is `runForestFight` in index.ts.
 *
 * Units: the scene is in world pixels (backgrounds and sprites at PIXEL_SCALE world pixels per art pixel), the sim in
 * fight units. One world pixel is `UNITS_PER_PX` units; bodies are scaled by `BODY_SCALE` to match the bigger figures.
 */
import { PIXEL_SCALE } from "../render/pixelScale";
import type { Rect, SceneDef } from "../world/scene";
import type { Encounter } from "./encounters";
import { PLAYER, clampToRect, type Circle, type Vec } from "./logic";
import type { SimEnemySpawn, SimWorld } from "./sim";

/**
 * Fight units per world pixel. 3 makes the sim's player (280 units/s) about the world hero's pace (80 px/s): 93 px/s.
 * Unchanged by PIXEL_SCALE: the backgrounds didn't change scale, so crossing the scene takes as long as before.
 */
export const UNITS_PER_PX = 3;

/**
 * Body sizes in the forest (Big Chungus, 4 Oct: "make sure pixel sizes are standardized"). The sim's radii were tuned
 * to figures drawn at about one world pixel per sheet pixel (the 16 px hero); every figure is now drawn at PIXEL_SCALE
 * (src/render/pixelScale.ts), so every body radius (player and enemies) is scaled by it, and the sword's reach with
 * the player's (`swingArc`). Player: radius 16 -> 32 units (5.3 -> 10.7 px), reach 62 -> 124 units (21 -> 41 px).
 */
export const BODY_SCALE = PIXEL_SCALE;

const K = UNITS_PER_PX;
const toUnits = (r: Rect): Rect => ({ x: r.x * K, y: r.y * K, w: r.w * K, h: r.h * K });

/**
 * Which spawn point each of `n` packs takes, given `m` points ordered nearest the player first: spread from the
 * nearest one on, so the first pack is met early and the rest string out along the path. More packs than points
 * double up.
 */
export function spawnSlots(n: number, m: number): number[] {
  if (m <= 0) return [];
  return Array.from({ length: n }, (_, i) => (n <= m ? Math.floor((i * m) / n) : i % m));
}

/** The scene's spawn points, nearest the player's spawn first (along the path). No spawns: a row along the bounds. */
export function orderedSpawns(def: SceneDef): Vec[] {
  const pts = def.spawns && def.spawns.length > 0
    ? def.spawns.map((p) => ({ ...p }))
    : Array.from({ length: 5 }, (_, i) => ({ x: def.bounds.x + def.bounds.w * (0.3 + 0.13 * i), y: def.bounds.y + def.bounds.h / 2 }));
  const d = (p: Vec) => Math.hypot(p.x - def.spawn.x, p.y - def.spawn.y);
  return pts.sort((a, b) => d(a) - d(b));
}

/**
 * Packs: how the group splits along the path. One or two enemies stand apart (met one at a time, the easy end);
 * three or more come as two packs, the first one bigger, so the top of the run means fighting several at once.
 */
export function packSizes(n: number): number[] {
  if (n <= 2) return Array.from({ length: n }, () => 1);
  const first = Math.ceil(n / 2);
  return [first, n - first];
}

/**
 * How far the placeholder canopy rows reach into the bounds, world pixels (`overlayCanopies`: radius 26, centred 8 px
 * outside the top and bottom edges). Under them a body is hidden by the leaves.
 */
export const CANOPY_REACH = 18;
/** Kept clear at the top on top of that: about half an archer's height (its sprite is 24 px, feet on the circle). */
export const BAND_HEAD = 12;

/**
 * The path band: the readable middle of the path, the bounds less the strips under the canopy rows (and, at the top,
 * room for an archer's head). Skeleton archers keep to it, so one that backs off from you stays on the path instead of
 * standing in the tree line. On the designer's forest band (src/world/bandArt.ts) that is the dirt path's core
 * (forest.test.ts checks it). Bounds too short for a band give the bounds. World pixels.
 */
export function pathBand(def: SceneDef): Rect {
  const b = def.bounds;
  const top = CANOPY_REACH + BAND_HEAD, bottom = CANOPY_REACH;
  if (b.h - top - bottom < 32) return { ...b };
  return { x: b.x, y: b.y + top, w: b.w, h: b.h - top - bottom };
}

/** Where pack members stand around their spawn point, world pixels (the first on the point). Inside PACK_RANGE. */
export const PACK_OFFSETS: readonly Vec[] = [{ x: 0, y: 0 }, { x: 26, y: -22 }, { x: 26, y: 22 }, { x: 52, y: 0 }, { x: -24, y: 24 }];

/**
 * The sim world for an encounter on a scene: bounds, the player's spawn, the enemies placed in packs on the spawn
 * points (nearest the player first, in the encounter's order: slimes first, archers at the back; archers inside the
 * path band), the exit as the alarm.
 */
export function forestWorld(def: SceneDef, enc: Encounter): SimWorld {
  const spawns = orderedSpawns(def);
  const band = toUnits(pathBand(def));
  const sizes = packSizes(enc.enemies.length);
  const slots = spawnSlots(sizes.length, spawns.length);
  const enemies: SimEnemySpawn[] = [];
  let i = 0;
  sizes.forEach((size, pack) => {
    const at = spawns[slots[pack]];
    for (let k = 0; k < size; k++, i++) {
      const e = enc.enemies[i];
      const o = PACK_OFFSETS[k % PACK_OFFSETS.length];
      const pos = { x: (at.x + o.x) * K, y: (at.y + o.y) * K };
      const params = { ...e.params, radius: e.params.radius * BODY_SCALE };
      enemies.push({
        kind: e.id, name: e.name, boss: e.boss, hp: e.hp, maxHp: e.maxHp, power: e.power, params,
        pos: params.behaviour === "archer" ? clampToRect(pos, params.radius, band) : pos, // archers start on the path too
      });
    }
  });
  const exit = (def.zones ?? []).find((z) => z.kind === "exit");
  return {
    bounds: toUnits(def.bounds), band, playerSpawn: { x: def.spawn.x * K, y: def.spawn.y * K }, enemies, alarm: exit ? toUnits(exit) : undefined,
    playerRadius: PLAYER.radius * BODY_SCALE,
  };
}

/** Sim units to world pixels (positions and lengths). */
export const toPx = (v: number): number => v / K;

/**
 * The y-sort key (world pixels) of a body at sim position `pos` with radius `r`: the bottom of its feet, half a
 * radius below the centre. Sprites stand there (origin bottom centre).
 */
export const footPx = (pos: Vec, r: number): number => (pos.y + r / 2) / K;

/**
 * Where the player's sprite stands (its feet, world pixels): low enough that the visible figure, `figureH` pixels tall,
 * is centred on the sim's player centre, which is where the sword's hitbox (and its drawn arc) is anchored (kbph, 4 Oct:
 * the arc must sit on the figure). Enemies stand on `footPx`.
 */
export const playerFeetPx = (pos: Vec, figureH: number): number => pos.y / K + figureH / 2;

// ---------------------------------------------------------------------------------------------------------------
// Screen layout. Forest mode uses Phaser's RESIZE scale mode: the canvas is the container's size, re-laid out on
// every resize (a phone rotating mid-fight), so this is called again with the new size.

export interface ForestLayout {
  width: number;
  height: number;
  portrait: boolean;
  /** Camera zoom: canvas pixels per world pixel. `VIEW_SHORT` (portrait: `VIEW_SHORT_PORTRAIT`) world pixels fit across the short side. */
  zoom: number;
  /** UI scale for the HUD and the touch controls. */
  ui: number;
  stick: Circle;
  attackBtn: Circle;
  dashBtn: Circle;
}

/** World pixels across the short side of the screen in landscape (the path is 112 px wide, plus trees). */
export const VIEW_SHORT = 220;
/** In portrait the short side runs along the path, so show more of it: archers shoot from about 120 px away. */
export const VIEW_SHORT_PORTRAIT = 300;

export function forestLayout(parentW: number, parentH: number): ForestLayout {
  const width = Math.max(240, Math.round(parentW || 0) || 960);
  const height = Math.max(240, Math.round(parentH || 0) || 540);
  const short = Math.min(width, height);
  const zoom = Math.min(4, Math.max(1, short / (height > width ? VIEW_SHORT_PORTRAIT : VIEW_SHORT)));
  const s = Math.min(1.25, Math.max(0.6, short / 540));
  return {
    width, height, portrait: height > width, zoom, ui: s,
    stick: { x: 130 * s, y: height - 140 * s, r: 90 * s },
    attackBtn: { x: width - 100 * s, y: height - 110 * s, r: 70 * s },
    dashBtn: { x: width - 110 * s, y: height - 250 * s, r: 48 * s },
  };
}
