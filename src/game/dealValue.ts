/**
 * `dealValue`: what a devil's offer is worth to the player over the rest of the run, as one number. Pure, no runtime
 * imports beyond state.ts (no map, no Phaser), so a devil backend (the OAI/Gemini server) can import it as is.
 *
 * Unit: HP-equivalents. +1 is as good for the player as 1 HP of damage not taken; 0 is break-even; negative favours the
 * devil. Weights were measured (4 Oct, on the harder engine): fork the bot's run at every non-fight node, change one stat
 * on a copy, play both to the end refusing every deal, and compare win rates over about 6,000 forks per act (1 HP lost
 * is about 1.7 points of win rate). They are interpolated by `progress` (0 = start of act 1, 1 = the act-3 boss).
 * Everything a curse does counts in full: curses fire once, but a stat change (max HP, attack, gold) is permanent; only
 * HP itself heals back.
 *
 * The StubDevil (devil.ts) prices every offer through this scorer so it is never net-positive for the player
 * (dealValue.test.ts). A backend devil should do the same: see docs/devil-api.md, "Devil voice and pricing".
 */
import type { Deal, DevilContext } from "./devil";
import { sanitizeEffects, type PlayerState } from "./state";

/**
 * HP-equivalents per point of each stat, `[at progress 0, at progress 1]` (linear in between). Losses weigh more than
 * gains where measured: an HP gain is partly wasted (campfires heal anyway), a lost max HP caps every later heal. Attack
 * and gold are worth most early: there are fewer fights left to win and little for sale late.
 */
export const DEAL_WEIGHTS = {
  hp: { gain: [0.4, 0.75], loss: [1, 1] },
  max_hp: { gain: [1.3, 0.3], loss: [2.3, 1] },
  attack: { gain: [11, 3], loss: [11, 4] },
  gold: { gain: [0.7, 0.1], loss: [0.7, 0.1] },
  /** The soul is the one revival and the clean ending. */
  soul: { gain: [21, 35], loss: [21, 35] },
} as const;
/** A good node (campfire, village, well, deal) turned into a fight; or a fight turned into a campfire. */
export const REWRITE_VALUE = { toFight: -10, toCamp: 10 } as const;
/** Curses a player may hold; a curse offered past it never lands (MAX_CURSES in gameState.ts; a test keeps them equal). */
export const CURSE_CAP = 5;

type W = readonly [number, number];
const lerp = ([a, b]: W, t: number): number => a + (b - a) * Math.min(1, Math.max(0, t));

/** Progress from a context, as the engine sends it (`context.progress`), else the middle of the act, else 0.5. */
function progressOf(ctx?: Partial<Pick<DevilContext, "progress" | "act">>): number {
  if (typeof ctx?.progress === "number" && Number.isFinite(ctx.progress)) return Math.min(1, Math.max(0, ctx.progress));
  if (typeof ctx?.act === "number" && Number.isFinite(ctx.act)) return Math.min(1, Math.max(0, (ctx.act + 0.5) / 3));
  return 0.5;
}

/** Value of a set of stat changes at this point (the HP gain only counts up to the HP actually missing). */
function effectsValue(raw: unknown, s: Readonly<PlayerState>, p: number): number {
  const e = sanitizeEffects(raw);
  let v = 0;
  for (const k of ["max_hp", "attack", "gold", "soul"] as const) {
    const x = e[k] ?? 0;
    if (k === "soul") { if (x < 0 && s.soul === 1) v -= lerp(DEAL_WEIGHTS.soul.loss, p); else if (x > 0 && s.soul === 0) v += lerp(DEAL_WEIGHTS.soul.gain, p); continue; }
    v += x >= 0 ? x * lerp(DEAL_WEIGHTS[k].gain, p) : x * lerp(DEAL_WEIGHTS[k].loss, p);
  }
  const hp = e.hp ?? 0;
  if (hp > 0) v += Math.min(hp, Math.max(0, s.maxHp + (e.max_hp ?? 0) - s.hp)) * lerp(DEAL_WEIGHTS.hp.gain, p);
  else if (hp < 0) {
    v += hp * lerp(DEAL_WEIGHTS.hp.loss, p);
    if (-hp >= s.hp) v -= s.soul === 1 ? lerp(DEAL_WEIGHTS.soul.loss, p) : 100; // it kills: the revival, or the run
  }
  return v;
}

/**
 * What accepting `deal` is worth to a player in `state` (positive: good for the player; 0: break-even; negative: good
 * for the devil), in HP-equivalents. `context` is optional: `progress` (or `act`) scales the weights, `rewritable`
 * tells which node a rewrite would replace, and `curses` (the ones already held) whether a new curse can still land. A forced strike is scored as its HP loss. Pure; never throws on junk.
 */
export function dealValue(deal: Partial<Pick<Deal, "effects" | "curse" | "rewrite" | "forced">>, state: Readonly<PlayerState>, context?: Partial<Pick<DevilContext, "progress" | "act" | "rewritable" | "curses">>): number {
  const p = progressOf(context);
  let v = effectsValue(deal?.effects, state, p);
  if (deal?.forced === true) return v;
  if (deal?.curse && typeof deal.curse === "object" && (context?.curses?.length ?? 0) < CURSE_CAP) v += effectsValue(deal.curse.effect, state, p);
  const w = deal?.rewrite;
  if (w && typeof w === "object") {
    const from = context?.rewritable?.find((n) => n.id === w.nodeId)?.kind;
    if (w.to === "fight" && from !== "fight") v += REWRITE_VALUE.toFight;
    else if (w.to !== "fight" && (from === "fight" || from === undefined)) v += w.to === "campfire" ? REWRITE_VALUE.toCamp : REWRITE_VALUE.toCamp / 2;
  }
  return Math.round(v * 100) / 100;
}
