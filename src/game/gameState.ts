/**
 * The whole run as one plain JSON object, plus the read-only queries over it. `step` (state-machine.ts) is the only
 * thing that produces a new GameState; nothing here mutates its argument.
 */
import { ACTS, generateAct, hashSeed, markVisited, rngState, type Act, type MapNode, type RngState } from "../map";
import type { Curse, Deal, DevilContext } from "./devil";
import type { EnemyView, Ending, Exit, GameEvent } from "./events";
import type { DevilRequest } from "./httpDevil";
import { newPlayer, normalize, type PlayerState } from "./state";

export const MAX_CURSES = 5;
export const MAX_ASKS = 3;
/**
 * Run-wide cap on questions to the devil: every `deal` command that reaches him counts (first asks and haggles alike,
 * across all deal nodes), whatever he answers. Once `state.totalAsks` reaches it, `deal` is no longer a legal action and
 * is rejected ("The devil has heard enough from you this run."); an offer already on the table can still be accepted or
 * refused. Exposed as `questionsLeft` (Observation, View and DevilContext).
 */
export const MAX_DEVIL_QUERIES = 10;
/** Questions the player may still put to the devil this run. */
export const questionsLeft = (s: Pick<GameState, "totalAsks">): number => Math.max(0, MAX_DEVIL_QUERIES - s.totalAsks);
/** Attack gained by training at a campfire (the alternative to resting there). */
export const TRAIN_ATTACK = 1;
export const WARES = { heal: { cost: 10 }, blade: { cost: 15 }, blessing: { cost: 8 } } as const;
export const FOES = [["cave rat", "drowned monk", "ash hound"], ["bone mason", "glass wolf", "hollow knight"], ["choir of moths", "gilded wretch", "the unlit"]];
export const BOSSES = ["the Gatekeeper", "the Cartographer of Ruin", "the Devil's Left Hand"];

/** An enemy as the engine keeps it (`power` is hidden from the player). */
export interface Enemy extends EnemyView { power: number }

/**
 * Every input the engine accepts. `devil_reply` answers a pending devil request (see StepResult.awaiting).
 * At a campfire, `rest` (heal) and `train` (+1 attack) are alternatives: either one spends the fire.
 */
export type Command =
  | { cmd: "look" } | { cmd: "go"; n: number } | { cmd: "fight" } | { cmd: "rest" } | { cmd: "train" }
  | { cmd: "buy"; item?: string } | { cmd: "deal"; text?: string } | { cmd: "accept" } | { cmd: "refuse" }
  | { cmd: "devil_reply"; deal: unknown };

/**
 * Everything needed to continue a run exactly: `JSON.parse(JSON.stringify(state))` continues identically.
 * No class instances, functions, Maps or Sets. Treat it as immutable: `step` returns a new one.
 */
export interface GameState {
  /** Format version of this object. */
  v: 1;
  seed: string;
  /** Dice stream (enemy names and HP, damage rolls, loot, well blessings). Map generation has its own seeded streams. */
  rng: RngState;
  /** Acts generated so far (lazily, on arrival), with their visited list and rewrite log. */
  acts: Act[];
  player: PlayerState;
  curses: Curse[];
  enemy: Enemy | null;
  /** The current node's one-shot action is used up (campfire rested or trained at, well drunk, enemy slain, deal decided). */
  resolved: boolean;
  offer: Deal | null;
  /** Asks at the current deal node (max MAX_ASKS). */
  asks: number;
  /** Asks this run (the devil's `askIndex`; capped at MAX_DEVIL_QUERIES). */
  totalAsks: number;
  dealsDecided: number;
  ending: Ending | null;
  /** Set while the devil has been asked and has not answered: the next command must be `devil_reply`. */
  pending: DevilRequest | null;
}

/** What `step` returns. `ok: false` carries exactly one `rejected` event and the input state unchanged. */
export interface StepResult {
  ok: boolean;
  state: GameState;
  events: GameEvent[];
  /** The legal next commands (see actions.ts). */
  actions: Command[];
  /** Present when the engine needs the devil: send this request to a Devil, then step `devil_reply` with its answer. */
  awaiting?: { devil: DevilRequest };
}

/** A new run on `seed`, standing on act 1's entry. */
export function initialState(seed: string): GameState {
  const act0 = generateAct(seed, 0);
  return {
    v: 1, seed, rng: rngState(hashSeed(`dice:${seed}`)), acts: [markVisited(act0, act0.entry)],
    player: normalize(newPlayer(act0.entry)), curses: [], enemy: null, resolved: false, offer: null,
    asks: 0, totalAsks: 0, dealsDecided: 0, ending: null, pending: null,
  };
}

export const currentAct = (s: GameState): Act => s.acts[s.player.act];
export function currentNode(s: GameState): MapNode {
  const a = currentAct(s);
  return s.player.nodeId === "final" && a.final ? a.final : a.nodes.find((n) => n.id === s.player.nodeId)!;
}

export function exitsOf(s: GameState): Exit[] {
  if (s.enemy || s.ending) return [];
  const a = currentAct(s), n = currentNode(s);
  if (n.kind === "final") return [];
  if (n.id === a.exit) return [{ n: 1, kind: a.index < ACTS - 1 ? "stairs" : "gate" }];
  return n.next.map((id, i) => ({ n: i + 1, kind: a.nodes.find((m) => m.id === id)!.kind }));
}

export const enemyView = (e: Enemy): EnemyView => ({ name: e.name, hp: e.hp, maxHp: e.maxHp, boss: e.boss });

/** What the devil is shown besides the player. Pure. */
export function devilContext(s: GameState): DevilContext {
  const a = currentAct(s), seen = new Set<string>(), stack = [...currentNode(s).next];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(a.nodes.find((n) => n.id === id)?.next ?? []));
  }
  const rewritable = a.nodes.filter((n) => seen.has(n.id) && n.id !== a.exit && !a.visited.includes(n.id)).map((n) => ({ id: n.id, kind: n.kind }));
  return { seed: s.seed, act: a.index, nodeId: s.player.nodeId, askIndex: s.totalAsks, questionsLeft: questionsLeft(s), rewritable, curses: s.curses.map((c) => ({ ...c })) };
}

/** Is `state` a valid-looking GameState? (Shallow check for restoring saved runs.) */
export function isGameState(x: unknown): x is GameState {
  const s = x as GameState | null;
  return typeof s === "object" && s !== null && s.v === 1 && typeof s.seed === "string" && typeof s.rng?.s === "number"
    && Array.isArray(s.acts) && s.acts.length > 0 && typeof s.player === "object" && s.player !== null && Array.isArray(s.curses);
}
