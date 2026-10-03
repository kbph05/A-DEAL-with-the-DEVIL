/**
 * Headless game engine: no DOM, no console. Every command returns `{ ok, events, state }`; rendering is somebody
 * else's job (console.ts, tests, autoplay).
 */
import { ACTS, generateAct, hashSeed, markVisited, mulberry32, rewriteNode, type Act, type Kind, type MapNode, type RewriteChange, type Rng } from "../map";
import { sanitizeDeal } from "./deal";
import { devilFor, type Curse, type Deal, type Devil, type DevilContext } from "./devil";
import type { Deltas, EnemyView, Ending, Exit, GameEvent, Result } from "./events";
import { addGold, applyEffects, heal, hurt, newPlayer, normalize, note, settle, snapshot, spend, type PlayerState } from "./state";

interface Enemy extends EnemyView { power: number }

const FOES = [["cave rat", "drowned monk", "ash hound"], ["bone mason", "glass wolf", "hollow knight"], ["choir of moths", "gilded wretch", "the unlit"]];
const BOSSES = ["the Gatekeeper", "the Cartographer of Ruin", "the Devil's Left Hand"];
const MAX_CURSES = 5;
const MAX_ASKS = 3;
export const WARES = { heal: { cost: 10 }, blade: { cost: 15 }, blessing: { cost: 8 } } as const;

export interface MapViewNode { id: string; kind: Kind; visited: boolean; current: boolean; rewritten: boolean; next: string[] }
/** Plain data for the current act: layers of nodes, so any frontend can draw (or assert on) it. */
export interface MapView { act: number; layers: Array<{ layer: number; nodes: MapViewNode[] }>; final?: MapViewNode; changes: RewriteChange[] }

/** What a policy (bot, test, UI) gets to see before choosing a command. */
export interface Observation {
  state: PlayerState; nodeId: string; kind: Kind; act: number; enemy: EnemyView | null; exits: Exit[];
  offer: Deal | null; resolved: boolean; pending: boolean; dealsDecided: number; ending: Ending | null;
}

export class Game {
  readonly seed: string;
  readonly state: PlayerState;
  ending: Ending | null = null;
  private acts: Act[];
  private rng: Rng;
  private devil: Devil;
  private curses: Curse[] = [];
  private enemy: Enemy | null = null;
  private resolved = false;
  private offer: Deal | null = null;
  private pending = false;
  private asks = 0;
  private totalAsks = 0;
  private dealsDecided = 0;

  constructor(seed: string, devil: Devil) {
    this.seed = seed;
    this.devil = devil;
    this.rng = mulberry32(hashSeed(`dice:${seed}`));
    const act0 = generateAct(seed, 0);
    this.acts = [markVisited(act0, act0.entry)];
    this.state = newPlayer(act0.entry);
  }

  // ---- queries -------------------------------------------------------------------------------

  private get act(): Act { return this.acts[this.state.act]; }
  private get node(): MapNode {
    const a = this.act;
    return this.state.nodeId === "final" && a.final ? a.final : a.nodes.find((n) => n.id === this.state.nodeId)!;
  }

  private exits(): Exit[] {
    if (this.enemy || this.ending) return [];
    const a = this.act, n = this.node;
    if (n.kind === "final") return [];
    if (n.id === a.exit) return [{ n: 1, kind: a.index < ACTS - 1 ? "stairs" : "gate" }];
    return n.next.map((id, i) => ({ n: i + 1, kind: a.nodes.find((m) => m.id === id)!.kind }));
  }

  observe(): Observation {
    return {
      state: snapshot(this.state), nodeId: this.state.nodeId, kind: this.node.kind, act: this.state.act,
      enemy: this.enemy && this.view(this.enemy), exits: this.exits(), offer: this.offer, resolved: this.resolved,
      pending: this.pending, dealsDecided: this.dealsDecided, ending: this.ending,
    };
  }

  map(): MapView {
    const a = this.act;
    const rewritten = new Set(a.changes.map((c) => c.nodeId));
    const mv = (n: MapNode): MapViewNode => ({ id: n.id, kind: n.kind, visited: a.visited.includes(n.id), current: n.id === this.state.nodeId, rewritten: rewritten.has(n.id), next: [...n.next] });
    const layers: MapView["layers"] = [];
    for (const n of a.nodes) (layers[n.layer] ??= { layer: n.layer, nodes: [] }).nodes.push(mv(n));
    return { act: a.index, layers, final: a.final && mv(a.final), changes: [...a.changes] };
  }

  private view(e: Enemy): EnemyView { return { name: e.name, hp: e.hp, maxHp: e.maxHp, boss: e.boss }; }
  private roll(n: number): number { return Math.floor(this.rng() * n); }
  private done(ev: GameEvent[]): Result { return { ok: true, events: ev, state: snapshot(this.state) }; }
  private reject(reason: string): Result { return { ok: false, events: [{ type: "rejected", reason }], state: snapshot(this.state) }; }
  private blocked(): Result | null { return this.ending ? this.reject(`the run is over (${this.ending}); start a new game`) : null; }

  /** HP <= 0 loses unless the soul can pay once. */
  private settleHp(ev: GameEvent[], cause: string): void {
    if (this.ending) return;
    const r = settle(this.state);
    if (r === "revived") { ev.push({ type: "revived", hp: this.state.hp }); note(this.state, "soul spent on a revival"); }
    else if (r === "dead") { this.ending = "lose"; ev.push({ type: "lost", cause }); note(this.state, `died: ${cause}`); }
  }

  private fire(ev: GameEvent[], trigger: Curse["trigger"]): void {
    const hit = this.curses.filter((c) => c.trigger === trigger);
    if (!hit.length) return;
    this.curses = this.curses.filter((c) => c.trigger !== trigger);
    for (const c of hit) {
      if (this.ending) return;
      const changes = applyEffects(this.state, c.effect);
      ev.push({ type: "curse_fired", trigger, effect: c.effect, changes });
      this.settleHp(ev, "a curse");
    }
  }

  private looked(): GameEvent {
    const { hp, maxHp, gold, attack, soul } = this.state;
    return {
      type: "looked", act: this.state.act, nodeId: this.state.nodeId, kind: this.node.kind, stats: { hp, maxHp, gold, attack, soul },
      exits: this.exits(), enemy: this.enemy && this.view(this.enemy), resolved: this.resolved, curses: this.curses.map((c) => ({ ...c })), offer: this.offer,
    };
  }

  private enter(ev: GameEvent[], id: string, from: string): void {
    const a = this.act;
    this.state.nodeId = id;
    this.resolved = false; this.offer = null; this.asks = 0; this.enemy = null;
    if (id === "final" && a.final) {
      ev.push({ type: "moved", from, to: id, kind: "final", act: a.index });
      this.ending = this.state.soul === 1 ? "win" : "hell";
      ev.push({ type: this.ending === "win" ? "won" : "hell" });
      return;
    }
    this.acts[a.index] = markVisited(a, id);
    const node = a.nodes.find((n) => n.id === id)!;
    ev.push({ type: "moved", from, to: id, kind: node.kind, act: a.index });
    this.fire(ev, "on_enter");
    if (this.ending) return;
    if (node.kind === "fight" || node.kind === "boss") {
      const boss = node.kind === "boss";
      const enemy: Enemy = boss
        ? { name: BOSSES[a.index], hp: 18 + 8 * a.index, maxHp: 18 + 8 * a.index, power: 3 + a.index, boss }
        : { name: FOES[a.index][this.roll(3)], hp: 0, maxHp: 0, power: 2 + a.index, boss };
      if (!boss) enemy.hp = enemy.maxHp = 8 + 4 * a.index + this.roll(4);
      this.enemy = enemy;
      ev.push({ type: "enemy_appeared", enemy: this.view(enemy) });
      this.fire(ev, "on_fight");
    }
  }

  // ---- commands ------------------------------------------------------------------------------

  look(): Result { return this.done([this.looked()]); }

  go(n: number | string): Result {
    const stop = this.blocked(); if (stop) return stop;
    if (this.enemy) return this.reject(`${this.enemy.name} blocks the way; fight()`);
    if (this.pending) return this.reject("the devil is still speaking");
    const exits = this.exits();
    const i = typeof n === "string" && n.trim() === "" ? NaN : Number(n);
    if (!Number.isInteger(i) || i < 1 || i > exits.length) return this.reject(`no exit ${String(n)}; choose 1..${exits.length}`);
    const ev: GameEvent[] = [];
    const from = this.state.nodeId;
    this.fire(ev, "next_node");
    if (this.ending) return this.done(ev);
    const ex = exits[i - 1];
    if (ex.kind === "stairs") {
      this.state.act++;
      const next = generateAct(this.seed, this.state.act); // lazily, on arrival
      this.acts[this.state.act] = next;
      ev.push({ type: "act_advanced", act: this.state.act });
      this.healBy(ev, 6, "the stairs");
      this.enter(ev, next.entry, from);
    } else if (ex.kind === "gate") {
      this.enter(ev, "final", from);
    } else {
      this.enter(ev, this.node.next[i - 1], from);
    }
    return this.done(ev);
  }

  private healBy(ev: GameEvent[], amount: number, source: string): void {
    const was = this.state.hp;
    heal(this.state, amount);
    if (this.state.hp > was) ev.push({ type: "healed", amount: this.state.hp - was, source, hp: this.state.hp });
  }

  fight(): Result {
    const stop = this.blocked(); if (stop) return stop;
    const e = this.enemy;
    if (!e) return this.reject("nothing here to fight");
    const ev: GameEvent[] = [];
    const dealt = this.state.attack + this.roll(3);
    e.hp = Math.max(0, e.hp - dealt);
    if (e.hp === 0) {
      const gold = e.boss ? 12 + this.roll(6) : 4 + this.roll(5) + this.state.act;
      addGold(this.state, gold);
      this.enemy = null; this.resolved = true;
      ev.push({ type: "fought", dealt, enemyHp: 0, taken: 0 }, { type: "enemy_slain", name: e.name, gold, boss: e.boss });
      if (e.boss) this.healBy(ev, 10, "victory");
      return this.done(ev);
    }
    const taken = e.power + this.roll(3);
    hurt(this.state, taken);
    ev.push({ type: "fought", dealt, enemyHp: e.hp, taken }, { type: "damaged", amount: taken, source: e.name, hp: this.state.hp });
    this.fire(ev, "on_hit");
    this.settleHp(ev, e.name);
    return this.done(ev);
  }

  rest(): Result {
    const stop = this.blocked(); if (stop) return stop;
    if (this.node.kind !== "campfire") return this.reject("there is no fire here");
    if (this.resolved) return this.reject("the embers are spent");
    const ev: GameEvent[] = [];
    this.resolved = true;
    this.healBy(ev, Math.ceil(this.state.maxHp * 0.4), "the campfire");
    return this.done(ev);
  }

  buy(item?: string): Result {
    const stop = this.blocked(); if (stop) return stop;
    const kind = this.node.kind;
    if (kind !== "village" && kind !== "well") return this.reject("nobody here is selling");
    const name = String(item ?? "").trim().toLowerCase();
    const menu = kind === "village" ? ["heal", "blade"] : ["blessing"];
    if (!menu.includes(name)) return this.reject(`for sale: ${menu.map((m) => `${m} (${WARES[m as keyof typeof WARES].cost}g)`).join(", ")}`);
    if (kind === "well" && this.resolved) return this.reject("the well has given what it will give");
    const cost = WARES[name as keyof typeof WARES].cost;
    if (!spend(this.state, cost)) return this.reject(`${name} costs ${cost}g; you have ${this.state.gold}g`);
    let effects: Record<string, number>;
    if (name === "heal") effects = { hp: 12 };
    else if (name === "blade") effects = { attack: 1 };
    else { effects = [{ max_hp: 3 }, { attack: 1 }, { hp: 8 }][this.roll(3)]; this.resolved = true; }
    const changes: Deltas = applyEffects(this.state, effects);
    return this.done([{ type: "bought", item: name, cost, changes }]);
  }

  /** What the devil is shown besides the player (also used by the UI's devil lab). Pure: does not touch the run. */
  context(): DevilContext {
    const a = this.act, seen = new Set<string>(), stack = [...this.node.next];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(a.nodes.find((n) => n.id === id)?.next ?? []));
    }
    const rewritable = a.nodes.filter((n) => seen.has(n.id) && n.id !== a.exit && !a.visited.includes(n.id)).map((n) => ({ id: n.id, kind: n.kind }));
    return { seed: this.seed, act: a.index, nodeId: this.state.nodeId, askIndex: this.totalAsks, rewritable, curses: this.curses.map((c) => ({ ...c })) };
  }

  /** Ask the devil (async: the Gemini backend will be a network call). Replies, even junk, become a sanitized offer. */
  async deal(text?: string): Promise<Result> {
    const stop = this.blocked(); if (stop) return stop;
    if (this.node.kind !== "deal") return this.reject("the devil does not sit here");
    if (this.resolved) return this.reject("the devil has already gone");
    if (this.pending) return this.reject("the devil is still speaking");
    if (this.enemy) return this.reject("not while something is trying to kill you");
    if (this.asks >= MAX_ASKS) return this.reject("he is done haggling: accept() or refuse()");
    this.pending = true; this.asks++; this.totalAsks++;
    const nodeId = this.state.nodeId, ctx = this.context();
    let raw: unknown;
    try { raw = await this.devil.offer(snapshot(this.state), ctx, typeof text === "string" ? text : undefined); } catch { raw = undefined; }
    this.pending = false;
    const deal = sanitizeDeal(raw);
    if (this.state.nodeId !== nodeId || this.ending) return this.reject("the moment passed");
    this.offer = deal;
    return this.done([{ type: "deal_offered", deal }]);
  }

  accept(): Result {
    const stop = this.blocked(); if (stop) return stop;
    const deal = this.offer;
    if (!deal) return this.reject(this.pending ? "the devil is still speaking" : "no offer on the table; deal()");
    const ev: GameEvent[] = [];
    this.offer = null; this.resolved = true; this.dealsDecided++;
    const changes = applyEffects(this.state, deal.effects);
    ev.push({ type: "deal_applied", deal, changes });
    note(this.state, `deal accepted: ${deal.dialogue.slice(0, 60)}`);
    if (deal.curse && this.curses.length < MAX_CURSES) {
      this.curses.push({ trigger: deal.curse.trigger, effect: deal.curse.effect });
      ev.push({ type: "curse_added", curse: deal.curse });
    }
    if (deal.rewrite) {
      const r = rewriteNode(this.act, deal.rewrite.nodeId, deal.rewrite.to);
      if (r.ok) { this.acts[this.state.act] = r.act; ev.push({ type: "node_rewritten", change: r.change }); }
      else ev.push({ type: "rewrite_failed", nodeId: deal.rewrite.nodeId, reason: r.reason });
    }
    this.settleHp(ev, "the devil's bargain");
    return this.done(ev);
  }

  refuse(): Result {
    const stop = this.blocked(); if (stop) return stop;
    if (!this.offer) return this.reject(this.pending ? "the devil is still speaking" : "no offer on the table; deal()");
    this.offer = null; this.resolved = true; this.dealsDecided++;
    return this.done([{ type: "deal_refused" }]);
  }
}

function randomSeed(): string { return Math.random().toString(36).slice(2, 8); }

/** New run. Seed defaults to random; devil defaults to the installed one (setDevil) or a seeded StubDevil. */
export function createGame(seed?: string | number, devil?: Devil): Game {
  const s = seed === undefined || seed === "" ? randomSeed() : String(seed);
  const g = new Game(s, devil ?? devilFor(s));
  normalize(g.state);
  return g;
}
