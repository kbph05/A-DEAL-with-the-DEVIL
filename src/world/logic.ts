/**
 * World scene rules that don't need Phaser: walking speed and smoothing, facing, the screen layout. Tested in node.
 * Distances are world pixels, times are seconds. The scene model itself (SceneDef, y-sort, zones) is in scene.ts.
 */
import { norm, type Vec } from "../input/dir";
import { TILE_SIZE } from "./tiles";

/** Village walking speed, px/s (5 placeholder tiles a second). Constant while a direction is held: no ramp, no walk-then-run. */
export const WORLD_SPEED = 5 * TILE_SIZE;

export const WALK = {
  speed: WORLD_SPEED,
  /** Below this speed (px/s) the walk animation stops. */
  animMin: 8,
};

/** The player's collision box, world pixels, relative to the 16×16 placeholder sprite's top-left: the feet. */
export const FEET = { w: 10, h: 6, x: 3, y: 10 };

/**
 * The player's velocity for this frame: `dir * speed`, at once. `dir` is normalised first, so diagonals are not faster
 * and a full push is full speed from the first frame (a touch stick is already an 8-way unit vector). Releasing stops dead.
 */
export function stepVelocity(_v: Vec, dir: Vec, _dt: number, p: { speed: number } = WALK): Vec {
  const d = norm(dir);
  return { x: d.x * p.speed, y: d.y * p.speed };
}

export type Facing = "down" | "up" | "left" | "right";
export const FACINGS: readonly Facing[] = ["down", "left", "right", "up"];

/**
 * Four-way facing from a direction. No movement keeps the old facing; on an exact diagonal the old facing is kept
 * if it is one of the two parts (no flicker while walking diagonally), else the horizontal one wins.
 */
export function facingOf(dir: Vec, prev: Facing): Facing {
  const ax = Math.abs(dir.x);
  const ay = Math.abs(dir.y);
  if (ax < 1e-6 && ay < 1e-6) return prev;
  const h: Facing = dir.x < 0 ? "left" : "right";
  const v: Facing = dir.y < 0 ? "up" : "down";
  if (Math.abs(ax - ay) < 1e-6) return prev === h || prev === v ? prev : h;
  return ax > ay ? h : v;
}

// ---------------------------------------------------------------------------------------------------------------
// Screen layout

export interface WorldLayout {
  /** Logical canvas size (Scale.FIT scales it to the parent). */
  width: number;
  height: number;
  portrait: boolean;
  /** Integer camera zoom: one world pixel is `zoom` canvas pixels (crisp pixel art). */
  zoom: number;
  /** Where the touch stick rests (canvas pixels). */
  stick: { x: number; y: number; r: number };
}

const SHORT = 540;

/**
 * Logical size with the parent's aspect (within limits) so FIT wastes little room. The default zoom 2 shows 270
 * world pixels across the short side (half the height of a 960×540 scene).
 */
export function worldLayout(parentW: number, parentH: number, zoom = 2): WorldLayout {
  const aspect = parentW > 0 && parentH > 0 ? parentW / parentH : 16 / 10;
  zoom = Math.max(1, Math.round(zoom));
  if (aspect >= 1) {
    const width = Math.round(Math.min(1280, Math.max(SHORT, SHORT * aspect)));
    return { width, height: SHORT, portrait: false, zoom, stick: { x: 130, y: SHORT - 130, r: 80 } };
  }
  const height = Math.round(Math.min(1280, Math.max(SHORT, SHORT / aspect)));
  return { width: SHORT, height, portrait: true, zoom, stick: { x: SHORT / 2, y: height - 170, r: 95 } };
}
