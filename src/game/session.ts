/** One shared Game instance plus a tiny event bus, so the console and the UI drive and observe the same run. */
import type { GameEvent } from "./events";
import { createGame, type Game } from "./run";

export interface Session {
  game(): Game;
  /** Replace the run (random seed if omitted); emits a `started` event. */
  newGame(seed?: string | number): Game;
  /** Announce events that something other than the listener produced (an empty list just means "re-render"). */
  emit(events: GameEvent[]): void;
  subscribe(fn: (events: GameEvent[]) => void): () => void;
}

export function createSession(seed?: string | number): Session {
  let game = createGame(seed);
  const subs = new Set<(events: GameEvent[]) => void>();
  const emit = (events: GameEvent[]) => { for (const f of subs) f(events); };
  return {
    game: () => game,
    newGame(s) { game = createGame(s); emit([{ type: "started", seed: game.seed }]); return game; },
    emit,
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}
