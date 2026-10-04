/**
 * The whole run as one plain JSON object, plus the read-only queries over it. `step` (state-machine.ts) is the only
 * thing that produces a new GameState; nothing here mutates its argument.
 */
import { ACTS, generateAct, hashSeed, markVisited, mulberry32, rngState, type Act, type MapNode, type RngState } from "../map";
import type { Curse, Deal, DevilContext } from "./devil";
import type { EnemyView, Ending, Exit, GameEvent } from "./events";
import type { FightRequest } from "./fightResult";
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
/**
 * Chance that the devil sits at a given well (kbph and Big Chungus, 4 Oct). Rolled per run seed and well node on its own
 * hashed stream (`devilAtWell`), so neither the dice (`state.rng`) nor the map streams move.
 */
export const WELL_DEVIL_CHANCE = 0.5;
/** Does the devil turn up at the well `nodeId` of run `seed`? Pure: the same answer every time, stored nowhere. */
export const devilAtWell = (seed: string, nodeId: string): boolean =>
  mulberry32(hashSeed(`well-devil:${seed}:${nodeId}`))() < WELL_DEVIL_CHANCE;
/**
 * Is the devil at the player's node? At every deal node and every campfire (where a deal is the third choice beside rest
 * and train), and at the wells where he turned up (`devilAtWell`). Whether a `deal` is still legal there is `rejection`'s call.
 */
export function devilPresent(s: GameState): boolean {
  const n = currentNode(s);
  return n.kind === "deal" || n.kind === "campfire" || (n.kind === "well" && devilAtWell(s.seed, n.id));
}
/**
 * One choice per node (kbph, 4 Oct). At a campfire (rest, train or deal) and at a well (the blessing, a deal when the devil
 * is there, or skip by moving on) the first choice locks the others: `rest`, `train` or the blessing set `resolved` with no
 * ask, which shuts the devil out (`spent`); the first `deal` ask is the devil's, whatever follows (haggles, a strike,
 * accept, refuse, walking away), which shuts the rest (`devil`). Player-facing rejection reasons, by node kind.
 */
export const ONE_CHOICE = {
  campfire: { spent: "the embers are spent", devil: "you chose the devil at this fire" },
  well: { spent: "you took the well's blessing; the devil has nothing for you here", devil: "you chose the devil at this well" },
} as const;
/** The lock reasons for the player's node, or null where the devil is not one choice among others. */
export const oneChoice = (s: GameState): (typeof ONE_CHOICE)[keyof typeof ONE_CHOICE] | null =>
  ONE_CHOICE[currentNode(s).kind as keyof typeof ONE_CHOICE] ?? null;
/**
 * Has the devil's business at this node ended (deal accepted or refused, or, at a campfire or well, the node's one choice
 * spent on something else: rest, train, the blessing)?
 */
export const devilDone = (s: GameState): boolean => (currentNode(s).kind === "well" ? s.devilGone === true || s.resolved : s.resolved);
/**
 * Is `deal` with this text the devil's opening offer (kbph, 4 Oct: "the devil should be making an initial offer based on
 * the current game state")? Yes when the text is absent or blank, nothing was asked or opened at this node yet, and no
 * offer stands. The opener costs no ask and no question (MAX_ASKS, MAX_DEVIL_QUERIES); the request goes out with
 * `playerText: null`, which tells the devil to pitch something tailored to the player's state.
 */
export const isOpener = (s: GameState, text: unknown): boolean =>
  (typeof text !== "string" || text.trim() === "") && s.asks === 0 && !s.opened && !s.offer;
/** The opening offer is still to come here: the devil sits at this node, will deal, and has not pitched yet. */
export const openerDue = (s: GameState): boolean => devilPresent(s) && !devilDone(s) && !s.ending && !s.enemy && !s.pending && !s.dying && isOpener(s, undefined);
/** Attack gained by training at a campfire (the alternative to resting there). */
export const TRAIN_ATTACK = 1;
/** Prices live with the rest of the gold knobs in economy.ts. */
export { WARES } from "./economy";
/**
 * Regular enemies' display names, one row per act (kbph, 4 Oct: every regular is drawn as an Orc, so they are named as
 * orcs). Names only: their stats are FOE in difficulty.ts. Keep 3 per act (the engine rolls one of 3).
 */
export const FOES = [["orc", "orc raider", "orc cutthroat"], ["orc brute", "orc reaver", "orc ravager"], ["orc berserker", "orc bloodsworn", "orc warchief's guard"]];
export const BOSSES = ["the Gatekeeper", "the Cartographer of Ruin", "the Devil's Left Hand"];

/** An enemy as the engine keeps it (`power` is hidden from the player). */
export interface Enemy extends EnemyView {
  power: number;
  /** Realtime fights started against this enemy so far (the `n` in the fight seed); absent until the first. */
  bouts?: number;
}

/**
 * Every input the engine accepts. `devil_reply` answers a pending devil request (see StepResult.awaiting).
 * At a campfire, `rest` (heal), `train` (+1 attack) and `deal` are alternatives: the first of them spends the fire (the
 * first `deal` ask counts, whatever follows: haggling, accepting, refusing, a strike or walking away). At a well the same
 * goes for `buy` blessing and `deal` (when the devil is there): see ONE_CHOICE.
 * `fight` is one round; `fight` with `realtime: true` instead asks the client to play a realtime fight (StepResult.awaiting
 * `fight`), answered by `fight_result` (untrusted; sanitized, see fightResult.ts).
 */
export type Command =
  | { cmd: "look" } | { cmd: "go"; n: number } | { cmd: "fight"; realtime?: boolean } | { cmd: "rest" } | { cmd: "train" }
  | { cmd: "buy"; item?: string } | { cmd: "deal"; text?: string } | { cmd: "accept" } | { cmd: "refuse" }
  | { cmd: "devil_reply"; deal: unknown }
  | { cmd: "fight_result"; won: unknown; hpLeft: unknown; timeMs?: unknown; hitsTaken?: unknown; damageDealt?: unknown; enemyHpLeft?: unknown };

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
  /** The current node's one-shot action is used up (campfire rested, trained at or dealt at, well's blessing taken, enemy slain, deal decided). */
  resolved: boolean;
  /**
   * A well's deal is decided (accepted or refused) and the devil has left it. Wells keep `resolved` for the blessing (which
   * the first ask locks: see ONE_CHOICE). Reset on every move; absent elsewhere and in older saves.
   */
  devilGone?: boolean;
  /**
   * The devil's opening offer was asked for at this node (a `deal` with no text, before any ask: see `isOpener`). It
   * is free (no ask, no question) and comes once per node. Reset on every move; absent elsewhere and in older saves.
   */
  opened?: boolean;
  offer: Deal | null;
  /** Asks at the current node: a deal node, a campfire or a well with the devil (max MAX_ASKS). */
  asks: number;
  /** Asks this run (the devil's `askIndex`; capped at MAX_DEVIL_QUERIES). */
  totalAsks: number;
  dealsDecided: number;
  ending: Ending | null;
  /** Set while the devil has been asked and has not answered: the next command must be `devil_reply`. */
  pending: DevilRequest | null;
  /** Set while a realtime fight is being played: the next command must be `fight_result`. Absent (or null) otherwise. */
  pendingFight?: FightRequest | null;
  /**
   * At death's door (additive, 4 Oct; Big Chungus: "when you die with your soul, the devil should come up and offer for
   * you to continue by forfeiting your soul"): HP hit 0 while the soul was still yours. The devil's offer for the soul is
   * pending or on the table (`offer`); only `deal` (haggling, MAX_ASKS times, each a question), `accept`, `refuse` and
   * `look` are legal. `cause` is what killed you, `haggles` the asks made here, `standing` the node's own offer that the
   * death interrupted (back on the table after a revival). Absent (or null) otherwise.
   */
  dying?: Dying | null;
}

/** See GameState.dying. */
export interface Dying { cause: string; haggles: number; standing?: Deal }
/** Why a command is refused at death's door. */
export const DYING = "you are dying: the devil wants an answer (accept, refuse, or haggle)";

/** What `step` returns. `ok: false` carries exactly one `rejected` event and the input state unchanged. */
export interface StepResult {
  ok: boolean;
  state: GameState;
  events: GameEvent[];
  /** The legal next commands (see actions.ts). */
  actions: Command[];
  /**
   * Present when the engine needs something from outside. `devil`: send it to a Devil, then step `devil_reply` with the
   * answer. `fight`: play it (src/fight `runFight`), then step `fight_result` with the result.
   */
  awaiting?: { devil?: DevilRequest; fight?: FightRequest };
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
  if (s.enemy || s.ending || s.dying) return [];
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
  return { seed: s.seed, act: a.index, nodeId: s.player.nodeId, kind: s.dying ? "death" : currentNode(s).kind, askIndex: s.totalAsks, questionsLeft: questionsLeft(s), rewritable, curses: s.curses.map((c) => ({ ...c })), progress: progressOf(s), haggle: s.dying ? s.dying.haggles : Math.max(0, (s.opened ? 1 : 0) + s.asks - 1) };
}

/**
 * How far through the run the player is: 0 at the start of act 1, 1 at the act-3 boss ((act + layer / boss layer) / 3,
 * two decimals). Sent to the devil as `context.progress`.
 */
export function progressOf(s: GameState): number {
  const a = currentAct(s), last = a.nodes.find((n) => n.id === a.exit)?.layer || 1;
  return Math.round(100 * Math.min(1, (a.index + currentNode(s).layer / last) / 3)) / 100;
}

/** Is `state` a valid-looking GameState? (Shallow check for restoring saved runs.) */
export function isGameState(x: unknown): x is GameState {
  const s = x as GameState | null;
  return typeof s === "object" && s !== null && s.v === 1 && typeof s.seed === "string" && typeof s.rng?.s === "number"
    && Array.isArray(s.acts) && s.acts.length > 0 && typeof s.player === "object" && s.player !== null && Array.isArray(s.curses);
}
