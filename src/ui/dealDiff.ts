/** Explains what sanitizeDeal changed in a backend reply, by comparing raw to sanitized. Pure; reuses the engine's own sanitizeEffects. */
import type { Deal } from "../game";
import { sanitizeEffects } from "../game/state";

export interface Change { path: string; note: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function diffEffects(path: string, raw: unknown, out: Change[]): void {
  if (raw === undefined) return;
  if (!isObj(raw)) { out.push({ path, note: "not an object, dropped" }); return; }
  for (const [k, v] of Object.entries(raw)) {
    const one = sanitizeEffects({ [k]: v });
    const keys = Object.keys(one);
    if (!keys.length) out.push({ path: `${path}.${k}`, note: `dropped (${JSON.stringify(v)})` });
    else if (keys[0] !== k) out.push({ path: `${path}.${k}`, note: `renamed to ${keys[0]}${one[keys[0]] !== v ? `, ${JSON.stringify(v)} -> ${one[keys[0]]}` : ""}` });
    else if (one[k] !== v) out.push({ path: `${path}.${k}`, note: `${JSON.stringify(v)} -> ${one[k]} (clamped/rounded)` });
  }
}

/** `rewritable` (from the request context) lets us also flag a rewrite the engine would later refuse. */
export function diffDeal(raw: unknown, clean: Deal, rewritable?: Array<{ id: string }>): Change[] {
  const out: Change[] = [];
  if (!isObj(raw)) { out.push({ path: "(body)", note: "not a JSON object; replaced by the silent devil" }); return out; }
  for (const k of Object.keys(raw)) if (!["dialogue", "effects", "curse", "rewrite"].includes(k)) out.push({ path: k, note: "unknown field, ignored" });
  if (typeof raw.dialogue !== "string" || !raw.dialogue.trim()) out.push({ path: "dialogue", note: "missing or empty, replaced by '...'" });
  else if (raw.dialogue.trim() !== clean.dialogue) out.push({ path: "dialogue", note: `trimmed/truncated to ${clean.dialogue.length} chars` });
  diffEffects("effects", raw.effects, out);
  if (raw.curse != null) {
    if (!clean.curse) out.push({ path: "curse", note: "dropped (bad trigger or no valid effect)" });
    else if (isObj(raw.curse)) diffEffects("curse.effect", raw.curse.effect, out);
  }
  if (raw.rewrite != null) {
    if (!clean.rewrite) out.push({ path: "rewrite", note: "dropped (needs nodeId string and a kind other than boss/final)" });
  }
  if (clean.rewrite && rewritable && !rewritable.some((n) => n.id === clean.rewrite!.nodeId))
    out.push({ path: "rewrite.nodeId", note: "not in context.rewritable: accepting would give rewrite_failed" });
  return out;
}
