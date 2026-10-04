/**
 * World scene, public API: `mountWorld(parent, options)` mounts a Phaser.Game in `parent` with the player walking
 * around a tile map (generated from `seed`, or a given `map`), and returns `{ destroy() }`. `onEnterTile` fires
 * whenever the player's feet move onto another tile (e.g. a DOOR: later, a node of the act map). Docs: docs/world.md.
 */
import Phaser from "phaser";
import { generateWorld, type GenOptions } from "./gen";
import { worldLayout } from "./logic";
import { WorldScene, type WorldDebug } from "./WorldScene";
import type { WorldMap } from "./tiles";

export type { WorldDebug } from "./WorldScene";
export type { WorldMap, TilePos, TileId } from "./tiles";
export { T, TILES, tileName } from "./tiles";
export { generateWorld } from "./gen";
export { loadMapJson, fromTiled } from "./tiled";

export interface MountWorldOptions {
  /** Seed for the generated map (ignored when `map` is given). Default: random. */
  seed?: string;
  /** Use this map instead of generating one (our JSON or a Tiled export, through `loadMapJson`). */
  map?: WorldMap;
  /** Size of the generated map, in tiles. */
  size?: GenOptions;
  onEnterTile?: (tileId: number, x: number, y: number) => void;
  /** Force the touch stick on or off. Default: on when the device reports touch input (it also appears on the first touch). */
  touch?: boolean;
  /** Dev: outline the tile under the player. */
  showTile?: boolean;
  /** Dev/test hook: called once with a live, read-only view of the player. */
  onDebug?: (debug: WorldDebug) => void;
}

export interface WorldHandle {
  map: WorldMap;
  destroy(): void;
}

export function mountWorld(parent: HTMLElement, options: MountWorldOptions = {}): WorldHandle {
  const map = options.map ?? generateWorld(options.seed ?? Math.random().toString(36).slice(2, 8), options.size);
  const box = parent.getBoundingClientRect();
  const layout = worldLayout(box.width || window.innerWidth, box.height || window.innerHeight);
  const touch = options.touch ?? (navigator.maxTouchPoints > 0 || "ontouchstart" in window);
  const scene = new WorldScene({ map, layout, touch, showTile: options.showTile, onEnterTile: options.onEnterTile, onDebug: options.onDebug });
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#0b0707",
    banner: false,
    pixelArt: true,
    disableContextMenu: true,
    audio: { noAudio: true },
    input: { activePointers: 2 },
    physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 }, debug: false } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: layout.width, height: layout.height },
    scene: [scene],
  });
  let destroyed = false;
  return {
    map,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      game.destroy(true);
    },
  };
}
