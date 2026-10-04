/**
 * The play page's flow controller (docs/play.md). Pure: (engine view, local UI state) → which screen to show, whether
 * the map is closed, open or forced, whether the devil's overlay is up, and which prompts to offer. No DOM, no Phaser;
 * tested in node (flow.test.ts). The engine stays the only judge of what is legal: prompts are filtered by `actions`.
 *
 * The rules (kbph, 4 Oct):
 * - Village: the Map button (or M) opens the map, and it can be closed again to keep shopping. Never forced.
 * - Campfire: Rest / Sharpen Weapon / Deal (one of three). Once the choice is resolved (rested or trained; the deal
 *   accepted, refused or ended), the map is forced.
 * - Well: buy a blessing, a deal when the devil is there, and Move on. The map is forced after Move on.
 * - Fight and boss: the realtime fight. Won (no enemy left): the map is forced. A revival fights again; death ends.
 * - Deal node: the devil's overlay until the deal is accepted, refused or ended (or you walk away); then the map is forced.
 * - Never forced (nor open) while the devil is speaking, an offer stands, an enemy blocks the way or a fight is on.
 * - A run that is over shows the ending card.
 */
import { MAX_ASKS, type Command, type Ending, type GameEvent, type View } from "../game";

/** The parts of the engine's `View` the flow reads (a real `view(state)` fits). */
export type FlowView = Pick<View, "nodeId" | "kind" | "enemy" | "offer" | "pending" | "resolved" | "ending" | "devilPresent" | "asksLeft" | "actions"> & Partial<Pick<View, "opening">>;

/** UI state the engine doesn't know about. Flags set at another node than `at` are ignored, so a move resets them. */
export interface Local {
  /** The node these flags were set at. */
  at: string | null;
  /** Village: the player opened the map. */
  mapOpen: boolean;
  /** Well: the player pressed Move on. */
  movedOn: boolean;
  /** The player chose to talk to the devil (Deal at a campfire or well). */
  talking: boolean;
  /** The player closed the devil's overlay after asking, without accepting or refusing (deal node, campfire). */
  walkedAway: boolean;
  /** The page is waiting on something of its own: the devil's async reply, or a realtime fight on screen. */
  busy: "devil" | "fight" | null;
}

export const LOCAL: Local = { at: null, mapOpen: false, movedOn: false, talking: false, walkedAway: false, busy: null };

export type Screen = "village" | "campfire" | "well" | "fight" | "deal" | "ending";
export type MapMode = "closed" | "open" | "forced";
export type PromptId = "rest" | "train" | "deal" | "blessing" | "move-on" | "fight";

export interface Flow {
  screen: Screen;
  map: MapMode;
  /** Show the Map button (and listen for M). Only where the map is optional: the village. */
  mapButton: boolean;
  /** The devil's overlay is up (asking, his reply awaited, an offer on the table). */
  devil: boolean;
  /** The node's own choices, in order; each one is legal right now (move-on and fight are the page's own). */
  prompts: PromptId[];
  ending: Ending | null;
}

const SCREEN: Record<FlowView["kind"], Screen> = {
  village: "village", campfire: "campfire", well: "well", deal: "deal", fight: "fight", boss: "fight", final: "ending",
};

const has = (actions: readonly Command[], cmd: string, item?: string): boolean =>
  actions.some((c) => c.cmd === cmd && (item === undefined || (c as { item?: unknown }).item === item));

/** Has the devil been asked at this node and is the business still open (asks used, not resolved)? */
const asked = (v: FlowView): boolean => v.devilPresent && !v.resolved && v.asksLeft < MAX_ASKS;

export function flow(v: FlowView, local: Local = LOCAL): Flow {
  const l = local.at === v.nodeId ? local : { ...LOCAL, busy: local.busy };
  const base = { screen: SCREEN[v.kind], map: "closed" as MapMode, mapButton: false, devil: false, prompts: [] as PromptId[], ending: v.ending };
  if (v.ending) return { ...base, screen: "ending" };

  const fightOn = l.busy === "fight" || has(v.actions, "fight_result");
  if (v.pending || l.busy === "devil") return { ...base, devil: true };
  if (fightOn) return { ...base, screen: "fight" };
  if (v.enemy) return { ...base, screen: "fight", prompts: has(v.actions, "fight") ? ["fight"] : [] };
  if (v.offer) return { ...base, devil: true };

  const canDeal = has(v.actions, "deal");
  const dealEnded = asked(v) && !canDeal; // asked, no offer standing, and no ask left: he is done with you
  const forced = { ...base, map: "forced" as MapMode };
  switch (v.kind) {
    case "village":
      return { ...base, mapButton: true, map: l.mapOpen ? "open" : "closed" };
    case "fight": case "boss":
      return forced; // no enemy: won
    case "deal":
      if (v.resolved || dealEnded || l.walkedAway) return forced;
      return { ...base, devil: true };
    case "campfire": {
      if (v.resolved || dealEnded || (l.walkedAway && asked(v))) return forced;
      if (asked(v) || (l.talking && !l.walkedAway && canDeal)) return { ...base, devil: true };
      const prompts = (["rest", "train", "deal"] as const).filter((p) => has(v.actions, p));
      return prompts.length ? { ...base, prompts } : forced; // nothing left to choose: move on
    }
    case "well": {
      if (l.movedOn) return forced;
      if (l.talking && !l.walkedAway && canDeal) return { ...base, devil: true };
      const prompts: PromptId[] = [];
      if (has(v.actions, "buy", "blessing")) prompts.push("blessing");
      if (v.devilPresent && canDeal) prompts.push("deal");
      prompts.push("move-on");
      return { ...base, prompts };
    }
    case "final":
      return { ...base, screen: "ending" };
  }
}

/**
 * Should the page ask for the devil's opening offer now (kbph, 4 Oct: "the devil should be making an initial offer")?
 * When the engine says it is due (`opening`) and the devil appears: his overlay is up (a deal node; Deal pressed at a
 * campfire), or the player stands at a well where he sits (he pitches against the blessing before it is bought). Never
 * while the page is busy or the map is up. The opener is free; a typed wish after it counts as a question as usual.
 */
export function wantsOpener(v: FlowView, f: Pick<Flow, "devil" | "map" | "screen">, local: Pick<Local, "busy">): boolean {
  return v.opening === true && local.busy === null && !v.pending && f.map === "closed" && (f.devil || (f.screen === "well" && v.devilPresent));
}

/** The player opened the devil's overlay (Deal at a campfire or well). */
export const OPEN_DEVIL: Partial<Local> = { talking: true, walkedAway: false };
/** The player closed the devil's overlay without deciding (Walk away). */
export const CLOSE_DEVIL: Partial<Local> = { talking: false, walkedAway: true };

/** The local flags after a move: everything reset, bound to the new node. */
export const arrived = (nodeId: string): Local => ({ ...LOCAL, at: nodeId });
/** Set flags for the current node (resetting them first if they belonged to another node). */
export function setLocal(local: Local, nodeId: string, patch: Partial<Local>): Local {
  return { ...(local.at === nodeId ? local : arrived(nodeId)), ...patch, at: nodeId };
}

/**
 * At a well: which of its choices was taken since the player arrived, read from the event log (newest first). "blessing"
 * once it is bought, "devil" once his offer was accepted or refused (he has left), null before either. The engine's view
 * can't tell them apart (both leave the devil done), but the panel's words must: accepting his offer is not the blessing.
 */
export function wellChoice(log: readonly GameEvent[]): "blessing" | "devil" | null {
  for (const e of log) {
    if (e.type === "moved" || e.type === "started") return null;
    if (e.type === "bought" && e.item === "blessing") return "blessing";
    if (e.type === "deal_applied" || e.type === "deal_refused") return "devil";
  }
  return null;
}
