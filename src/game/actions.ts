/** The legal next commands, computed by the engine's own rule checks (`rejection` in state-machine.ts). */
import { currentNode, exitsOf, type Command, type GameState } from "./gameState";
import { rejection } from "./state-machine";

/**
 * Every command `step` would accept right now, in a fixed order: fight, rest, buy (affordable wares only), deal,
 * accept, refuse, go 1..n; or only `devil_reply` while the devil is being asked; `[]` once the run is over.
 * `deal` is listed without text (any text is fine); `devil_reply` is listed with `deal: null` (any answer is fine).
 * `look` is always accepted (it changes nothing) and is deliberately not listed.
 */
export function legalActions(s: GameState): Command[] {
  if (s.ending) return [];
  if (s.pending) return [{ cmd: "devil_reply", deal: null }];
  const kind = currentNode(s).kind;
  const wares = kind === "village" ? ["heal", "blade"] : kind === "well" ? ["blessing"] : [];
  const candidates: Command[] = [
    { cmd: "fight" }, { cmd: "rest" }, ...wares.map((item): Command => ({ cmd: "buy", item })),
    { cmd: "deal" }, { cmd: "accept" }, { cmd: "refuse" }, ...exitsOf(s).map((x): Command => ({ cmd: "go", n: x.n })),
  ];
  return candidates.filter((c) => rejection(s, c) === null);
}
