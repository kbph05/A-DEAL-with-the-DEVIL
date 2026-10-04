/**
 * World scene, public API. `mountScene(parent, { scene, onEnterZone, onLeaveZone })` mounts a Phaser.Game in
 * `parent` showing one SceneDef (background texture, y-sorted actors and player, overlay texture), with the player
 * walking inside the scene's playable rect, and returns `{ scene, setOutlines(on), destroy() }`. `onEnterZone` /
 * `onLeaveZone` fire once per entry and exit: the hook for linking scenes to act-map nodes later. Docs: docs/world.md.
 */
import Phaser from "phaser";
import { worldLayout } from "./logic";
import { parseSceneDef, type SceneDef, type SceneZone } from "./scene";
import { SCENES } from "./scenes";
import { WorldScene, type WorldDebug } from "./WorldScene";

export type { WorldDebug, Art } from "./WorldScene";
export type { SceneDef, SceneZone, SceneActor, Rect } from "./scene";
export { parseSceneDef, sceneErrors } from "./scene";
export { SCENES, sceneById } from "./scenes";

export interface MountSceneOptions {
  /** The scene to show (checked with parseSceneDef). Default: the first sample scene. */
  scene?: SceneDef;
  /** The feet entered a zone (once per entry; not for a zone you spawn in). */
  onEnterZone?: (zone: SceneZone, scene: SceneDef) => void;
  /** The feet left a zone. */
  onLeaveZone?: (zone: SceneZone, scene: SceneDef) => void;
  /** Top walking speed, px/s. Default 80 (WALK.speed). */
  speed?: number;
  /** Integer camera zoom. Default 2. */
  zoom?: number;
  /** Force the touch stick on or off. Default: on when the device reports touch input (it also appears on the first touch). */
  touch?: boolean;
  /** Dev: draw the playable rect, the zones and the feet box as outlines. */
  outlines?: boolean;
  /** Dev/test hook: called once with a live, read-only view of the player. */
  onDebug?: (debug: WorldDebug) => void;
}

export interface SceneHandle {
  scene: SceneDef;
  /** Dev: show or hide the debug outlines. */
  setOutlines(on: boolean): void;
  destroy(): void;
}

export function mountScene(parent: HTMLElement, options: MountSceneOptions = {}): SceneHandle {
  const def = parseSceneDef(options.scene ?? SCENES[0]);
  const box = parent.getBoundingClientRect();
  const layout = worldLayout(box.width || window.innerWidth, box.height || window.innerHeight, options.zoom);
  const touch = options.touch ?? (navigator.maxTouchPoints > 0 || "ontouchstart" in window);
  const scene = new WorldScene({
    scene: def, layout, touch, speed: options.speed, outlines: options.outlines,
    onEnterZone: options.onEnterZone, onLeaveZone: options.onLeaveZone, onDebug: options.onDebug,
  });
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
    scene: def,
    setOutlines: (on) => scene.setOutlines(on),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      game.destroy(true);
    },
  };
}

/** The old name, kept so existing callers still work. It now mounts a scene (the tile-map options went with the tile model). */
export const mountWorld = mountScene;
export type MountWorldOptions = MountSceneOptions;
export type WorldHandle = SceneHandle;
