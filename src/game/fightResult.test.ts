import { test } from "node:test";
import assert from "node:assert/strict";
import { FightSim, NO_CONTROLS, type FightControls } from "../fight/sim";
import { dist, norm, sub } from "../fight/logic";
import { legalActions } from "./actions";
import { sanitizeFightResult, type FightRequest } from "./fightResult";
import { initialState, type Command, type Enemy, type GameState } from "./gameState";
import { step } from "./state-machine";
import { view } from "./view";
import { describe, type GameEvent } from "./events";

const RAT: Enemy = { name: "cave rat", hp: 10, maxHp: 10, power: 2, boss: false };
const BOSS: Enemy = { name: "the Gatekeeper", hp: 18, maxHp: 18, power: 3, boss: true };
/** A fresh run with an enemy blocking the entry (test-only shortcut; `enter` normally spawns it). */
function facing(enemy: Enemy = RAT, seed = "rt"): GameState {
  const s = initialState(seed);
  s.enemy = { ...enemy };
  return s;
}
const RT: Command = { cmd: "fight", realtime: true };
const result = (r: Record<string, unknown>): Command => ({ cmd: "fight_result", won: false, hpLeft: 0, ...r } as Command);
const types = (evs: { type: string }[]) => evs.map((e) => e.type);
const deepFreeze = <T>(x: T): T => {
  if (typeof x === "object" && x !== null && !Object.isFrozen(x)) { Object.freeze(x); for (const v of Object.values(x)) deepFreeze(v); }
  return x;
};

/** Start a realtime fight; returns the awaiting state and request. */
function start(s: GameState): { s: GameState; req: FightRequest } {
  const r = step(s, RT);
  assert.ok(r.ok, JSON.stringify(r.events));
  assert.ok(r.awaiting?.fight);
  return { s: r.state, req: r.awaiting.fight };
}

/** The fight lab's decent bot (src/fight/logic.test.ts): walk in, swing, dash out of telegraphs and bullets. */
function bot(s: FightSim): FightControls {
  const p = s.player, e = s.enemy, to = norm(sub(e.pos, p.pos)), gap = dist(p.pos, e.pos) - p.radius - e.radius;
  if ((e.brain.mode === "windup" && gap < 200) || s.bullets.some((b) => dist(b.pos, p.pos) < 60)) return { move: { x: -to.y, y: to.x }, attack: false, dash: true, aim: null };
  return { move: gap > 40 ? to : { x: 0, y: 0 }, attack: gap < 46, dash: false, aim: e.pos };
}
function play(req: FightRequest, policy: (s: FightSim) => FightControls) {
  const sim = new FightSim(req);
  while (!sim.over && sim.timeMs < 120_000) sim.step(policy(sim));
  return sim.result!;
}

test("realtime fight: awaits a FightRequest (no dice used); only fight_result or look continue", () => {
  const s0 = facing();
  const listed = legalActions(s0);
  assert.deepEqual(listed.slice(0, 2), [{ cmd: "fight" }, { cmd: "fight", realtime: true }], "plain fight stays first; realtime is added");
  const r = step(s0, RT);
  assert.ok(r.ok);
  assert.deepEqual(r.events, []);
  assert.deepEqual(r.awaiting, { fight: {
    player: { hp: 30, maxHp: 30, attack: 3 }, enemy: { name: "cave rat", hp: 10, maxHp: 10, power: 2, boss: false }, seed: `rt:${s0.player.nodeId}:1`,
  } });
  assert.deepEqual(r.state.pendingFight, r.awaiting!.fight);
  assert.deepEqual(r.state.rng, s0.rng, "starting a realtime fight rolls no dice");
  assert.deepEqual(r.actions, [{ cmd: "fight_result", won: false, hpLeft: 30, timeMs: 0, hitsTaken: 0, damageDealt: 0, enemyHpLeft: 10 }]);
  for (const c of [{ cmd: "fight" }, RT, { cmd: "go", n: 1 }, { cmd: "buy", item: "heal" }, { cmd: "deal" }, { cmd: "devil_reply", deal: null }] as Command[]) {
    const x = step(r.state, c);
    assert.equal(x.ok, false, JSON.stringify(c));
    assert.equal(x.state, r.state);
    assert.deepEqual(x.events, [{ type: "rejected", reason: "the fight is still on; send fight_result" }]);
    assert.ok(x.awaiting?.fight, "a rejection still carries the pending fight");
  }
  const look = step(r.state, { cmd: "look" });
  assert.ok(look.ok && look.awaiting?.fight);
  assert.equal(view(r.state).enemy?.hp, 10);
  assert.deepEqual(step(s0, result({ won: true, hpLeft: 30, enemyHpLeft: 0 })).events, [{ type: "rejected", reason: "no fight is on; fight with realtime first" }]);
  assert.equal(step(initialState("rt"), RT).ok, false, "nothing to fight");
});

test("realtime fight won (a real FightSim bot fight): the same events as a round, then gold and the way on", () => {
  const { s, req } = start(facing());
  const fr = play(req, bot);
  assert.equal(fr.won, true);
  const r = step(s, { cmd: "fight_result", ...fr });
  assert.ok(r.ok);
  const taken = 30 - fr.hpLeft;
  assert.deepEqual(types(r.events), taken ? ["fought", "damaged", "enemy_slain"] : ["fought", "enemy_slain"]);
  assert.deepEqual(r.events[0], { type: "fought", dealt: 10, enemyHp: 0, taken, bout: { timeMs: fr.timeMs, hits: fr.hitsTaken, enemy: "cave rat", outcome: "won" } });
  assert.equal(r.state.player.hp, fr.hpLeft);
  assert.equal(r.state.enemy, null);
  assert.ok(r.state.resolved && r.state.pendingFight === null && !r.awaiting);
  assert.ok(r.state.player.gold > s.player.gold);
  assert.ok(r.actions.some((c) => c.cmd === "go"), "exits open again");
  // deterministic: the same state and report give the same step, and a JSON round trip of the awaiting state too
  assert.deepEqual(step(JSON.parse(JSON.stringify(s)) as GameState, { cmd: "fight_result", ...fr }), r);
  assert.deepEqual(play(req, bot), fr, "the request replays the same fight");
});

test("realtime fight lost: revival keeps the enemy at the HP it was left on; a new bout gets a new seed", () => {
  const { s, req } = start(facing());
  const fr = play(req, () => NO_CONTROLS);
  assert.equal(fr.won, false);
  const r = step(s, { cmd: "fight_result", ...fr });
  assert.ok(r.ok);
  assert.deepEqual(types(r.events), ["fought", "damaged", "revived"]);
  assert.equal(r.state.player.soul, 0);
  assert.equal(r.state.player.hp, 15);
  assert.deepEqual(r.state.enemy, { ...RAT, bouts: 1 }, "same enemy, untouched");
  assert.deepEqual(r.actions.slice(0, 2), [{ cmd: "fight" }, RT]);
  const again = start(r.state);
  assert.equal(again.req.seed, `rt:${s.player.nodeId}:2`);
  assert.deepEqual(again.req.player, { hp: 15, maxHp: 30, attack: 3 });
  // partly hurt enemy, then the soul is gone: the second loss ends the run
  const hurtFoe = step(s, result({ won: false, hpLeft: 0, hitsTaken: 5, enemyHpLeft: 4 }));
  assert.equal(hurtFoe.state.enemy?.hp, 4);
  const next = start(hurtFoe.state);
  assert.equal(next.req.enemy.hp, 4);
  const dead = step(next.s, result({ won: false, hpLeft: 0, hitsTaken: 3, enemyHpLeft: 4 }));
  assert.deepEqual(types(dead.events), ["fought", "damaged", "lost"]);
  assert.equal(dead.state.ending, "lose");
  assert.deepEqual(dead.actions, []);
});

test("fight_result is clamped, never trusted: impossible claims are cut down to what the fight allowed", () => {
  const req: FightRequest = { player: { hp: 20, maxHp: 30, attack: 3 }, enemy: { name: "x", hp: 10, maxHp: 12, power: 2, boss: false }, seed: "s" };
  const c = (raw: unknown) => sanitizeFightResult(raw, req);
  // a win claimed while the enemy still stands is no win
  assert.deepEqual(c({ won: true, hpLeft: 20, enemyHpLeft: 5, hitsTaken: 0 }), { outcome: "unfinished", hpLeft: 20, enemyHpLeft: 5, damageDealt: 5, hitsTaken: 0, timeMs: 0 });
  // a fight never heals; overkill and negative numbers are clamped
  assert.deepEqual(c({ won: true, hpLeft: 999, enemyHpLeft: -3, damageDealt: 1e9, hitsTaken: 7, timeMs: 1e12 }), { outcome: "won", hpLeft: 20, enemyHpLeft: 0, damageDealt: 10, hitsTaken: 0, timeMs: 3_600_000 });
  // a win with the player at 0 is a loss (the sim stops at the first death): the enemy keeps at least 1 HP
  assert.deepEqual(c({ won: true, hpLeft: 0, enemyHpLeft: 0, hitsTaken: 3 }), { outcome: "lost", hpLeft: 0, enemyHpLeft: 1, damageDealt: 9, hitsTaken: 3, timeMs: 0 });
  // "lost" with the enemy at 0: not beaten, keeps 1 HP
  assert.equal(c({ won: false, hpLeft: 5, enemyHpLeft: 0 }).enemyHpLeft, 1);
  // hits: at least 1 when HP was lost, at most the HP lost (every hit does 1+)
  assert.equal(c({ won: false, hpLeft: 17, hitsTaken: 50 }).hitsTaken, 3);
  assert.equal(c({ won: false, hpLeft: 17, hitsTaken: 0 }).hitsTaken, 1);
  assert.equal(c({ won: false, hpLeft: 20, hitsTaken: 4 }).hitsTaken, 0);
  // damageDealt only stands in for a missing enemyHpLeft; a bare won:true means the enemy is down
  assert.equal(c({ won: true, hpLeft: 20, damageDealt: 4 }).enemyHpLeft, 6);
  assert.equal(c({ won: true, hpLeft: 20 }).outcome, "won");
  // junk: nothing happened
  for (const junk of [null, undefined, 42, "win", [], { won: "true", hpLeft: "1", enemyHpLeft: NaN, hitsTaken: Infinity }]) {
    assert.deepEqual(c(junk), { outcome: "unfinished", hpLeft: 20, enemyHpLeft: 10, damageDealt: 0, hitsTaken: 0, timeMs: 0 }, JSON.stringify(junk));
  }
  // and through step: a forged win against a standing enemy hurts it but does not clear the way
  const { s } = start(facing());
  const forged = step(s, result({ won: true, hpLeft: 999, enemyHpLeft: 3, damageDealt: 999 }));
  assert.deepEqual(forged.events, [{ type: "fought", dealt: 7, enemyHp: 3, taken: 0, bout: { timeMs: 0, hits: 0, enemy: "cave rat", outcome: "unfinished" } }]);
  assert.equal(forged.state.player.hp, 30);
  assert.equal(forged.state.enemy?.hp, 3);
  assert.ok(!forged.actions.some((c) => c.cmd === "go"));
  // the listed placeholder is a no-op that ends the bout
  const noop = step(s, legalActions(s)[0]);
  assert.deepEqual(noop.events, [{ type: "fought", dealt: 0, enemyHp: 10, taken: 0, bout: { timeMs: 0, hits: 0, enemy: "cave rat", outcome: "unfinished" } }]);
  assert.deepEqual(noop.state.player, s.player);
});

test("on_hit curses fire (once) when a realtime fight landed a hit, before the death check; not when none did", () => {
  const cursed = facing();
  cursed.curses = [{ trigger: "on_hit", effect: { gold: -3 } }, { trigger: "on_fight", effect: { hp: -1 } }];
  const { s } = start(cursed);
  const hit = step(s, result({ won: true, hpLeft: 25, hitsTaken: 2, enemyHpLeft: 0 }));
  assert.deepEqual(types(hit.events), ["fought", "damaged", "curse_fired", "enemy_slain"]);
  assert.deepEqual(hit.state.curses, [{ trigger: "on_fight", effect: { hp: -1 } }], "spent: fires once, not per hit");
  const clean = step(s, result({ won: true, hpLeft: 30, hitsTaken: 0, enemyHpLeft: 0 }));
  assert.deepEqual(types(clean.events), ["fought", "enemy_slain"]);
  assert.equal(clean.state.curses.length, 2);
  // a lethal curse after a won fight: the soul pays, then the enemy still falls
  const lethal = facing();
  lethal.curses = [{ trigger: "on_hit", effect: { hp: -25 } }];
  const l = step(start(lethal).s, result({ won: true, hpLeft: 5, hitsTaken: 4, enemyHpLeft: 0 }));
  assert.deepEqual(types(l.events), ["fought", "damaged", "curse_fired", "revived", "enemy_slain"]);
});

test("realtime boss win: gold and the victory heal; the bout is pure on deep-frozen input", () => {
  const { s, req } = start(facing(BOSS));
  assert.equal(req.enemy.boss, true);
  const frozen = deepFreeze(structuredClone(s)), json = JSON.stringify(frozen);
  const r = step(frozen, result({ won: true, hpLeft: 12, hitsTaken: 4, timeMs: 5000, damageDealt: 18, enemyHpLeft: 0 }));
  assert.equal(JSON.stringify(frozen), json);
  assert.deepEqual(types(r.events), ["fought", "damaged", "enemy_slain", "healed"]);
  assert.equal(r.state.player.hp, 22);
  assert.deepEqual(step(deepFreeze(facing(BOSS)), RT).awaiting, { fight: req }, "starting a bout is pure too");
});

test("a real map fight: walk to the first fight node and finish it in realtime", () => {
  for (let i = 0; i < 20; i++) {
    let s = initialState(`walk-${i}`);
    for (let k = 0; k < 30 && !s.enemy && !s.ending; k++) s = step(s, { cmd: "go", n: 1 }).state;
    if (!s.enemy) continue;
    const { s: w, req } = start(s);
    assert.equal(req.enemy.hp, s.enemy.hp);
    const r = step(w, { cmd: "fight_result", ...play(req, bot) });
    assert.ok(r.ok);
    assert.ok(r.state.enemy === null || r.state.player.soul === 0 || r.state.ending, "won, or revived, or over");
    return;
  }
  assert.fail("no fight node reached");
});

test("describe(fought): realtime bouts read as a whole fight; the turn-based wording is unchanged", () => {
  const f = (e: Partial<Extract<GameEvent, { type: "fought" }>>): GameEvent => ({ type: "fought", dealt: 0, enemyHp: 0, taken: 0, ...e });
  const bout = (o: "won" | "lost" | "unfinished", timeMs: number, hits: number) => ({ timeMs, hits, enemy: "cave rat", outcome: o });
  assert.equal(describe(f({ dealt: 10, taken: 5, bout: bout("won", 12400, 2) })), "After 12.4 s of fighting you dealt 10 and took 5 (2 hits).");
  assert.equal(describe(f({ dealt: 10, taken: 2, bout: bout("won", 3000, 1) })), "After 3.0 s of fighting you dealt 10 and took 2 (1 hit).");
  assert.equal(describe(f({ dealt: 10, bout: bout("won", 2500, 0) })), "After 2.5 s of fighting you dealt 10 and took no damage.");
  assert.equal(describe(f({ dealt: 6, enemyHp: 4, taken: 30, bout: bout("lost", 8100, 4) })), "You fall after 8.1 s, the cave rat still standing at 4 HP.");
  assert.match(describe(f({ dealt: 2, enemyHp: 8, bout: bout("unfinished", 0, 0) })), /unfinished after 0\.0 s.*cave rat has 8 HP left/);
  assert.equal(describe(f({ dealt: 0, enemyHp: 4, taken: 30 })), "You hit for 0; it has 4 HP left, and strikes back for 30.");
  assert.equal(describe(f({ dealt: 5, enemyHp: 5 })), "You hit for 5; it has 5 HP left.");
});
