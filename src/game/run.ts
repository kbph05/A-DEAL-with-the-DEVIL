/**
 * `Game`: a thin stateful wrapper over the pure engine (state-machine.ts). It holds the current `GameState` and a
 * `Devil`; every command is one `step`, and `deal` also performs the devil round trip (ask, await the devil, step
 * `devil_reply`). Every command returns `{ ok, events, state }` as before; rendering is somebody else's job.
 */
import { devilFor, type DevilContext, type Devil } from "./devil";
import type { Ending, Result } from "./events";
import { devilContext, initialState, type Command, type GameState, type StepResult } from "./gameState";
import { step } from "./state-machine";
import { snapshot, type PlayerState } from "./state";
import { mapView, observation, view, type MapView, type Observation, type View } from "./view";

export { WARES } from "./gameState";
export type { MapView, MapViewNode, Observation, View } from "./view";

export class Game {
  private gs: GameState;
  private devil: Devil;

  constructor(seed: string | GameState, devil: Devil) {
    this.gs = typeof seed === "string" ? initialState(seed) : seed;
    this.devil = devil;
  }

  get seed(): string { return this.gs.seed; }
  /** The live player state (the current GameState's `player`). */
  get state(): PlayerState { return this.gs.player; }
  get ending(): Ending | null { return this.gs.ending; }
  /** The full run as plain JSON: save it, send it, or `restoreGame` it. Replaced (never mutated) by each command. */
  get gameState(): GameState { return this.gs; }

  /** Apply one command to the held state (sync). A `deal` here only asks: the state then awaits `devil_reply`. */
  step(cmd: Command): StepResult {
    const r = step(this.gs, cmd);
    this.gs = r.state;
    return r;
  }

  private run(cmd: Command): Result {
    const r = this.step(cmd);
    return { ok: r.ok, events: r.events, state: snapshot(this.gs.player) };
  }

  // ---- queries -------------------------------------------------------------------------------

  observe(): Observation { return observation(this.gs); }
  map(): MapView { return mapView(this.gs); }
  /** observe() + map() + legal actions + seed, in one object. */
  view(): View { return view(this.gs); }
  /** What the devil is shown besides the player (also used by the UI's devil lab). Pure: does not touch the run. */
  context(): DevilContext { return devilContext(this.gs); }

  // ---- commands ------------------------------------------------------------------------------

  look(): Result { return this.run({ cmd: "look" }); }
  go(n: number | string): Result { return this.run({ cmd: "go", n: n as number }); }
  /** One combat round; or, with `realtime`, start a realtime fight (the state then awaits `fightResult`). */
  fight(realtime = false): Result { return this.run(realtime ? { cmd: "fight", realtime: true } : { cmd: "fight" }); }
  /** Report how a realtime fight went (src/fight's FightResult; it is sanitized). */
  fightResult(result: unknown): Result {
    const r = (typeof result === "object" && result !== null ? result : {}) as Record<string, unknown>;
    return this.run({ ...r, cmd: "fight_result", won: r.won, hpLeft: r.hpLeft });
  }
  rest(): Result { return this.run({ cmd: "rest" }); }
  /** Campfire: +1 attack instead of resting (one or the other). */
  train(): Result { return this.run({ cmd: "train" }); }
  buy(item?: string): Result { return this.run({ cmd: "buy", item }); }
  accept(): Result { return this.run({ cmd: "accept" }); }
  refuse(): Result { return this.run({ cmd: "refuse" }); }
  /** Answer a pending devil request by hand (whatever the devil said; it is sanitized). */
  devilReply(deal: unknown): Result { return this.run({ cmd: "devil_reply", deal }); }

  /** Ask the devil (async: the backend is a network call). Replies, even junk or a throw, become a sanitized offer. */
  async deal(text?: string): Promise<Result> {
    const asked = this.step({ cmd: "deal", text });
    if (!asked.awaiting?.devil) return { ok: asked.ok, events: asked.events, state: snapshot(this.gs.player) };
    const req = structuredClone(asked.awaiting.devil);
    let raw: unknown;
    try { raw = await this.devil.offer(req.state, req.context, req.playerText ?? undefined); } catch { raw = undefined; }
    const r = this.devilReply(raw);
    return r.ok ? { ...r, events: [...asked.events, ...r.events] } : r;
  }
}

function randomSeed(): string { return Math.random().toString(36).slice(2, 8); }

/** New run. Seed defaults to random; devil defaults to the installed one (setDevil) or a seeded StubDevil. */
export function createGame(seed?: string | number, devil?: Devil): Game {
  const s = seed === undefined || seed === "" ? randomSeed() : String(seed);
  return new Game(s, devil ?? devilFor(s));
}

/**
 * Continue a saved run (e.g. `JSON.parse` of an earlier `game.gameState`). Devil defaults as in createGame. The
 * engine state is complete. StubDevil is a pure function of the request, so a restored run replays identically with
 * any StubDevil; a backend devil should be pure too (same request, same reply) for exact save/resume.
 */
export function restoreGame(state: GameState, devil?: Devil): Game {
  return new Game(structuredClone(state), devil ?? devilFor(state.seed));
}
