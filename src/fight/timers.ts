/**
 * Timers shared by the fight rules (logic.ts) and the enemy roster (enemies.ts): every cooldown / i-frame window is
 * "ms left", ticked down and never below 0. A file of its own so enemies.ts and logic.ts don't import each other.
 */
export const tick = (msLeft: number, dtMs: number): number => Math.max(0, msLeft - dtMs);
export const isReady = (msLeft: number): boolean => msLeft <= 0;
