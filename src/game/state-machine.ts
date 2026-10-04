/**
 * The engine as a pure reducer: `step(state, command) -> { ok, state, events, actions, awaiting? }`.
 *
 * Pure and synchronous: never mutates its input, no I/O, no clock, no Math.random (dice come from `state.rng`).
 * Internally each accepted command works on a private deep copy of the input ("draft"), so the rules below read
 * like the old imperative engine, statement for statement; the copy is what gets returned.
 *
 * Asking the devil is a round trip: `deal` returns `awaiting: { devil: request }` and records the request in
 * `state.pending`; the next command must be `{ cmd: "devil_reply", deal }` with whatever the devil answered (it is
 * sanitized here). `look` stays allowed while waiting (it changes nothing); everything else is rejected.
 *
 * A realtime fight is the same kind of round trip: `{cmd:"fight", realtime:true}` returns `awaiting: { fight: request }`
 * (recorded in `state.pendingFight`), and the next command must be `{cmd:"fight_result", ...}` with what the client's
 * fight reported (sanitized by fightResult.ts). Plain `{cmd:"fight"}` stays the one-round fight.
 *
 * Death's door (4 Oct): HP 0 with the soul still yours no longer revives on its own. `settleHp` sets `state.dying`, and
 * the command that killed you ends with a pending devil request (`context.kind` "death", his free opener). Then only
 * `deal` (haggle), `accept` (the soul is sold, another life), `refuse` (the death stands: "lose") and `look` are legal.
 */
import { generateAct, markVisited, nextRandom, rewriteNode } from "../map";
import { legalActions } from "./actions";
import { cut, sanitizeDeal } from "./deal";
import type { Curse, Deal } from "./devil";
import type { Deltas, GameEvent } from "./events";
import { fightRequest, sanitizeFightResult } from "./fightResult";
import {
  BOSSES, DYING, FOES, MAX_ASKS, MAX_CURSES, MAX_DEVIL_QUERIES, TRAIN_ATTACK, WARES, currentAct, currentNode, devilAtWell, devilContext, devilDone,
  devilPresent, enemyView, exitsOf, isOpener, ONE_CHOICE, oneChoice,
  type Command, type Enemy, type GameState, type StepResult,
} from "./gameState";
import { BOSS, FOE, FREE_HEAL } from "./difficulty";
import { BOSS_GOLD, KILL_GOLD } from "./economy";
import type { DevilRequest } from "./httpDevil";
import { STAT_RANGE, addGold, applyEffects, heal, hurt, normalize, note, reviveHp, settle, snapshot, spend, type PlayerState } from "./state";

const clone = <T>(x: T): T => structuredClone(x);

/** Why `cmd` would be rejected in `s`, or null if it is legal. Checks only; same order and wording as ever. */
export function rejection(s: GameState, cmd: Command): string | null {
  // Untrusted input (REPL, a backend, a bot): null, a bare string or a number must be rejected, not thrown on.
  const c = (typeof cmd === "object" && cmd !== null ? cmd : {}) as { cmd: unknown };
  if (c.cmd === "look") return null;
  if (s.pending && c.cmd !== "devil_reply") return "the devil is still speaking";
  if (s.pendingFight && c.cmd !== "fight_result") return "the fight is still on; send fight_result";
  const over = s.ending ? `the run is over (${s.ending}); start a new game` : null;
  if (c !== cmd) return "unknown command undefined";
  if (s.dying && !over) switch (cmd.cmd) { // death's door: only the devil's business
    case "accept": case "refuse": return s.offer ? null : "the devil has not named his price yet";
    case "deal":
      if (s.totalAsks >= MAX_DEVIL_QUERIES) return "The devil has heard enough from you this run.";
      return s.dying.haggles >= MAX_ASKS ? "he is done haggling: accept() or refuse()" : null;
    case "devil_reply": case "fight_result": break; // the usual answers below
    default: return DYING;
  }
  switch (cmd.cmd) {
    case "go": {
      if (over) return over;
      if (s.enemy) return `${s.enemy.name} blocks the way; fight()`;
      const exits = exitsOf(s), i = goIndex(cmd.n);
      if (!Number.isInteger(i) || i < 1 || i > exits.length) return `no exit ${text(cmd.n)}; choose 1..${exits.length}`;
      return null;
    }
    case "fight": return over ?? (s.enemy ? null : "nothing here to fight");
    case "rest": case "train": {
      if (over) return over;
      if (currentNode(s).kind !== "campfire") return "there is no fire here";
      if (s.resolved) return "the embers are spent";
      if (s.asks > 0 || s.opened) return ONE_CHOICE.campfire.devil; // the first ask (or his opener, asked for by choosing Deal) spends the fire's choice
      return cmd.cmd === "train" && s.player.attack >= STAT_RANGE.attack[1] ? `your attack is already at its peak (${STAT_RANGE.attack[1]})` : null;
    }
    case "buy": {
      if (over) return over;
      const kind = currentNode(s).kind;
      if (kind !== "village" && kind !== "well") return "nobody here is selling";
      const name = wareName(cmd.item);
      const menu = kind === "village" ? ["heal", "blade"] : ["blessing"];
      if (!menu.includes(name)) return `for sale: ${menu.map((m) => `${m} (${WARES[m as keyof typeof WARES].cost}g)`).join(", ")}`;
      if (kind === "well" && (s.asks > 0 || (s.devilGone && s.resolved))) return ONE_CHOICE.well.devil; // the first ask, or an accepted opener
      if (kind === "well" && s.resolved) return "the well has given what it will give";
      if (kind === "well" && s.offer) return "the devil is waiting for your answer: accept() or refuse()";
      const cost = WARES[name as keyof typeof WARES].cost;
      return s.player.gold < cost ? `${name} costs ${cost}g; you have ${s.player.gold}g` : null;
    }
    case "deal": {
      if (over) return over;
      if (!devilPresent(s)) return "the devil does not sit here";
      { const oc = oneChoice(s); if (oc && s.resolved && s.asks === 0) return oc.spent; } // rested, trained or blessed
      if (devilDone(s)) return "the devil has already gone";
      if (s.enemy) return "not while something is trying to kill you";
      if (isOpener(s, cmd.text)) return null; // his opening pitch is free: no ask, no question
      if (s.totalAsks >= MAX_DEVIL_QUERIES) return "The devil has heard enough from you this run.";
      return s.asks >= MAX_ASKS ? "he is done haggling: accept() or refuse()" : null;
    }
    case "accept": case "refuse": return over ?? (s.offer ? null : "no offer on the table; deal()");
    case "devil_reply": return over ?? (s.pending ? null : "nobody asked the devil anything; deal() first");
    case "fight_result": return over ?? (s.pendingFight ? null : "no fight is on; fight with realtime first");
    default: return `unknown command ${show(c.cmd)}`;
  }
}

/** Never throws: a Symbol, BigInt or an object whose valueOf/toString throws is just "no such exit" / "no such ware". */
const goIndex = (n: unknown): number => { try { return typeof n === "string" && n.trim() === "" ? NaN : Number(n); } catch { return NaN; } };
const text = (v: unknown): string => { try { return String(v); } catch { return typeof v; } };
const wareName = (item: unknown): string => text(item ?? "").trim().toLowerCase();
/** JSON.stringify for a rejection message, without throwing on BigInt, circular objects or throwing getters. */
const show = (v: unknown): string => { try { return String(JSON.stringify(v)); } catch { return typeof v; } };
/** Longest player text the engine keeps and sends to the devil (code units; longer text is cut). */
export const MAX_PLAYER_TEXT = 2000;


/** Apply one command. See the file comment. */
export function step(state: GameState, cmd: Command): StepResult {
  const reason = rejection(state, cmd);
  if (reason !== null) return { ok: false, state, events: [{ type: "rejected", reason }], actions: legalActions(state), ...awaitingOf(state) };
  if (cmd.cmd === "look") return { ok: true, state, events: [looked(state)], actions: legalActions(state), ...awaitingOf(state) };
  const d = clone(state), ev: GameEvent[] = [];
  switch (cmd.cmd) {
    case "go": go(d, ev, goIndex(cmd.n)); break;
    case "fight":
      if (cmd.realtime === true) { // the realtime round trip: no dice used here, the client plays it out
        const e = d.enemy!;
        e.bouts = (e.bouts ?? 0) + 1;
        d.pendingFight = fightRequest(d, e, e.bouts);
      } else fight(d, ev);
      break;
    case "fight_result": fightResult(d, ev, cmd); break;
    case "rest":
      d.resolved = true;
      healBy(d, ev, Math.ceil(d.player.maxHp * 0.4), "the campfire");
      break;
    case "train": { // the campfire's other choice: spends the fire just like rest
      d.resolved = true;
      const amount = applyEffects(d.player, { attack: TRAIN_ATTACK }).attack ?? 0;
      ev.push({ type: "trained", amount, attack: d.player.attack });
      note(d.player, `trained by the fire: attack ${d.player.attack}`);
      break;
    }
    case "buy": buy(d, ev, wareName(cmd.item)); break;
    case "deal":
      if (d.dying) { // a haggle at death's door: one question, and his price climbs (context.haggle)
        d.dying.haggles++; d.totalAsks++;
        d.pending = deathRequest(d, typeof cmd.text === "string" ? cut(cmd.text, MAX_PLAYER_TEXT) : null);
        break;
      }
      if (isOpener(d, cmd.text)) { // the opening offer: free, once per node, no text (the devil pitches to the state)
        d.opened = true;
        d.pending = { state: snapshot(d.player), context: { ...devilContext(d), opening: true }, playerText: null };
        break;
      }
      d.asks++; d.totalAsks++;
      d.pending = { state: snapshot(d.player), context: devilContext(d), playerText: typeof cmd.text === "string" ? cut(cmd.text, MAX_PLAYER_TEXT) : null };
      break;
    case "devil_reply":
      d.pending = null;
      { const deal = sanitizeDeal(cmd.deal);
        if (deal.forced && d.dying) deathStrike(d, ev, deal); // he loses patience and just takes the soul
        else if (deal.forced) strike(d, ev, deal); // a punishment, not an offer: applied now, node stays open
        else { d.offer = deal; ev.push({ type: "deal_offered", deal }); } }
      break;
    case "accept": if (d.dying) deathAccept(d, ev); else accept(d, ev); break;
    case "refuse":
      if (d.dying) { deathRefuse(d, ev); break; }
      decided(d, false);
      ev.push({ type: "deal_refused" });
      break;
  }
  if (d.dying && !state.dying && !d.ending) d.pending = deathRequest(d, null); // just died with the soul: his opener
  return { ok: true, state: d, events: ev, actions: legalActions(d), ...awaitingOf(d) };
}

const awaitingOf = (s: GameState): Pick<StepResult, "awaiting"> =>
  s.pending ? { awaiting: { devil: clone(s.pending) } } : s.pendingFight ? { awaiting: { fight: clone(s.pendingFight) } } : {};

// ---- the rules (each mutates the draft only) ---------------------------------------------------------------------

function roll(d: GameState, n: number): number {
  const [v, next] = nextRandom(d.rng);
  d.rng = next;
  return Math.floor(v * n);
}

/** Gold for a kill (KILL_GOLD / BOSS_GOLD in economy.ts): one die, as before, so the dice stream is unchanged. */
function bounty(d: GameState, e: Enemy): number {
  const g = e.boss ? BOSS_GOLD : KILL_GOLD, act = Math.min(d.player.act, g.base.length - 1);
  return g.base[act] + roll(d, g.spread);
}

/**
 * HP <= 0: with the soul still yours, the run pauses at death's door (`dying`; the devil's request is made at the end of
 * the command, see `step`); without it, the run is lost.
 */
function settleHp(d: GameState, ev: GameEvent[], cause: string): void {
  if (d.ending || d.dying) return;
  normalize(d.player);
  if (d.player.hp <= 0 && d.player.soul === 1) {
    d.dying = { cause, haggles: 0, ...(d.offer ? { standing: d.offer } : {}) };
    d.offer = null;
    ev.push({ type: "devil_at_death", cause, nodeId: d.player.nodeId });
    note(d.player, `at death's door: ${cause}`);
    return;
  }
  const r = settle(d.player);
  if (r === "revived") { ev.push({ type: "revived", hp: d.player.hp }); note(d.player, "soul spent on a revival"); }
  else if (r === "dead") { d.ending = "lose"; ev.push({ type: "lost", cause }); note(d.player, `died: ${cause}`); }
}

/** Fire the curses on `trigger`, each removed as it fires; none while dead or dying (the rest wait for the next trigger). */
function fire(d: GameState, ev: GameEvent[], trigger: Curse["trigger"]): void {
  for (const c of d.curses.filter((x) => x.trigger === trigger)) {
    if (d.ending || d.dying) return;
    d.curses.splice(d.curses.indexOf(c), 1);
    const changes = applyEffects(d.player, c.effect);
    ev.push({ type: "curse_fired", trigger, effect: c.effect, changes });
    settleHp(d, ev, "a curse");
  }
}

function healBy(d: GameState, ev: GameEvent[], amount: number, source: string): void {
  if (d.dying) return; // the devil decides whether there is anyone left to heal
  const was = d.player.hp;
  heal(d.player, amount);
  if (d.player.hp > was) ev.push({ type: "healed", amount: d.player.hp - was, source, hp: d.player.hp });
}

export function looked(s: GameState): GameEvent {
  const { hp, maxHp, gold, attack, soul } = s.player;
  return {
    type: "looked", act: s.player.act, nodeId: s.player.nodeId, kind: currentNode(s).kind, stats: { hp, maxHp, gold, attack, soul },
    exits: exitsOf(s), enemy: s.enemy && enemyView(s.enemy), resolved: s.resolved, curses: s.curses.map((c) => ({ ...c })), offer: s.offer,
  };
}

function enter(d: GameState, ev: GameEvent[], id: string, from: string, fromDeal: boolean): void {
  const a = currentAct(d);
  d.player.nodeId = id;
  d.resolved = false; d.offer = null; d.asks = 0; d.enemy = null;
  delete d.devilGone; delete d.opened;
  if (fromDeal) ev.push({ type: "devil_stage_left", nodeId: from });
  if (id === "final" && a.final) {
    ev.push({ type: "moved", from, to: id, kind: "final", act: a.index });
    d.ending = d.player.soul === 1 ? "win" : "hell";
    ev.push({ type: d.ending === "win" ? "won" : "hell" });
    return;
  }
  d.acts[a.index] = markVisited(a, id);
  const node = a.nodes.find((n) => n.id === id)!;
  ev.push({ type: "moved", from, to: id, kind: node.kind, act: a.index });
  if (node.kind === "deal") ev.push({ type: "devil_stage_entered", nodeId: id });
  if (node.kind === "well" && devilAtWell(d.seed, id)) ev.push({ type: "devil_appears", nodeId: id, kind: node.kind });
  fire(d, ev, "on_enter");
  if (d.ending) return;
  if (node.kind === "fight" || node.kind === "boss") {
    const boss = node.kind === "boss";
    const enemy: Enemy = boss
      ? { name: BOSSES[a.index], hp: BOSS.hp[a.index], maxHp: BOSS.hp[a.index], power: BOSS.power[a.index], boss }
      : { name: FOES[a.index][roll(d, 3)], hp: 0, maxHp: 0, power: FOE.power[a.index], boss };
    if (!boss) enemy.hp = enemy.maxHp = FOE.hp[a.index] + roll(d, FOE.hpSpread);
    d.enemy = enemy;
    ev.push({ type: "enemy_appeared", enemy: enemyView(enemy) });
    fire(d, ev, "on_fight");
  }
}

function go(d: GameState, ev: GameEvent[], i: number): void {
  const exits = exitsOf(d);
  const from = d.player.nodeId, fromDeal = currentNode(d).kind === "deal";
  fire(d, ev, "next_node");
  if (d.ending || d.dying) return; // died on the way out: you go nowhere until the devil is answered
  const ex = exits[i - 1];
  if (ex.kind === "stairs") {
    d.player.act++;
    const next = generateAct(d.seed, d.player.act); // lazily, on arrival
    d.acts[d.player.act] = next;
    ev.push({ type: "act_advanced", act: d.player.act });
    healBy(d, ev, FREE_HEAL.stairs, "the stairs");
    enter(d, ev, next.entry, from, fromDeal);
  } else if (ex.kind === "gate") {
    enter(d, ev, "final", from, fromDeal);
  } else {
    enter(d, ev, currentNode(d).next[i - 1], from, fromDeal);
  }
}

function fight(d: GameState, ev: GameEvent[]): void {
  const e = d.enemy!;
  const dealt = d.player.attack + roll(d, 3);
  e.hp = Math.max(0, e.hp - dealt);
  if (e.hp === 0) {
    const gold = bounty(d, e);
    addGold(d.player, gold);
    d.enemy = null; d.resolved = true;
    ev.push({ type: "fought", dealt, enemyHp: 0, taken: 0 }, { type: "enemy_slain", name: e.name, gold, boss: e.boss });
    if (e.boss) healBy(d, ev, FREE_HEAL.victory, "victory");
    return;
  }
  const taken = e.power + roll(d, 3);
  hurt(d.player, taken);
  ev.push({ type: "fought", dealt, enemyHp: e.hp, taken }, { type: "damaged", amount: taken, source: e.name, hp: d.player.hp });
  fire(d, ev, "on_hit");
  settleHp(d, ev, e.name);
}

/**
 * Apply a realtime fight's (sanitized) result through the same events as a round: `fought`, `damaged`, the `on_hit`
 * curses (once if any hit landed: curses are spent when they fire, so once per hit would be the same), the death check
 * (revival keeps the enemy, at the HP it was left on, for another fight), then, if the enemy fell, `enemy_slain`, gold
 * and the boss's victory heal. An unfinished fight just leaves both sides where they were.
 */
function fightResult(d: GameState, ev: GameEvent[], report: unknown): void {
  const req = d.pendingFight!, e = d.enemy!;
  d.pendingFight = null;
  const r = sanitizeFightResult(report, req);
  const taken = req.player.hp - r.hpLeft;
  e.hp = r.enemyHpLeft;
  ev.push({ type: "fought", dealt: r.damageDealt, enemyHp: e.hp, taken, bout: { timeMs: r.timeMs, hits: r.hitsTaken, enemy: e.name, outcome: r.outcome } });
  if (taken > 0) {
    hurt(d.player, taken);
    ev.push({ type: "damaged", amount: taken, source: e.name, hp: d.player.hp });
  }
  if (r.hitsTaken > 0) fire(d, ev, "on_hit");
  settleHp(d, ev, e.name);
  if (d.ending || r.outcome !== "won") return;
  const gold = bounty(d, e);
  addGold(d.player, gold);
  d.enemy = null; d.resolved = true;
  ev.push({ type: "enemy_slain", name: e.name, gold, boss: e.boss });
  if (e.boss) healBy(d, ev, FREE_HEAL.victory, "victory");
}

function buy(d: GameState, ev: GameEvent[], name: string): void {
  const cost = WARES[name as keyof typeof WARES].cost;
  spend(d.player, cost);
  let effects: Record<string, number>;
  if (name === "heal") effects = { hp: 12 };
  else if (name === "blade") effects = { attack: 1 };
  else { effects = [{ max_hp: 3 }, { attack: 1 }, { hp: 8 }][roll(d, 3)]; d.resolved = true; }
  const changes: Deltas = applyEffects(d.player, effects);
  ev.push({ type: "bought", item: name, cost, changes });
}

/**
 * A forced devil reply (already sanitized: HP loss only, capped). Applied immediately; goes through the normal death/revive
 * check. It does not resolve the node and does not touch a standing offer (the ask was already counted by `deal`).
 */
function strike(d: GameState, ev: GameEvent[], deal: Deal): void {
  const changes = applyEffects(d.player, deal.effects);
  ev.push({ type: "devil_struck", dialogue: deal.dialogue, effects: changes });
  note(d.player, `the devil struck: ${deal.dialogue.slice(0, 60)}`);
  settleHp(d, ev, "the devil's wrath");
}

/**
 * A deal accepted or refused: it spends a deal node or a campfire (`resolved`). At a well the devil leaves (`devilGone`);
 * accepting there also spends the well's one choice (`resolved` with `devilGone`), while refusing his opener leaves the
 * blessing open (a typed ask had locked it already).
 */
function decided(d: GameState, accepted: boolean): void {
  d.offer = null; d.dealsDecided++;
  if (currentNode(d).kind === "well") { d.devilGone = true; if (accepted) d.resolved = true; }
  else d.resolved = true;
}

function accept(d: GameState, ev: GameEvent[]): void {
  const deal = d.offer!;
  decided(d, true);
  const changes = applyEffects(d.player, deal.effects);
  ev.push({ type: "deal_applied", deal, changes });
  note(d.player, `deal accepted: ${deal.dialogue.slice(0, 60)}`);
  if (deal.curse && d.curses.length < MAX_CURSES) {
    d.curses.push({ trigger: deal.curse.trigger, effect: deal.curse.effect });
    ev.push({ type: "curse_added", curse: deal.curse });
  }
  if (deal.rewrite) {
    const r = rewriteNode(currentAct(d), deal.rewrite.nodeId, deal.rewrite.to);
    if (r.ok) { d.acts[d.player.act] = r.act; ev.push({ type: "node_rewritten", change: r.change }); }
    else ev.push({ type: "rewrite_failed", nodeId: deal.rewrite.nodeId, reason: r.reason });
  }
  settleHp(d, ev, "the devil's bargain");
}

// ---- death's door ------------------------------------------------------------------------------------------------

/** The devil's request at death's door: his opener (`text` null) or a haggle. `context.kind` is "death" (devilContext). */
function deathRequest(d: GameState, text: string | null): DevilRequest {
  return { state: snapshot(d.player), context: { ...devilContext(d), ...(text === null ? { opening: true } : {}) }, playerText: text };
}

/** Stat changes between two snapshots, keyed like applyEffects' result (zero changes omitted). */
function diff(was: PlayerState, now: PlayerState): Deltas {
  const out: Deltas = {};
  const put = (k: keyof Deltas, a: number, b: number) => { if (a !== b) out[k] = b - a; };
  put("max_hp", was.maxHp, now.maxHp); put("hp", was.hp, now.hp); put("gold", was.gold, now.gold);
  put("attack", was.attack, now.attack); put("soul", was.soul, now.soul);
  return out;
}

/** Leave death's door: the interrupted node offer (if any) is back on the table. */
function leaveDeath(d: GameState): void {
  d.offer = d.dying?.standing ?? null;
  d.dying = null;
}

/** Back from the dead, the soul gone: the `revived` event and the log line the HUD reads ("soul spent on a revival"). */
function revive(d: GameState, ev: GameEvent[], how: string): void {
  ev.push({ type: "revived", hp: d.player.hp });
  note(d.player, `soul spent on a revival: ${how}`);
}

/**
 * The soul sold for another life. Whatever his offer says, the engine holds the core of the bargain: the soul goes, and
 * you wake with at least the old revival's HP (`reviveHp`), so a junk, silent or spiteful reply can neither keep you at 0
 * HP nor let you keep the soul. His extras (gold, attack, max HP) and their price (curse, rewrite, max HP loss) apply as
 * usual. Not a node decision: `resolved` and `dealsDecided` are untouched.
 */
function deathAccept(d: GameState, ev: GameEvent[]): void {
  const deal = d.offer!, was = snapshot(d.player);
  leaveDeath(d);
  applyEffects(d.player, deal.effects);
  d.player.soul = 0;
  d.player.hp = Math.max(d.player.hp, reviveHp(d.player.maxHp));
  normalize(d.player);
  ev.push({ type: "deal_applied", deal, changes: diff(was, d.player) });
  note(d.player, `sold the soul at death's door: ${deal.dialogue.slice(0, 60)}`);
  if (deal.curse && d.curses.length < MAX_CURSES) {
    d.curses.push({ trigger: deal.curse.trigger, effect: deal.curse.effect });
    ev.push({ type: "curse_added", curse: deal.curse });
  }
  if (deal.rewrite) {
    const r = rewriteNode(currentAct(d), deal.rewrite.nodeId, deal.rewrite.to);
    if (r.ok) { d.acts[d.player.act] = r.act; ev.push({ type: "node_rewritten", change: r.change }); }
    else ev.push({ type: "rewrite_failed", nodeId: deal.rewrite.nodeId, reason: r.reason });
  }
  revive(d, ev, "sold at death's door");
}

/** No deal: the death stands. You die with your soul ("lose"; "hell" is reaching the final door without it). */
function deathRefuse(d: GameState, ev: GameEvent[]): void {
  const cause = d.dying!.cause;
  d.dying = null; d.offer = null;
  ev.push({ type: "deal_refused" });
  d.ending = "lose";
  ev.push({ type: "lost", cause });
  note(d.player, `died: ${cause} (refused the devil)`);
}

/**
 * A strike at death's door (gibberish, off-topic text or a jailbreak, and a bad roll): he loses patience and takes the soul
 * anyway, for the least life there is: 1 HP, no extras. Never better than his offer, and the run goes on (a typo should not
 * end a run; refuse is the way to die).
 */
function deathStrike(d: GameState, ev: GameEvent[], deal: Deal): void {
  const was = snapshot(d.player);
  leaveDeath(d);
  d.player.soul = 0;
  d.player.hp = Math.max(d.player.hp, 1);
  normalize(d.player);
  ev.push({ type: "devil_struck", dialogue: deal.dialogue, effects: diff(was, d.player) });
  note(d.player, `the devil took the soul: ${deal.dialogue.slice(0, 60)}`);
  revive(d, ev, "taken by force at death's door");
}
