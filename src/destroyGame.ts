/**
 * Tear down a Phaser.Game for good, WebGL context included. Every mount on the play page (a fight, each opening of the
 * map, the village) makes its own game, and Phaser 3.90's `game.destroy(true)` removes the canvas but never releases
 * its WebGL context: that waits for garbage collection. Chrome keeps about 16 live contexts, then logs "Too many active
 * WebGL contexts. Oldest context will be lost." (phones allow fewer). So once Phaser has torn its renderer down, the
 * context is lost on purpose (`WEBGL_lose_context`), which frees it at once.
 *
 * Phaser runs the teardown on its next loop step and emits DESTROY before it destroys the renderer, so the context is
 * dropped on a later task, after the renderer has removed its context-lost listener (it would warn otherwise). A Canvas
 * renderer has nothing to release.
 */
import Phaser from "phaser";

export function destroyGame(game: Phaser.Game): void {
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    // Still whole here: the renderer is destroyed after this event.
    const renderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer | Phaser.Renderer.Canvas.CanvasRenderer | null;
    const gl = renderer && "gl" in renderer ? renderer.gl : null;
    const canvas = game.canvas as HTMLCanvasElement | undefined;
    setTimeout(() => {
      if (gl && !gl.isContextLost()) gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas?.remove(); // Phaser removes it already (`removeCanvas`); a no-op then
    }, 0);
  });
  game.destroy(true, false);
}
