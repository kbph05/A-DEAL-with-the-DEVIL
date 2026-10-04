/**
 * UI-only guard: buying a heal at full HP takes the gold and does nothing, and the engine still allows it. Every UI that
 * offers a heal (the world and play page's shop prompt, the HUD's item slots, the DOM UI's shop) asks here first and
 * disables the button with this reason. The engine is untouched. Pure, so tests can pin it down.
 */
export const FULL_HEALTH = "You're at full health";

/** The reason a purchase should be disabled in the UI although the engine would take it, or null. Only the heal is guarded. */
export function pointlessBuy(item: string, hp: unknown, maxHp: unknown): string | null {
  return item === "heal" && typeof hp === "number" && typeof maxHp === "number" && maxHp > 0 && hp >= maxHp ? FULL_HEALTH : null;
}
