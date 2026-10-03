import { isKind } from "../map";
import type { CurseTrigger, Deal } from "./devil";
import { sanitizeEffects } from "./state";

const TRIGGERS: readonly CurseTrigger[] = ["on_hit", "on_enter", "on_fight", "next_node"];
const MAX_DIALOGUE = 600;
export const SILENCE: Deal = { dialogue: "The devil only smiles. He has nothing to say to you today.", effects: {} };

/**
 * Turn anything a devil returned (valid Deal, partial JSON, null, a string, a throwing getter) into a safe Deal:
 * unknown stat keys dropped, numbers clamped per stat, bad curse/rewrite dropped. Never throws.
 */
export function sanitizeDeal(raw: unknown): Deal {
  try {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...SILENCE, effects: {} };
    const r = raw as Record<string, unknown>;
    const dialogue = typeof r.dialogue === "string" && r.dialogue.trim() ? r.dialogue.trim().slice(0, MAX_DIALOGUE) : "...";
    const deal: Deal = { dialogue, effects: sanitizeEffects(r.effects) };
    const c = r.curse as Record<string, unknown> | null | undefined;
    if (c && typeof c === "object" && TRIGGERS.includes(c.trigger as CurseTrigger)) {
      const effect = sanitizeEffects(c.effect);
      if (Object.keys(effect).length) deal.curse = { trigger: c.trigger as CurseTrigger, effect };
    }
    const w = r.rewrite as Record<string, unknown> | null | undefined;
    if (w && typeof w === "object" && typeof w.nodeId === "string" && w.nodeId.length <= 40 && isKind(w.to)
        && w.to !== "boss" && w.to !== "final") deal.rewrite = { nodeId: w.nodeId, to: w.to };
    return deal;
  } catch {
    return { ...SILENCE, effects: {} };
  }
}
