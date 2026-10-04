/**
 * Art for the world scene. Placeholders are drawn in code (textures.ts), so the repo ships no image files. The
 * private hook: licensed art that may not be redistributed (e.g. zerie's Tiny RPG Character Asset Pack, 100×100
 * frames) goes in the gitignored public/assets/private/ and is picked up when present; see docs/world.md.
 *
 * vite.config.ts lists that folder at startup into __PRIVATE_ASSETS__, so only files that exist are requested
 * (no 404s in the console). A file that fails to load still falls back to the placeholder.
 */
import { PIXEL_SCALE } from "../render/pixelScale";

declare const __PRIVATE_ASSETS__: string[];

/** File names found in public/assets/private/ when the dev server or build started. */
export const privateFiles = (): string[] => (typeof __PRIVATE_ASSETS__ !== "undefined" ? __PRIVATE_ASSETS__ : []);
export const privateUrl = (file: string): string => `${import.meta.env.BASE_URL}assets/private/${file}`;

export interface SheetAnim {
  /** PNG in public/assets/private/. */
  file: string;
  /** Frames per direction (a row of the sheet). */
  frames: number;
  fps: number;
}

export interface PlayerSheetSpec {
  frameWidth: number;
  frameHeight: number;
  /**
   * "side": one row facing right (left is the same frames mirrored; up and down reuse them), as in the Tiny RPG pack.
   * "four": four rows, in the order down, left, right, up.
   */
  layout: "side" | "four";
  idle: SheetAnim;
  walk: SheetAnim;
  /** The feet collision box inside one frame, in sheet pixels. Keep it centred left to right (mirroring). */
  feet: { w: number; h: number; x: number; y: number };
  /** World pixels per sheet pixel: PIXEL_SCALE, the backgrounds' scale (src/render/pixelScale.ts). */
  scale: number;
}

/**
 * The player sheet, if present. UNVERIFIED against the actual pack: these are the pack's advertised 100×100 frames
 * and a guess at the frame counts and where the feet are. Check them against your copy and edit here.
 * Both files must be present, else the placeholder is used.
 */
export const PRIVATE_PLAYER: PlayerSheetSpec = {
  frameWidth: 100,
  frameHeight: 100,
  layout: "side",
  idle: { file: "player-idle.png", frames: 6, fps: 8 },
  walk: { file: "player-walk.png", frames: 8, fps: 12 },
  feet: { w: 10, h: 6, x: 45, y: 54 },
  scale: PIXEL_SCALE,
};

// Scene art (background, overlay, actors) needs no spec: it is found by path, scenes/<scene id>/background.png and
// so on (scene.ts `artSource`, docs/world.md).
