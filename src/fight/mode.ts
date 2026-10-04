/**
 * Which fight a request plays (Big Chungus, 4 Oct: "use the forest scene for the final boss and minibosses"). Pure and
 * Phaser-free, so the DOM UI can decide before it loads the fight chunk.
 *
 * - Boss requests (the minibosses and the final boss) always play on the forest path (`runForestFight`).
 * - Regular fights: the play page (src/play) already plays every fight on the forest path; the DOM UI (src/ui) keeps
 *   the arena for them.
 */
export type FightMode = "forest" | "arena";

export function fightModeFor(request: { enemy?: { boss?: unknown } | null } | null | undefined, regular: FightMode = "arena"): FightMode {
  return request?.enemy?.boss === true ? "forest" : regular;
}
