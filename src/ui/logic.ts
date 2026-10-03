/** Pure helpers for the test UI: which buttons make sense, and how to style events. No DOM here, so tests can import it. */
import { isSyncMarker, type Deal, type GameEvent, type MapView, type Observation } from "../game";
import type { EnemyView, Exit } from "../game/events";
import { WARES } from "../game/gameState";
import type { Kind } from "../map";

export type Ware = keyof typeof WARES;
export interface Actions {
  /** Everything is disabled: a run that is over, or the devil is mid-sentence. */
  locked: boolean;
  exits: Observation["exits"];
  fight: boolean;
  rest: boolean;
  buy: Array<{ item: Ware; cost: number; affordable: boolean }>;
  /** Show the "ask the devil" row (wish input + button); `again` means an offer is already on the table (haggle). */
  ask: { again: boolean } | null;
  offer: Deal | null;
}

/**
 * Buttons derived from observe() only. Anything the observation can't tell us (e.g. how many haggles are left)
 * stays enabled and the engine's `rejected` reason is shown instead.
 */
export function availableActions(o: Observation, busy = false): Actions {
  const wares: Ware[] = o.kind === "village" ? ["heal", "blade"] : o.kind === "well" && !o.resolved ? ["blessing"] : [];
  return {
    locked: busy || o.pending || o.ending !== null,
    exits: o.exits,
    fight: o.enemy !== null,
    rest: o.kind === "campfire" && !o.resolved,
    buy: wares.map((item) => ({ item, cost: WARES[item].cost, affordable: o.state.gold >= WARES[item].cost })),
    ask: o.kind === "deal" && !o.resolved && !o.enemy ? { again: o.offer !== null } : null,
    offer: o.offer,
  };
}

/** CSS class for a log line, so the devil's meddling stands out. */
export function eventClass(e: GameEvent): string {
  switch (e.type) {
    case "node_rewritten": case "rewrite_failed": return "ev-rewrite";
    case "curse_added": case "curse_fired": return "ev-curse";
    case "deal_offered": case "deal_applied": case "deal_refused": return "ev-devil";
    case "damaged": case "lost": case "hell": return "ev-bad";
    case "healed": case "enemy_slain": case "won": case "revived": return "ev-good";
    case "rejected": return "ev-reject";
    case "started": case "act_advanced": return "ev-head";
    default: return "ev";
  }
}

// ---- wording and formatting (pure, so tests can pin them down) -------------------------------------------------

const KIND_WORD: Record<Kind, string> = { campfire: "Campfire", village: "Village", well: "Well", deal: "Deal", fight: "Fight", boss: "Boss", final: "Final door" };
/** "Act 2 · Village": where the player is, in words. `act` is 0-based as in the engine. */
export const nodeTitle = (act: number, kind: Kind): string => `Act ${act + 1} · ${KIND_WORD[kind]}`;

/**
 * Exit button labels that tell same-kind exits apart: "Go → fight · then deal" vs "Go → fight · then campfire".
 * Uses the current act's map (where each exit leads next); falls back to left/middle/right if that's identical too.
 */
export function exitLabels(o: Observation, map: MapView): string[] {
  const nodes = new Map(map.layers.flatMap((l) => l.nodes).map((n) => [n.id, n]));
  const here = nodes.get(o.nodeId);
  const hints = o.exits.map((x) => {
    const target = here && x.kind !== "stairs" && x.kind !== "gate" ? nodes.get(here.next[x.n - 1]) : undefined;
    const after = target ? [...new Set(target.next.map((id) => nodes.get(id)?.kind ?? "?"))] : [];
    return after.length ? ` · then ${after.join(" / ")}` : "";
  });
  const side = (i: number, n: number) => (n === 2 ? ["left", "right"][i] : n === 3 ? ["left", "middle", "right"][i] : `#${i + 1}`);
  return o.exits.map((x, i) => {
    const twins = o.exits.map((y, j) => (y.kind === x.kind && hints[j] === hints[i] ? j : -1)).filter((j) => j >= 0);
    const where = twins.length > 1 ? ` (${side(twins.indexOf(i), twins.length)})` : "";
    return exitLabel(x) + hints[i] + where;
  });
}

/** Label of an exit button: "Go → fight". Stairs and the final gate get a plain-words hint. */
export function exitLabel(x: Exit): string {
  if (x.kind === "stairs") return "Go → stairs (down to the next act)";
  if (x.kind === "gate") return "Go → the final gate";
  return `Go → ${x.kind}`;
}

const WARE_NAME: Record<Ware, string> = { heal: "Heal", blade: "Blade", blessing: "Blessing" };
/** Buy button text; an unaffordable ware says how much gold is missing. */
export function buyLabel(w: Actions["buy"][number], gold: number): { label: string; reason: string | null } {
  const base = `${WARE_NAME[w.item]} (${w.cost}g)`;
  if (w.affordable) return { label: base, reason: null };
  const need = w.cost - gold;
  return { label: `${base} — need ${need} more gold`, reason: `need ${need} more gold` };
}

export const fightLabel = (e: EnemyView): string => `Fight the ${e.name}`;

/** Why every button is disabled, or null when the player may act. */
export function lockReason(o: Observation, busy = false): string | null {
  if (o.ending) return "The run is over. Start a new game.";
  if (busy || o.pending) return "The devil considers…";
  return null;
}

export interface Chip { text: string; tone: "good" | "bad" }
const STAT_LABEL: Record<string, string> = { hp: "HP", max_hp: "Max HP", gold: "Gold", attack: "Attack", soul: "Soul" };
/** Deltas as chips: `{ gold: 10, hp: -3 }` becomes "+10 Gold" (good) and "−3 HP" (bad). Zeros are dropped. */
export function effectChips(d: Record<string, number | undefined>): Chip[] {
  return Object.entries(d).filter(([, v]) => v).map(([k, v]) => ({
    text: `${v! > 0 ? "+" : "−"}${Math.abs(v!)} ${STAT_LABEL[k] ?? k}`,
    tone: v! > 0 ? "good" : "bad",
  }));
}

const TRIGGER_WORD: Record<string, string> = { on_hit: "when you are hit", on_enter: "on entering a node", on_fight: "each fight", next_node: "at the next node" };
/** A curse in words, e.g. "when you are hit: −2 HP". */
export const curseText = (c: { trigger: string; effect: Record<string, number> }): string =>
  `${TRIGGER_WORD[c.trigger] ?? c.trigger}: ${effectChips(c.effect).map((x) => x.text).join(", ") || "nothing"}`;

/** Bar fill 0..100 for hp/maxHp, safe for junk input. */
export const pct = (v: number, max: number): number => (max > 0 ? Math.max(0, Math.min(100, Math.round((v / max) * 100))) : 0);

/** The node's description (the player-facing text of `look()`), taken from the `looked` event's one-line header. */
export function blurbOf(looked: Extract<GameEvent, { type: "looked" }>, text: string): string {
  const first = text.split("\n")[0] ?? "";
  const i = first.indexOf(`(${looked.kind}): `);
  return i >= 0 ? first.slice(i + looked.kind.length + 4) : first;
}

/** Events worth showing as "what just happened": everything except the `looked` chatter and the sync markers. */
export const outcomeEvents = (events: GameEvent[]): GameEvent[] =>
  events.filter((e) => e.type !== "looked" && !isSyncMarker(e));
