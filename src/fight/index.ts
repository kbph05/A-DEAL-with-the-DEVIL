/**
 * Realtime fight, public API. `runFight` mounts its own Phaser.Game in `parent`, plays one fight and resolves
 * with a `FightResult` once the enemy or the player drops (after a short victory/defeat banner), then destroys
 * the game. Rules: `logic.ts` and `sim.ts` (pure, tested in node); drawing and input: `FightScene.ts`.
 */
import Phaser from "phaser";
import { FightScene } from "./FightScene";
import { fightLayout, sanitizeInput, type FightInput, type FightResult } from "./logic";
import type { FightSim } from "./sim";

export type { FightInput, FightResult, FightPlayerInput, FightEnemyInput } from "./logic";
export type { FightSim } from "./sim";

export interface RunFightOptions {
  /** Force the touch controls on or off. Default: on when the device reports touch input (they also appear on the first touch). */
  touch?: boolean;
  /** Test/dev hook: called once with the live simulation (read-only use: positions, timers, HP). */
  onDebug?: (sim: FightSim) => void;
}

export function runFight(parent: HTMLElement, input: FightInput, options: RunFightOptions = {}): Promise<FightResult> {
  const clean = sanitizeInput(input);
  const box = parent.getBoundingClientRect();
  const layout = fightLayout(box.width || window.innerWidth, box.height || window.innerHeight);
  const touch = options.touch ?? (navigator.maxTouchPoints > 0 || "ontouchstart" in window);
  return new Promise((resolve) => {
    let ended = false;
    const scene = new FightScene({
      input: clean, layout, touch, onDebug: options.onDebug,
      onEnd: (result) => {
        if (ended) return;
        ended = true;
        // Destroying from inside the scene's own update is unsafe; do it on a fresh task, resolve once it's gone.
        setTimeout(() => {
          let done = false;
          const finish = () => { if (!done) { done = true; resolve(result); } };
          game.events.once(Phaser.Core.Events.DESTROY, finish);
          game.destroy(true);
          setTimeout(finish, 1000); // the loop may be paused (hidden tab): don't hang on the event
        }, 0);
      },
    });
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      backgroundColor: "#120a0a",
      banner: false,
      seed: [clean.seed],
      disableContextMenu: true,
      audio: { noAudio: true },
      input: { activePointers: 3 }, // joystick + attack + dash held at once
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: layout.width, height: layout.height },
      scene: [scene],
    });
  });
}
