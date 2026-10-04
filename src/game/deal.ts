import { isKind } from "../map";
import type { CurseTrigger, Deal } from "./devil";
import { sanitizeEffects } from "./state";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/**
 * Cut to `max` code units without leaving half a surrogate pair (a split emoji) at the end, and replace any other lone
 * surrogate with U+FFFD, so the text is well-formed Unicode (a lone surrogate makes some JSON parsers, llama.cpp's for
 * one, reject the whole request).
 */
export const cut = (t: string, max: number): string =>
  (t.length <= max ? t : t.slice(0, max).replace(/[\uD800-\uDBFF]$/, "")).replace(LONE_SURROGATE, "\uFFFD");

const TRIGGERS: readonly CurseTrigger[] = ["on_hit", "on_enter", "on_fight", "next_node"];
const MAX_DIALOGUE = 600;
/** Most HP a single forced strike may take. Sanitizer-enforced: a backend cannot send a bigger one. */
export const MAX_STRIKE_HP = 8;
export const SILENCE: Deal = { dialogue: "The devil only smiles. He has nothing to say to you today.", effects: {} };

/**
 * Turn anything a devil returned (valid Deal, partial JSON, null, a string, a throwing getter) into a safe Deal:
 * unknown stat keys dropped, numbers clamped per stat, bad curse/rewrite dropped. `forced` is kept only when it is exactly
 * `true`, and then the deal is cut down to a strike: HP loss up to MAX_STRIKE_HP, no curse, no rewrite, no gains. Never throws.
 */
export function sanitizeDeal(raw: unknown): Deal {
  try {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...SILENCE, effects: {} };
    const r = raw as Record<string, unknown>;
    const dialogue = typeof r.dialogue === "string" && r.dialogue.trim() ? cut(r.dialogue.trim(), MAX_DIALOGUE) : "...";
    const deal: Deal = { dialogue, effects: sanitizeEffects(r.effects) };
    if (r.forced === true) { // a strike, not an offer: HP loss only (capped), nothing else survives
      const loss = Math.min(MAX_STRIKE_HP, Math.max(0, -(deal.effects.hp ?? 0)));
      return { dialogue, effects: loss ? { hp: -loss } : {}, forced: true };
    }
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
