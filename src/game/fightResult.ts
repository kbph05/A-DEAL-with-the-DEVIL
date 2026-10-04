/**
 * The realtime fight round trip (docs/fight.md): `{cmd:"fight", realtime:true}` asks the client to play a fight
 * (`awaiting: { fight: FightRequest }`), and `{cmd:"fight_result", ...}` reports how it went. The client is not
 * trusted: `sanitizeFightResult` clamps every number against the pending request and makes the outcome consistent.
 * Pure; no Phaser here (src/fight/ consumes `FightRequest` as its `FightInput`, which has the same shape).
 */
import { ACTS } from "../map";
import { currentAct, currentNode, type Enemy, type GameState } from "./gameState";
import { clamp } from "./state";

/** What the realtime fight needs: the engine's own numbers, plus a seed for the arena and the dice. */
export interface FightRequest {
  player: { hp: number; maxHp: number; attack: number };
  enemy: { name: string; hp: number; maxHp: number; power: number; boss: boolean };
  /** `${run seed}:${nodeId}:${n}`, n = 1, 2, ... per enemy (a fresh one after a revival or an unfinished fight). */
  seed: string;
  /**
   * Where the fight is (additive, 4 Oct; kbph: fights get harder up the map): `act` of `acts` (0-based), the node's
   * `layer` of the act's `layers` (0 = the act's entry, `layers - 1` = its boss), and the node `kind` ("fight", "boss", ...).
   * Optional: older saved requests lack it. Not used by `sanitizeFightResult`.
   */
  where?: { act: number; acts: number; layer: number; layers: number; kind: string };
}

/** What the client reports (src/fight's `FightResult`). Every field is untrusted input. */
export interface FightReport { won?: unknown; hpLeft?: unknown; timeMs?: unknown; hitsTaken?: unknown; damageDealt?: unknown; enemyHpLeft?: unknown }

/** A report after sanitizing: consistent with the pending request and with how the fight sim can actually end. */
export interface FightOutcome {
  /** "won": enemy at 0, player above 0. "lost": player at 0, enemy above 0. "unfinished": both still standing (aborted, fled, crashed). */
  outcome: "won" | "lost" | "unfinished";
  hpLeft: number;
  enemyHpLeft: number;
  /** Derived (enemy hp before minus after); the client's own `damageDealt` is ignored except as a fallback for `enemyHpLeft`. */
  damageDealt: number;
  hitsTaken: number;
  timeMs: number;
}

/** Longest fight a report may claim (informational only; nothing depends on it). */
export const MAX_FIGHT_MS = 60 * 60 * 1000;

/** The request for a new realtime fight against `s.enemy` (which must be present), as the `n`th bout with it. */
export function fightRequest(s: GameState, e: Enemy, n: number): FightRequest {
  const node = currentNode(s);
  return {
    player: { hp: s.player.hp, maxHp: s.player.maxHp, attack: s.player.attack },
    enemy: { name: e.name, hp: e.hp, maxHp: e.maxHp, power: e.power, boss: e.boss },
    seed: `${s.seed}:${s.player.nodeId}:${n}`,
    where: { act: s.player.act, acts: ACTS, layer: node.layer, layers: Math.max(...currentAct(s).nodes.map((m) => m.layer)) + 1, kind: node.kind },
  };
}

const int = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

/**
 * Clamp a client's report to what could have happened in the fight `req` describes. Never throws; junk in, "nothing
 * happened" out.
 * - `hpLeft` in 0..player hp at the start (a fight never heals); missing = unchanged.
 * - `enemyHpLeft` in 0..enemy hp at the start; missing = derived from `damageDealt`, else 0 if `won === true`, else unchanged.
 * - Won only if `won === true`, the enemy is at 0 and the player is above 0 (the sim stops at the first death).
 *   A claimed win with the enemy above 0, or with the player at 0, is not a win; an enemy that was not beaten keeps
 *   at least 1 HP. A loss (player at 0) and an unfinished fight (both standing) are both accepted.
 * - `hitsTaken` in [1 if any HP was lost else 0, HP lost] (every hit does at least 1 damage).
 */
export function sanitizeFightResult(raw: unknown, req: FightRequest): FightOutcome {
  const r: FightReport = typeof raw === "object" && raw !== null ? raw as FightReport : {};
  const h0 = req.player.hp, e0 = req.enemy.hp;
  const hpLeft = clamp(int(r.hpLeft) ?? h0, 0, h0);
  const dealt = int(r.damageDealt);
  let enemyHpLeft = clamp(int(r.enemyHpLeft) ?? (dealt !== null ? e0 - dealt : r.won === true ? 0 : e0), 0, e0);
  const won = r.won === true && enemyHpLeft === 0 && hpLeft > 0;
  if (!won) enemyHpLeft = Math.max(Math.min(1, e0), enemyHpLeft);
  const hpLost = h0 - hpLeft;
  return {
    outcome: won ? "won" : hpLeft === 0 ? "lost" : "unfinished",
    hpLeft, enemyHpLeft, damageDealt: e0 - enemyHpLeft,
    hitsTaken: clamp(int(r.hitsTaken) ?? (hpLost > 0 ? 1 : 0), hpLost > 0 ? 1 : 0, hpLost),
    timeMs: clamp(int(r.timeMs) ?? 0, 0, MAX_FIGHT_MS),
  };
}
