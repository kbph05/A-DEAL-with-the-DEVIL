/**
 * Realtime fight, public API. `runFight` mounts its own Phaser.Game in `parent`, plays one fight and resolves
 * with a `FightResult` once the enemy or the player drops (after a short victory/defeat banner), then destroys
 * the game. `runForestFight` does the same on a forest path, against an encounter (several enemies) instead of one
 * enemy in the arena. Rules: `logic.ts`, `sim.ts`, `enemies.ts`, `encounters.ts`, `forest.ts` (pure, tested in
 * node); drawing and input: `FightScene.ts` (arena) and `ForestScene.ts` (forest).
 */
import Phaser from "phaser";
import { destroyGame } from "../destroyGame";
import { parseSceneDef, type SceneDef } from "../world/scene";
import { sceneById } from "../world/scenes";
import type { EnemyId } from "./enemies";
import { encounterFor, type Encounter, type ForestRequest } from "./encounters";
import { forestWorld } from "./forest";
import { FightScene } from "./FightScene";
import { ForestScene, type ForestView } from "./ForestScene";
import { fightLayout, relayout, sanitizeInput, type FightInput, type FightResult } from "./logic";
import type { FightSim } from "./sim";
import { GAME_FPS } from "../gameLoop";

export type { FightInput, FightResult, FightPlayerInput, FightEnemyInput } from "./logic";
export type { FightSim } from "./sim";
export type { ForestView } from "./ForestScene";
export type { Encounter, EncounterEnemy, FightWhere, ForestRequest } from "./encounters";
export type { EnemyId } from "./enemies";
export { ENEMIES, ENEMY_IDS } from "./enemies";
export { encounterFor, ENCOUNTER_BANDS, SCALING, progressOf } from "./encounters";

export interface RunFightOptions {
  /** Force the touch controls on or off. Default: on when the device reports touch input (they also appear on the first touch). */
  touch?: boolean;
  /** Test/dev hook: called once with the live simulation (read-only use: positions, timers, HP). */
  onDebug?: (sim: FightSim) => void;
  /** Show the fight clock (the "3.6 s" readout). Default false: kbph (4 Oct) dropped it from the game; the fight lab shows it. */
  clock?: boolean;
}

export function runFight(parent: HTMLElement, input: FightInput, options: RunFightOptions = {}): Promise<FightResult> {
  const clean = sanitizeInput(input);
  const box = parent.getBoundingClientRect();
  let layout = fightLayout(box.width || window.innerWidth, box.height || window.innerHeight);
  const touch = options.touch ?? (navigator.maxTouchPoints > 0 || "ontouchstart" in window);
  return new Promise((resolve) => {
    let ended = false;
    const scene = new FightScene({
      input: clean, layout, touch, onDebug: options.onDebug, clock: options.clock,
      onEnd: (result) => {
        if (ended) return;
        ended = true;
        // Destroying from inside the scene's own update is unsafe; do it on a fresh task, resolve once it's gone.
        setTimeout(() => {
          let done = false;
          const finish = () => { if (!done) { done = true; resolve(result); } };
          stopWatching();
          game.events.once(Phaser.Core.Events.DESTROY, finish);
          destroyGame(game);
          setTimeout(finish, 1000); // the loop may be paused (hidden tab): don't hang on the event
        }, 0);
      },
    });
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      backgroundColor: "#120a0a",
      banner: false,
      fps: GAME_FPS, // no half-speed start (src/gameLoop.ts)
      seed: [clean.seed],
      disableContextMenu: true,
      audio: { noAudio: true },
      input: { activePointers: 3 }, // joystick + attack + dash held at once
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: layout.width, height: layout.height },
      scene: [scene],
    });
    // Turning a phone (or resizing the window) changes the stage's shape: pick a new layout and move the controls, so the
    // arena does not shrink to a strip. The fight itself keeps running.
    let pending = 0;
    const watch = new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        const b = parent.getBoundingClientRect();
        const next = relayout(layout, b.width, b.height);
        if (!next) return;
        layout = next;
        scene.relayout(next);
        game.scale.setGameSize(next.width, next.height);
      });
    });
    watch.observe(parent);
    const stopWatching = () => { cancelAnimationFrame(pending); watch.disconnect(); };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Forest mode (docs/fight.md, "Forest mode"): the same fight, played on a forest path scene against an encounter.

export interface RunForestFightOptions {
  /** Force the touch controls on or off. Default: on when the device reports touch input. */
  touch?: boolean;
  /** Test/dev hook: the live simulation and the scene's view (zoom, camera, depths), read-only. */
  onDebug?: (sim: FightSim, view: ForestView) => void;
  /** The fight scene. Default: the sample forest path (`sceneById("forest")`). It needs `spawns` for good placement. */
  scene?: SceneDef;
  /** Lab: make every enemy this kind (a boss id gives a single boss). */
  force?: EnemyId;
  /** Called once with the encounter, before the fight starts (the lab's readout). */
  onEncounter?: (encounter: Encounter) => void;
  /** Lab: gamma for the forest background. Default: `FOREST_BG_GAMMA` (src/fight/art.ts). */
  gamma?: number;
  /** Show the controls line at the bottom. Default true; the play page turns it off (its pause menu lists the controls). */
  help?: boolean;
  /** Show the fight clock (the "3.6 s" readout). Default false: kbph (4 Oct) dropped it from the game; the fight lab shows it. */
  clock?: boolean;
  /** Called once with the Phaser.Game, right after it is created (the play page pauses it, and destroys it on Quit). */
  onGame?: (game: Phaser.Game) => void;
}

/**
 * Play one fight on a forest path: same API and result as `runFight`. `request` is the engine's `FightRequest`
 * (with the optional `where`, which scales the encounter); the group's HP adds up to `request.enemy.hp`, so the
 * engine's `fight_result` path takes the result unchanged. It mounts its own Phaser.Game in `parent` (RESIZE scale
 * mode: it follows the container's size), resolves about 1.1 s after the last enemy or the player drops, and
 * destroys the game.
 */
export function runForestFight(parent: HTMLElement, request: ForestRequest, options: RunForestFightOptions = {}): Promise<FightResult> {
  const clean = sanitizeInput(request);
  const def = parseSceneDef(options.scene ?? sceneById("forest"));
  const encounter = encounterFor({ ...request, seed: clean.seed }, { force: options.force });
  options.onEncounter?.(encounter);
  const world = forestWorld(def, encounter);
  const box = parent.getBoundingClientRect();
  const touch = options.touch ?? (navigator.maxTouchPoints > 0 || "ontouchstart" in window);
  return new Promise((resolve) => {
    let ended = false;
    const scene = new ForestScene({
      input: clean, scene: def, world, encounter, touch, onDebug: options.onDebug, gamma: options.gamma, help: options.help, clock: options.clock,
      onEnd: (result) => {
        if (ended) return;
        ended = true;
        setTimeout(() => {
          let done = false;
          const finish = () => { if (!done) { done = true; resolve(result); } };
          stopWatching();
          game.events.once(Phaser.Core.Events.DESTROY, finish);
          destroyGame(game);
          setTimeout(finish, 1000);
        }, 0);
      },
    });
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      backgroundColor: "#0b0707",
      banner: false,
      fps: GAME_FPS, // no half-speed start (src/gameLoop.ts)
      pixelArt: true,
      seed: [clean.seed],
      disableContextMenu: true,
      audio: { noAudio: true },
      input: { activePointers: 3 },
      scale: { mode: Phaser.Scale.RESIZE, width: Math.round(box.width || window.innerWidth), height: Math.round(box.height || window.innerHeight) },
      scene: [scene],
    });
    options.onGame?.(game);
    // RESIZE mode follows window resizes and rotation by itself; this also catches the container changing size on
    // its own (the page around it reflowing). The scene re-lays out on the scale manager's resize event.
    let pending = 0;
    const watch = new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        const b = parent.getBoundingClientRect();
        if (b.width > 0 && b.height > 0 && (Math.round(b.width) !== game.scale.width || Math.round(b.height) !== game.scale.height)) game.scale.refresh();
      });
    });
    watch.observe(parent);
    const stopWatching = () => { cancelAnimationFrame(pending); watch.disconnect(); };
  });
}
