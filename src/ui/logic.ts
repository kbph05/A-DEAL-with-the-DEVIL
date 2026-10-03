/** Pure helpers for the test UI: which buttons make sense, and how to style events. No DOM here, so tests can import it. */
import { isSyncMarker, type Command, type Deal, type GameEvent, type MapView, type Observation } from "../game";
import type { EnemyView } from "../game/events";
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
  /** Show the "ask the devil" row (wish input + button); `again` means an offer is already on the table (haggle); `enabled` is false once the devil is done haggling. */
  ask: { again: boolean; enabled: boolean } | null;
  offer: Deal | null;
}

const has = (legal: readonly Command[], pred: (c: Command) => boolean) => legal.some(pred);

/**
 * Buttons derived from the observation, and, when `legal` (the engine's `actions` list from `view()`) is given, enabled
 * strictly by it: fight, rest, an affordable buy, and another deal/haggle exist only if the engine would accept them.
 * Which buttons are *shown* (and the unaffordable-buy reason) still follows the node kind, so the player sees what is for
 * sale even when it is out of reach. Without `legal` (pure tests) the old observation-only rules apply.
 */
export function availableActions(o: Observation, busy = false, legal?: readonly Command[]): Actions {
  const wares: Ware[] = o.kind === "village" ? ["heal", "blade"] : o.kind === "well" && !o.resolved ? ["blessing"] : [];
  const showAsk = o.kind === "deal" && !o.resolved && !o.enemy;
  return {
    locked: busy || o.pending || o.ending !== null,
    exits: o.exits,
    fight: legal ? has(legal, (c) => c.cmd === "fight") : o.enemy !== null,
    rest: legal ? has(legal, (c) => c.cmd === "rest") : o.kind === "campfire" && !o.resolved,
    buy: wares.map((item) => ({ item, cost: WARES[item].cost,
      affordable: legal ? has(legal, (c) => c.cmd === "buy" && c.item === item) : o.state.gold >= WARES[item].cost })),
    ask: showAsk ? { again: o.offer !== null, enabled: legal ? has(legal, (c) => c.cmd === "deal") : true } : null,
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

// ---- the map as a choice: DAG model (pure) ---------------------------------------------------------------------

/** The synthetic node drawn above the act's boss on every act but the last (the engine's "stairs" exit). */
export const STAIRS_ID = "stairs";
export type DagKind = Kind | typeof STAIRS_ID;
/** current = you are here; visited = already walked; next = one step away; far = anything else (muted, not clickable). */
export type DagState = "current" | "visited" | "next" | "far";
type MapNodeView = MapView["layers"][number]["nodes"][number];

export interface DagNode {
  id: string;
  kind: DagKind;
  state: DagState;
  rewritten: boolean;
  /** The exit number for `{cmd:"go", n}`; set for every `next` node, even while a lock disables it. */
  n: number | null;
  /** Why a `next` node cannot be clicked right now; null when it can (and always null for other states). */
  disabled: string | null;
  /** Accessible name, e.g. "Go to fight a0n2, then deal". */
  label: string;
}
export interface Dag {
  /** Rows from the top of the screen (stairs or final door, then the boss) down to the act's entry. */
  rows: DagNode[][];
  /** Edges as [lower id, upper id], i.e. the direction you walk in. */
  edges: Array<[string, string]>;
  /** The one reason all next nodes are disabled, or null. */
  lock: string | null;
}

const nodeIndex = (map: MapView): Map<string, MapNodeView> =>
  new Map([...map.layers.flatMap((l) => l.nodes), ...(map.final ? [map.final] : [])].map((n) => [n.id, n]));

/** Kinds of the nodes a node leads to, deduplicated, e.g. ["deal", "campfire"]. Empty if unknown or a dead end. */
export function afterKinds(map: MapView, id: string): Kind[] {
  const nodes = nodeIndex(map), n = nodes.get(id);
  return n ? [...new Set(n.next.map((x) => nodes.get(x)?.kind).filter((k): k is Kind => !!k))] : [];
}

/** The id of the node above the act's boss: the real final door on the last act, the stairs pseudo-node elsewhere. */
export const topId = (map: MapView): string => map.final?.id ?? STAIRS_ID;

/**
 * Map node id -> exit number for `{cmd:"go", n}`, or null when that node is not one step away. The engine's exits are
 * `here.next` in order, so n = index + 1. The act's boss (the only "boss" kind; rewrites cannot create one) has no `next`
 * and its single exit (stairs, or the gate on the last act) is n = 1, mapped to `topId(map)`. Computed from the map alone,
 * not `observe().exits`, because that list is empty while an enemy blocks the way.
 */
export function exitNumber(o: Pick<Observation, "nodeId">, map: MapView, targetId: string): number | null {
  const here = nodeIndex(map).get(o.nodeId);
  if (!here || here.kind === "final") return null;
  if (here.kind === "boss") return targetId === topId(map) ? 1 : null;
  const i = here.next.indexOf(targetId);
  return i >= 0 ? i + 1 : null;
}

/**
 * Why moving is not possible right now, or null. Wording is the tooltip and the visible hint under the map.
 * The offer rule is stricter than the engine (which would let you `go` with an offer on the table): it is a UI choice so
 * an offer is never silently abandoned. Whether a given `go n` is clickable is decided by the engine's `actions`, see `dagModel`.
 */
export function moveLock(o: Observation, busy = false): string | null {
  if (o.ending) return "The run is over. Start a new game.";
  if (busy || o.pending) return "The devil considers…";
  if (o.enemy) return "Finish the fight first.";
  if (o.offer) return "Accept or refuse the devil's offer first.";
  return null;
}

/** Is `{cmd:"go", n}` among the engine's legal actions? (`legal` undefined = no engine list: trust the map.) */
const goLegal = (legal: readonly Command[] | undefined, n: number | null): boolean =>
  n !== null && (!legal || legal.some((c) => c.cmd === "go" && c.n === n));
const NOT_NOW = "Not possible right now.";

/** Classifies one node. `nextIds` are the ids one step from the current node (from `exitNumber`, not from the lock). */
export function nodeState(n: Pick<MapNodeView, "id" | "current" | "visited">, nextIds: ReadonlySet<string>): DagState {
  return n.current ? "current" : n.visited ? "visited" : nextIds.has(n.id) ? "next" : "far";
}

const DAG_WORD: Record<DagKind, string> = { ...KIND_WORD, stairs: "Stairs" };
export const dagWord = (k: DagKind): string => DAG_WORD[k];

function dagLabel(kind: DagKind, id: string, state: DagState, rewritten: boolean, then: Kind[], lock: string | null): string {
  const word = kind.toLowerCase(), star = rewritten ? " (rewritten by the devil)" : "";
  if (kind === "stairs") return state === "next" ? `Go down the stairs to the next act${lock ? `. ${lock}` : ""}` : "Stairs to the next act, not reachable yet";
  const here = id === "final" ? "the final door" : `${word} ${id}`;
  if (state === "current") return `You are here: ${here}${star}`;
  if (state === "visited") return `${here}, visited${star}`;
  if (state === "far") return `${here}, not reachable yet${star}`;
  return `Go to ${id === "final" ? "the final door" : here}${then.length ? `, then ${then.join(" or ")}` : ""}${star}${lock ? `. ${lock}` : ""}`;
}

/**
 * Everything the DAG view needs. Node states, labels and exit numbers come from the map (so unreachable and blocked
 * nodes can still be drawn); whether a next node is *clickable* comes from the engine's `actions` (`legal`, from
 * `view().actions`), and the UI-only offer rule in `moveLock` can disable it further.
 */
export function dagModel(o: Observation, map: MapView, busy = false, legal?: readonly Command[]): Dag {
  const lock = moveLock(o, busy);
  const off = (n: number | null): string | null => lock ?? (goLegal(legal, n) ? null : NOT_NOW);
  const nodes = nodeIndex(map);
  const all = [...nodes.keys(), ...(map.final ? [] : [STAIRS_ID])];
  const nextIds = new Set(all.filter((id) => exitNumber(o, map, id) !== null));
  const bossHere = nodes.get(o.nodeId)?.kind === "boss";
  const mk = (n: MapNodeView): DagNode => {
    const state = nodeState(n, nextIds);
    const num = state === "next" ? exitNumber(o, map, n.id) : null, why = state === "next" ? off(num) : null;
    return { id: n.id, kind: n.kind, state, rewritten: n.rewritten, n: num, disabled: why, label: dagLabel(n.kind, n.id, state, n.rewritten, afterKinds(map, n.id), why) };
  };
  const top: DagNode = map.final ? mk(map.final) : {
    id: STAIRS_ID, kind: STAIRS_ID, state: bossHere ? "next" : "far", rewritten: false, n: bossHere ? 1 : null,
    disabled: bossHere ? off(1) : null, label: dagLabel(STAIRS_ID, STAIRS_ID, bossHere ? "next" : "far", false, [], bossHere ? off(1) : null),
  };
  const rows = [[top], ...[...map.layers].reverse().map((l) => l.nodes.map(mk))];
  const edges: Array<[string, string]> = [];
  for (const n of nodes.values()) for (const t of n.next) edges.push([n.id, t]);
  const boss = [...nodes.values()].find((n) => n.kind === "boss");
  if (boss) edges.push([boss.id, top.id]);
  return { rows, edges, lock };
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

// ---- the action panels: which kind of choice is on offer here (pure) ---------------------------------------------

/** The four kinds of panel in "Your choices". Only the ones relevant to the node are drawn. */
export type PanelKind = "devil" | "shop" | "choose" | "fight";

/**
 * Which panels to show at this node, in order. A blocking enemy means only the Fight panel (the engine refuses everything
 * else, and deal nodes hold no fights). Otherwise: deal node = the Devil's table (kept after the deal, to show how it
 * ended); village = Shop (buy as often as you can pay); campfire and well = Choose one (each is single-use: the engine sets
 * `resolved` after one action, and the well's blessing is not a shop). Anything else has no panel.
 */
export function panelKinds(o: Pick<Observation, "kind" | "enemy">): PanelKind[] {
  if (o.enemy) return ["fight"];
  switch (o.kind) {
    case "deal": return ["devil"];
    case "village": return ["shop"];
    case "campfire": case "well": return ["choose"];
    default: return [];
  }
}

export const PANEL_TITLE: Record<PanelKind, { icon: string; title: string }> = {
  devil: { icon: "😈", title: "The Devil's table" },
  shop: { icon: "🛒", title: "Shop — buy as many as you like" },
  choose: { icon: "☝️", title: "Choose one" },
  fight: { icon: "⚔️", title: "Fight" },
};

/** How a deal ended, read from the log (newest first). Null while it is undecided or unknown (e.g. a resumed save with no log). */
export type DealEnd = "struck" | "walked" | null;
export function dealEnd(log: readonly GameEvent[]): DealEnd {
  for (const e of log) {
    if (e.type === "deal_applied") return "struck";
    if (e.type === "deal_refused") return "walked";
    if (e.type === "moved" || e.type === "started") return null; // earlier than this node
  }
  return null;
}

export type DevilPhase = "ask" | "offer" | "struck" | "walked" | "settled";
/** Where the deal at this node stands. `settled` = resolved, but the log cannot say how. */
export function devilPhase(o: Pick<Observation, "resolved" | "offer">, end: DealEnd): DevilPhase {
  if (o.resolved) return end ?? "settled";
  return o.offer ? "offer" : "ask";
}
export const DEVIL_END_TEXT: Record<"struck" | "walked" | "settled", { head: string; body: string }> = {
  struck: { head: "Deal struck", body: "The devil has what he came for. He is gone from the table." },
  walked: { head: "You walked away", body: "No deal. The devil shrugs and is gone from the table." },
  settled: { head: "The deal is settled", body: "The devil has already gone from the table." },
};

/** "Haggles left: 2" once an offer is on the table; before the first ask, how many tries the devil allows. */
export function haggleText(asksLeft: number, hasOffer: boolean): string {
  if (!hasOffer) return `The devil will hear you out up to ${asksLeft} time${asksLeft === 1 ? "" : "s"}.`;
  return asksLeft > 0 ? `Haggles left: ${asksLeft}` : "Haggles left: 0. Accept or refuse.";
}

const WARE_EFFECT: Record<Ware, string> = { heal: "Restore 12 HP", blade: "+1 Attack", blessing: "A random blessing: +3 Max HP, +1 Attack or +8 HP" };
const WARE_ICON: Record<Ware, string> = { heal: "❤️", blade: "🗡️", blessing: "✨" };

export interface ShopItem { item: Ware; icon: string; name: string; effect: string; cost: number; affordable: boolean; /** e.g. "need 3 more gold"; null when affordable. */ reason: string | null }
/** The shop's price tags (village only: the well's single blessing is a choice, not a shop). */
export function shopItems(o: Pick<Observation, "kind" | "state">, A: Pick<Actions, "buy">): ShopItem[] {
  if (o.kind !== "village") return [];
  return A.buy.map((w) => ({ item: w.item, icon: WARE_ICON[w.item], name: WARE_NAME[w.item], effect: WARE_EFFECT[w.item], cost: w.cost, affordable: w.affordable, reason: buyLabel(w, o.state.gold).reason }));
}

export interface ChooseCard {
  key: string; icon: string; title: string; effect: string;
  /** What clicking it sends. */
  cmd: Command;
  /** available = pick it; chosen = this is what you took (node resolved); short = cannot pay yet. */
  state: "available" | "chosen" | "short";
  /** Gold shortfall note, or null. */
  note: string | null;
}
/**
 * The single-use choices of a campfire or well. Once the node is resolved (the engine's `resolved`, and no rest / blessing
 * in `actions`) the card shows as chosen and nothing can be clicked: you only ever get one.
 */
export function chooseCards(o: Pick<Observation, "kind" | "resolved" | "state">, A: Pick<Actions, "rest" | "buy">): ChooseCard[] {
  if (o.kind === "campfire") {
    const heal = Math.ceil(o.state.maxHp * 0.4);
    return [{ key: "rest", icon: "🔥", title: "Rest at the campfire", effect: `Heal up to ${heal} HP`, cmd: { cmd: "rest" }, state: o.resolved ? "chosen" : "available", note: null }];
  }
  if (o.kind === "well") {
    const w = A.buy.find((b) => b.item === "blessing");
    const base = { key: "blessing", icon: WARE_ICON.blessing, title: "Drink from the well (8g)", effect: WARE_EFFECT.blessing, cmd: { cmd: "buy", item: "blessing" } as Command };
    if (o.resolved || !w) return [{ ...base, state: "chosen", note: null }];
    return [{ ...base, state: w.affordable ? "available" : "short", note: buyLabel(w, o.state.gold).reason }];
  }
  return [];
}
