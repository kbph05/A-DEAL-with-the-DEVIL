/**
 * The player-safe projection of a GameState: what a UI, bot or LLM may see. Leaves out the dice state, enemy power,
 * past acts and the pending devil request's internals. Pure.
 */
import type { Kind, MapNode, RewriteChange } from "../map";
import { legalActions } from "./actions";
import type { Curse, Deal } from "./devil";
import type { EnemyView, Ending, Exit } from "./events";
import { MAX_ASKS, currentAct, currentNode, devilDone, devilPresent, enemyView, exitsOf, openerDue, questionsLeft, type Command, type GameState } from "./gameState";
import { snapshot, type PlayerState } from "./state";

export interface MapViewNode { id: string; kind: Kind; visited: boolean; current: boolean; rewritten: boolean; next: string[] }
/** Plain data for the current act: layers of nodes, so any frontend can draw (or assert on) it. */
export interface MapView { act: number; layers: Array<{ layer: number; nodes: MapViewNode[] }>; final?: MapViewNode; changes: RewriteChange[] }

/** What a policy (bot, test, UI) gets to see before choosing a command. */
export interface Observation {
  state: PlayerState; nodeId: string; kind: Kind; act: number; enemy: EnemyView | null; exits: Exit[];
  offer: Deal | null; resolved: boolean; pending: boolean; dealsDecided: number; ending: Ending | null;
  /** Curses on the player (each fires once on its trigger). */
  curses: Curse[];
  /** How many more times `deal` may be asked here (0 unless the devil is here and his business is open: see `devilPresent`). */
  asksLeft: number;
  /**
   * The devil is at this node: every deal node and campfire, and the wells where he turned up (additive, 4 Oct). Static per
   * node; whether you may still ask him is `asksLeft` (and `actions`).
   */
  devilPresent: boolean;
  /**
   * The devil's opening offer is still to come here (additive, 4 Oct): send `deal` with no text to get it. It is free (no
   * ask, no question) and tailored to the player's state. Clients request it as soon as the devil appears.
   */
  opening: boolean;
  /** How many more questions (asks and haggles) the devil will hear this run, at any deal node (MAX_DEVIL_QUERIES minus asks so far). */
  questionsLeft: number;
}

/** Everything the player may see in one object: the observation, the current act's map, and the legal commands. */
export interface View extends Observation { seed: string; map: MapView; actions: Command[] }

export function observation(s: GameState): Observation {
  const kind = currentNode(s).kind, here = devilPresent(s);
  return {
    state: snapshot(s.player), nodeId: s.player.nodeId, kind, act: s.player.act,
    enemy: s.enemy && enemyView(s.enemy), exits: exitsOf(s), offer: s.offer, resolved: s.resolved,
    pending: s.pending !== null, dealsDecided: s.dealsDecided, ending: s.ending,
    curses: s.curses.map((c) => ({ ...c, effect: { ...c.effect } })),
    asksLeft: here && !devilDone(s) && !s.ending ? Math.max(0, MAX_ASKS - s.asks) : 0,
    devilPresent: here,
    opening: openerDue(s),
    questionsLeft: questionsLeft(s),
  };
}

export function mapView(s: GameState): MapView {
  const a = currentAct(s);
  const rewritten = new Set(a.changes.map((c) => c.nodeId));
  const mv = (n: MapNode): MapViewNode => ({ id: n.id, kind: n.kind, visited: a.visited.includes(n.id), current: n.id === s.player.nodeId, rewritten: rewritten.has(n.id), next: [...n.next] });
  const layers: MapView["layers"] = [];
  for (const n of a.nodes) (layers[n.layer] ??= { layer: n.layer, nodes: [] }).nodes.push(mv(n));
  return { act: a.index, layers, final: a.final && mv(a.final), changes: [...a.changes] };
}

export function view(s: GameState): View {
  return { ...observation(s), seed: s.seed, map: mapView(s), actions: legalActions(s) };
}
