/**
 * The player-safe projection of a GameState: what a UI, bot or LLM may see. Leaves out the dice state, enemy power,
 * past acts and the pending devil request's internals. Pure.
 */
import type { Kind, MapNode, RewriteChange } from "../map";
import { legalActions } from "./actions";
import type { Curse, Deal } from "./devil";
import type { EnemyView, Ending, Exit } from "./events";
import { MAX_ASKS, currentAct, currentNode, enemyView, exitsOf, type Command, type GameState } from "./gameState";
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
  /** How many more times `deal` may be asked here (0 unless on an undecided deal node). */
  asksLeft: number;
}

/** Everything the player may see in one object: the observation, the current act's map, and the legal commands. */
export interface View extends Observation { seed: string; map: MapView; actions: Command[] }

export function observation(s: GameState): Observation {
  const kind = currentNode(s).kind;
  return {
    state: snapshot(s.player), nodeId: s.player.nodeId, kind, act: s.player.act,
    enemy: s.enemy && enemyView(s.enemy), exits: exitsOf(s), offer: s.offer, resolved: s.resolved,
    pending: s.pending !== null, dealsDecided: s.dealsDecided, ending: s.ending,
    curses: s.curses.map((c) => ({ ...c, effect: { ...c.effect } })),
    asksLeft: kind === "deal" && !s.resolved && !s.ending ? Math.max(0, MAX_ASKS - s.asks) : 0,
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
