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
 */
import { generateAct, markVisited, nextRandom, rewriteNode } from "../map";
import { legalActions } from "./actions";
import { sanitizeDeal } from "./deal";
import type { Curse } from "./devil";
import type { Deltas, GameEvent } from "./events";
import {
  BOSSES, FOES, MAX_ASKS, MAX_CURSES, TRAIN_ATTACK, WARES, currentAct, currentNode, devilContext, enemyView, exitsOf,
  type Command, type Enemy, type GameState, type StepResult,
} from "./gameState";
import { STAT_RANGE, addGold, applyEffects, heal, hurt, note, settle, snapshot, spend } from "./state";

const clone = <T>(x: T): T => structuredClone(x);

/** Why `cmd` would be rejected in `s`, or null if it is legal. Checks only; same order and wording as ever. */
export function rejection(s: GameState, cmd: Command): string | null {
  const c = cmd as { cmd: unknown };
  if (c.cmd === "look") return null;
  if (s.pending && c.cmd !== "devil_reply") return "the devil is still speaking";
  const over = s.ending ? `the run is over (${s.ending}); start a new game` : null;
  switch (cmd.cmd) {
    case "go": {
      if (over) return over;
      if (s.enemy) return `${s.enemy.name} blocks the way; fight()`;
      const exits = exitsOf(s), i = goIndex(cmd.n);
      if (!Number.isInteger(i) || i < 1 || i > exits.length) return `no exit ${String(cmd.n)}; choose 1..${exits.length}`;
      return null;
    }
    case "fight": return over ?? (s.enemy ? null : "nothing here to fight");
    case "rest": case "train": {
      if (over) return over;
      if (currentNode(s).kind !== "campfire") return "there is no fire here";
      if (s.resolved) return "the embers are spent";
      return cmd.cmd === "train" && s.player.attack >= STAT_RANGE.attack[1] ? `your attack is already at its peak (${STAT_RANGE.attack[1]})` : null;
    }
    case "buy": {
      if (over) return over;
      const kind = currentNode(s).kind;
      if (kind !== "village" && kind !== "well") return "nobody here is selling";
      const name = wareName(cmd.item);
      const menu = kind === "village" ? ["heal", "blade"] : ["blessing"];
      if (!menu.includes(name)) return `for sale: ${menu.map((m) => `${m} (${WARES[m as keyof typeof WARES].cost}g)`).join(", ")}`;
      if (kind === "well" && s.resolved) return "the well has given what it will give";
      const cost = WARES[name as keyof typeof WARES].cost;
      return s.player.gold < cost ? `${name} costs ${cost}g; you have ${s.player.gold}g` : null;
    }
    case "deal": {
      if (over) return over;
      if (currentNode(s).kind !== "deal") return "the devil does not sit here";
      if (s.resolved) return "the devil has already gone";
      if (s.enemy) return "not while something is trying to kill you";
      return s.asks >= MAX_ASKS ? "he is done haggling: accept() or refuse()" : null;
    }
    case "accept": case "refuse": return over ?? (s.offer ? null : "no offer on the table; deal()");
    case "devil_reply": return over ?? (s.pending ? null : "nobody asked the devil anything; deal() first");
    default: return `unknown command ${JSON.stringify(c.cmd)}`;
  }
}

const goIndex = (n: unknown): number => (typeof n === "string" && n.trim() === "" ? NaN : Number(n));
const wareName = (item: unknown): string => String(item ?? "").trim().toLowerCase();

/** Apply one command. See the file comment. */
export function step(state: GameState, cmd: Command): StepResult {
  const reason = rejection(state, cmd);
  if (reason !== null) return { ok: false, state, events: [{ type: "rejected", reason }], actions: legalActions(state), ...awaitingOf(state) };
  if (cmd.cmd === "look") return { ok: true, state, events: [looked(state)], actions: legalActions(state), ...awaitingOf(state) };
  const d = clone(state), ev: GameEvent[] = [];
  switch (cmd.cmd) {
    case "go": go(d, ev, goIndex(cmd.n)); break;
    case "fight": fight(d, ev); break;
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
      d.asks++; d.totalAsks++;
      d.pending = { state: snapshot(d.player), context: devilContext(d), playerText: typeof cmd.text === "string" ? cmd.text : null };
      break;
    case "devil_reply":
      d.pending = null;
      d.offer = sanitizeDeal(cmd.deal);
      ev.push({ type: "deal_offered", deal: d.offer });
      break;
    case "accept": accept(d, ev); break;
    case "refuse":
      d.offer = null; d.resolved = true; d.dealsDecided++;
      ev.push({ type: "deal_refused" });
      break;
  }
  return { ok: true, state: d, events: ev, actions: legalActions(d), ...awaitingOf(d) };
}

const awaitingOf = (s: GameState): Pick<StepResult, "awaiting"> => (s.pending ? { awaiting: { devil: clone(s.pending) } } : {});

// ---- the rules (each mutates the draft only) ---------------------------------------------------------------------

function roll(d: GameState, n: number): number {
  const [v, next] = nextRandom(d.rng);
  d.rng = next;
  return Math.floor(v * n);
}

/** HP <= 0 loses unless the soul can pay once. */
function settleHp(d: GameState, ev: GameEvent[], cause: string): void {
  if (d.ending) return;
  const r = settle(d.player);
  if (r === "revived") { ev.push({ type: "revived", hp: d.player.hp }); note(d.player, "soul spent on a revival"); }
  else if (r === "dead") { d.ending = "lose"; ev.push({ type: "lost", cause }); note(d.player, `died: ${cause}`); }
}

function fire(d: GameState, ev: GameEvent[], trigger: Curse["trigger"]): void {
  const hit = d.curses.filter((c) => c.trigger === trigger);
  if (!hit.length) return;
  d.curses = d.curses.filter((c) => c.trigger !== trigger);
  for (const c of hit) {
    if (d.ending) return;
    const changes = applyEffects(d.player, c.effect);
    ev.push({ type: "curse_fired", trigger, effect: c.effect, changes });
    settleHp(d, ev, "a curse");
  }
}

function healBy(d: GameState, ev: GameEvent[], amount: number, source: string): void {
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
  fire(d, ev, "on_enter");
  if (d.ending) return;
  if (node.kind === "fight" || node.kind === "boss") {
    const boss = node.kind === "boss";
    const enemy: Enemy = boss
      ? { name: BOSSES[a.index], hp: 18 + 8 * a.index, maxHp: 18 + 8 * a.index, power: 3 + a.index, boss }
      : { name: FOES[a.index][roll(d, 3)], hp: 0, maxHp: 0, power: 2 + a.index, boss };
    if (!boss) enemy.hp = enemy.maxHp = 8 + 4 * a.index + roll(d, 4);
    d.enemy = enemy;
    ev.push({ type: "enemy_appeared", enemy: enemyView(enemy) });
    fire(d, ev, "on_fight");
  }
}

function go(d: GameState, ev: GameEvent[], i: number): void {
  const exits = exitsOf(d);
  const from = d.player.nodeId, fromDeal = currentNode(d).kind === "deal";
  fire(d, ev, "next_node");
  if (d.ending) return;
  const ex = exits[i - 1];
  if (ex.kind === "stairs") {
    d.player.act++;
    const next = generateAct(d.seed, d.player.act); // lazily, on arrival
    d.acts[d.player.act] = next;
    ev.push({ type: "act_advanced", act: d.player.act });
    healBy(d, ev, 6, "the stairs");
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
    const gold = e.boss ? 12 + roll(d, 6) : 4 + roll(d, 5) + d.player.act;
    addGold(d.player, gold);
    d.enemy = null; d.resolved = true;
    ev.push({ type: "fought", dealt, enemyHp: 0, taken: 0 }, { type: "enemy_slain", name: e.name, gold, boss: e.boss });
    if (e.boss) healBy(d, ev, 10, "victory");
    return;
  }
  const taken = e.power + roll(d, 3);
  hurt(d.player, taken);
  ev.push({ type: "fought", dealt, enemyHp: e.hp, taken }, { type: "damaged", amount: taken, source: e.name, hp: d.player.hp });
  fire(d, ev, "on_hit");
  settleHp(d, ev, e.name);
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

function accept(d: GameState, ev: GameEvent[]): void {
  const deal = d.offer!;
  d.offer = null; d.resolved = true; d.dealsDecided++;
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
