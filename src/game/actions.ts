/** The legal next commands, computed by the engine's own rule checks (`rejection` in state-machine.ts). */
import { currentNode, exitsOf, type Command, type GameState } from "./gameState";
import { rejection } from "./state-machine";

/**
 * Every command `step` would accept right now, in a fixed order: fight, fight realtime, rest, train, buy (affordable wares
 * only), deal, accept, refuse, go 1..n; or only `devil_reply` while the devil is being asked, or only `fight_result` while
 * a realtime fight is on; `[]` once the run is over.
 * `deal` is listed without text (any text is fine); `devil_reply` is listed with `deal: null` (any answer is fine).
 * `fight_result` is listed as an unfinished fight in which nothing happened (both sides keep their HP: always safe to send);
 * a real result carries the fight's numbers instead.
 * `look` is always accepted (it changes nothing) and is deliberately not listed.
 */
export function legalActions(s: GameState): Command[] {
  if (s.ending) return [];
  if (s.pending) return [{ cmd: "devil_reply", deal: null }];
  if (s.pendingFight) {
    const f = s.pendingFight;
    return [{ cmd: "fight_result", won: false, hpLeft: f.player.hp, timeMs: 0, hitsTaken: 0, damageDealt: 0, enemyHpLeft: f.enemy.hp }];
  }
  const kind = currentNode(s).kind;
  const wares = kind === "village" ? ["heal", "blade"] : kind === "well" ? ["blessing"] : [];
  const candidates: Command[] = [
    { cmd: "fight" }, { cmd: "fight", realtime: true }, { cmd: "rest" }, { cmd: "train" }, ...wares.map((item): Command => ({ cmd: "buy", item })),
    { cmd: "deal" }, { cmd: "accept" }, { cmd: "refuse" }, ...exitsOf(s).map((x): Command => ({ cmd: "go", n: x.n })),
  ];
  return candidates.filter((c) => rejection(s, c) === null);
}
