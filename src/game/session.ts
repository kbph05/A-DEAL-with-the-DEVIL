/** One shared Game instance plus a tiny event bus, so the console and the UI drive and observe the same run. */
import type { GameEvent } from "./events";
import type { GameState } from "./gameState";
import { createGame, type Game } from "./run";

/** The moments the client should exchange the full GameState with a backend (planned; see docs/devil-api.md). */
export type SyncKind = "devil_stage_entered" | "devil_stage_left" | "won" | "lost" | "hell";
const SYNC: ReadonlySet<string> = new Set<SyncKind>(["devil_stage_entered", "devil_stage_left", "won", "lost", "hell"]);
export type SyncHook = (kind: SyncKind, state: GameState) => void;

export interface Session {
  game(): Game;
  /** Replace the run (random seed if omitted); emits a `started` event. */
  newGame(seed?: string | number): Game;
  /** Announce events that something other than the listener produced (an empty list just means "re-render"). */
  emit(events: GameEvent[]): void;
  subscribe(fn: (events: GameEvent[]) => void): () => void;
  /**
   * Sync hook, default no-op: called with a copy of the full GameState (as it is after the command) whenever emitted
   * events include stepping onto or off a deal node, or an ending; also on a new run that starts on a deal node.
   */
  onSync: SyncHook;
}

export function createSession(seed?: string | number, opts: { onSync?: SyncHook } = {}): Session {
  let game = createGame(seed);
  const subs = new Set<(events: GameEvent[]) => void>();
  const sync = (kind: SyncKind) => session.onSync(kind, structuredClone(game.gameState));
  const startSync = () => { if (game.observe().kind === "deal") sync("devil_stage_entered"); };
  const session: Session = {
    game: () => game,
    newGame(s) { game = createGame(s); emit([{ type: "started", seed: game.seed }]); return game; },
    emit: (events) => emit(events),
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    onSync: opts.onSync ?? (() => {}),
  };
  function emit(events: GameEvent[]) {
    for (const e of events) {
      if (e.type === "started") startSync();
      else if (SYNC.has(e.type)) sync(e.type as SyncKind);
    }
    for (const f of subs) f(events);
  }
  startSync();
  return session;
}
